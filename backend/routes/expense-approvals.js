/**
 * 费用支付监控路由
 *
 * 监控企微"费用支付申请"审批模板的历史单据
 * 数据来源：企微 OpenAPI
 *   - oa/getapprovalinfo（按时间批量拉 sp_no 列表，cursor 分页，每页 100 条，时间跨度 ≤ 31 天）
 *   - oa/getapprovaldetail（按 sp_no 查完整审批数据）
 *
 * 数据模型（4 张表，规范化分表）：
 *   - wecom_expense_approvals（主表：审批单基本信息 + 状态 + raw_detail 兜底）
 *   - wecom_expense_approval_nodes（1:N 节点表：is_current=1 标记当前待审节点）
 *   - wecom_expense_approval_forms（1:N 表单值表：按控件类型存值）
 *   - wecom_expense_payments（1:1 支付表：财务标记已支付/未支付，与审批解耦）
 *
 * 6 个路由：
 *   GET    /                          分页列表（支持 status/timeRange/applyer 筛选）
 *   GET    /:sp_no                    单条详情（含 raw_detail + nodes + forms + payment）
 *   POST   /sync                      增量同步（5 分钟节流，从上次同步时间到现在）
 *   POST   /refresh-status            刷新当前页非终态状态（传 ids 精确刷新）
 *   POST   /:sp_no/mark-paid          财务标记已支付
 *   POST   /:sp_no/mark-unpaid         财务撤销已支付标记
 *
 * 通过 wecom.js 挂载在 /api/wecom/expense-approvals 下（不改 server.js 红线文件）
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requirePermission } = require('../middleware/rbac');

// 延迟 require('./wecom')，避免与 wecom.js 的 router.use(require('./expense-approvals')) 形成循环依赖
// 循环依赖会导致 require('./expense-approvals') 返回空对象 {}，router.use 抛 TypeError
let _wecomHelpers = null;
function getWecomHelpers() {
  if (!_wecomHelpers) {
    _wecomHelpers = require('./wecom');
  }
  return _wecomHelpers;
}

// ============================================================
// 常量
// ============================================================

// sp_status 映射（企微审批单状态）
const SP_STATUS_MAP = {
  1: '审批中',
  2: '已通过',
  3: '已驳回',
  4: '已撤销',
  6: '通过后撤销',
  7: '已删除',
  10: '已支付',
};

// 节点 sp_status 映射（企微审批节点状态）
const NODE_STATUS_MAP = {
  1: '审批中',
  2: '已同意',
  3: '已驳回',
  4: '已转审',
  11: '已退回',
  12: '已加签',
  13: '已同意并加签',
};

// 终态：不需要刷新
const TERMINAL_STATUSES = [2, 3, 4, 6, 7, 10];

// 同步节流间隔（毫秒）— 5 分钟内不重复同步
const SYNC_THROTTLE_MS = 5 * 60 * 1000;

// 企微 API 调用间隔（毫秒）— 保守按 600 次/分 = 100ms/次
const API_CALL_INTERVAL_MS = 100;

// 45009 退避时间（毫秒）
const RATE_LIMIT_BACKOFF_MS = 60 * 1000;

// ============================================================
// Helper：企微 API
// ============================================================

/**
 * 调用企微 oa/getapprovalinfo 按时间范围批量拉取审批单号列表
 * cursor 分页，每页最多 100 条，时间跨度 ≤ 31 天
 *
 * @param {Object} config - wecom_config
 * @param {number} starttime - 起始 Unix 时间戳（秒）
 * @param {number} endtime - 结束 Unix 时间戳（秒）
 * @param {string} templateId - 审批模板 ID
 * @param {string} cursor - 分页游标（首次空串）
 * @returns {Promise<{sp_no_list: string[], next_cursor: string}>}
 */
async function getApprovalInfo(config, starttime, endtime, templateId, cursor) {
  const accessToken = await getWecomHelpers().getAccessToken(config);
  const body = {
    starttime: String(starttime),
    endtime: String(endtime),
    new_cursor: cursor || '',
    size: 100,
    filters: [{ key: 'template_id', value: templateId }],
  };
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/oa/getapprovalinfo?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(`getapprovalinfo 失败: ${data.errmsg} (errcode=${data.errcode})`);
  }
  return {
    sp_no_list: data.sp_no_list || [],
    next_cursor: data.new_next_cursor || '',
  };
}

/**
 * 查 users 表真实姓名（通过 wecom_userid）
 * 参照项目约定：涉及"人名"的字段必须从 users 表查真实姓名，禁止硬编码
 *
 * @param {string} wecomUserid
 * @returns {Promise<string|null>}
 */
async function getUserNameByWecomUserid(wecomUserid) {
  if (!wecomUserid) return null;
  try {
    const [rows] = await pool.query(
      `SELECT u.name FROM user_login_methods ulm
       JOIN users u ON ulm.user_id = u.id
       WHERE ulm.type = 'wecom' AND ulm.identifier = ?
       LIMIT 1`,
      [wecomUserid]
    );
    return rows.length > 0 ? rows[0].name : null;
  } catch (err) {
    console.error(`[expense-approvals] 查用户姓名失败: ${wecomUserid}`, err.message);
    return null;
  }
}

/**
 * sleep 辅助
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从审批单 contents 解析金额
 * 策略（按优先级）：
 *   1. control_type === 'Money' 且 value 含 new_money / money
 *   2. value 含 new_money（Money 控件的标准字段）
 *   3. value 含 money
 *   4. control_title 含"金额"且 value 是纯数字
 * 都不匹配返回 0
 *
 * @param {Array} contents - apply_data.contents 数组
 * @returns {number} 金额（DECIMAL(12,2) 精度）
 */
function parseAmountFromContents(contents) {
  if (!Array.isArray(contents)) return 0;

  for (const ctrl of contents) {
    const val = ctrl.value || {};
    const controlType = ctrl.control || ctrl.property?.control || '';
    const title = ctrl.property?.title?.find?.(t => t.lang === 'zh_CN')?.text
      || ctrl.title
      || '';

    // 1. Money 控件 + new_money / money
    if (controlType === 'Money') {
      const m = val.new_money ?? val.money;
      const n = parseFloat(String(m ?? 0));
      if (!isNaN(n)) return Math.round(n * 100) / 100;
    }
  }

  // 2. 任意控件 value 含 new_money
  for (const ctrl of contents) {
    const val = ctrl.value || {};
    if (val.new_money !== undefined) {
      const n = parseFloat(String(val.new_money));
      if (!isNaN(n)) return Math.round(n * 100) / 100;
    }
    if (val.money !== undefined) {
      const n = parseFloat(String(val.money));
      if (!isNaN(n)) return Math.round(n * 100) / 100;
    }
  }

  // 3. control_title 含"金额"且 value 是纯数字
  for (const ctrl of contents) {
    const val = ctrl.value || {};
    const title = ctrl.property?.title?.find?.(t => t.lang === 'zh_CN')?.text
      || ctrl.title
      || '';
    if (title && title.includes('金额')) {
      const raw = val.new_money ?? val.money ?? val.value ?? val.text ?? val;
      const n = parseFloat(String(raw).replace(/[^\d.]/g, ''));
      if (!isNaN(n)) return Math.round(n * 100) / 100;
    }
  }

  return 0;
}

/**
 * 解析审批单详情并写入 4 张表（幂等：INSERT ... ON DUPLICATE KEY UPDATE）
 *
 * 解析逻辑：
 *   - 主表：sp_no / template_id / sp_name / apply_time / applyer / sp_status
 *   - 节点表：sp_record[] 数组，找 sp_status=1 的第一个节点标记 is_current=1
 *   - 表单值表：apply_data.contents[] 数组，按控件类型存值
 *
 * @param {Object} config - wecom_config
 * @param {string} spNo - 审批单号
 * @returns {Promise<Object>} 写入结果 { sp_no, sp_status, current_node_name, current_approver_name }
 */
async function syncOneApproval(config, spNo) {
  const detail = await getWecomHelpers().getApprovalDetail(config, spNo);
  const info = detail.info || {};

  const spStatus = info.sp_status;
  const spStatusName = SP_STATUS_MAP[spStatus] || `未知(${spStatus})`;
  const applyerUserid = info.applyer?.userid || '';
  const applyerName = await getUserNameByWecomUserid(applyerUserid);

  // 先解析金额（从表单 contents），写入主表 amount 派生列
  const contents = info.apply_data?.contents || [];
  const amount = parseAmountFromContents(contents);

  // ---- 1. 主表 ----
  await pool.query(
    `INSERT INTO wecom_expense_approvals
       (sp_no, template_id, sp_name, apply_time, applyer_userid, applyer_name,
        sp_status, sp_status_name, amount, raw_detail, last_synced_at)
     VALUES (?, ?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       template_id = VALUES(template_id),
       sp_name = VALUES(sp_name),
       apply_time = VALUES(apply_time),
       applyer_userid = VALUES(applyer_userid),
       applyer_name = VALUES(applyer_name),
       sp_status = VALUES(sp_status),
       sp_status_name = VALUES(sp_status_name),
       amount = VALUES(amount),
       raw_detail = VALUES(raw_detail),
       last_synced_at = NOW()`,
    [
      info.sp_no || spNo,
      info.template_id || '',
      info.sp_name || '',
      info.apply_time || 0,
      applyerUserid,
      applyerName,
      spStatus,
      spStatusName,
      amount,
      JSON.stringify(info),
    ]
  );

  // ---- 2. 节点表（sp_record 数组）----
  // 先清除旧节点（防止节点数减少后残留）
  await pool.query('DELETE FROM wecom_expense_approval_nodes WHERE sp_no = ?', [spNo]);

  const spRecord = info.sp_record || [];
  const processList = info.process_list?.node_list || [];
  let currentNodeName = null;
  let currentApproverUserid = null;
  let currentApproverName = null;
  let finalApproverUserid = null;
  let finalApproverName = null;
  let finalApproveTime = null;

  for (let i = 0; i < spRecord.length; i++) {
    const node = spRecord[i];
    const nodeStatus = node.sp_status;
    // 节点名称优先从 process_list 取（更友好），兜底用 sp_record 的默认名
    const nodeName =
      (processList[i] && processList[i].node_name) ||
      `节点${i + 1}`;
    const approveType = node.approverattr || (processList[i] && processList[i].apv_rel);

    // 当前待审节点：第一个 sp_status=1（审批中）的节点
    const isCurrent = nodeStatus === 1 && currentNodeName === null ? 1 : 0;
    if (isCurrent) {
      currentNodeName = nodeName;
      const firstApprover = node.details?.[0]?.approver?.userid || '';
      currentApproverUserid = firstApprover;
      currentApproverName = await getUserNameByWecomUserid(firstApprover);
    }

    // 终审人：最后一个 sp_status=2（已同意）的节点的审批人
    if (nodeStatus === 2) {
      const lastApprover = node.details?.[0]?.approver?.userid || '';
      finalApproverUserid = lastApprover;
      finalApproverName = await getUserNameByWecomUserid(lastApprover);
      const spTime = node.details?.[0]?.sptime;
      if (spTime) finalApproveTime = new Date(Number(spTime) * 1000);
    }

    // 该节点所有审批人 details（可能有多个，会签场景）
    const detailsArr = node.details || [];
    for (const d of detailsArr) {
      const approverUserid = d.approver?.userid || '';
      const approverName = await getUserNameByWecomUserid(approverUserid);
      const speech = d.speech || '';
      const approveTime = d.sptime ? new Date(Number(d.sptime) * 1000) : null;

      await pool.query(
        `INSERT INTO wecom_expense_approval_nodes
           (sp_no, node_index, node_type, node_name, approve_type,
            sp_status, approver_userid, approver_name, speech, approve_time, is_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          spNo,
          i,
          processList[i] ? processList[i].node_type : null,
          nodeName,
          approveType ? Number(approveType) : null,
          nodeStatus,
          approverUserid,
          approverName,
          speech,
          approveTime,
          isCurrent,
        ]
      );
    }
  }

  // ---- 3. 表单值表（apply_data.contents 数组）----
  // 先清除旧表单值
  await pool.query('DELETE FROM wecom_expense_approval_forms WHERE sp_no = ?', [spNo]);

  // 复用上方已声明的 contents（行 233，解析金额时已取出），避免重复声明
  for (const ctrl of contents) {
    if (!ctrl.id) continue;
    await pool.query(
      `INSERT INTO wecom_expense_approval_forms
         (sp_no, control_id, control_type, control_title, control_value)
       VALUES (?, ?, ?, ?, ?)`,
      [
        spNo,
        ctrl.id,
        ctrl.control || '',
        ctrl.title || '',
        JSON.stringify(ctrl.value || {}),
      ]
    );
  }

  return {
    sp_no: spNo,
    sp_status: spStatus,
    sp_status_name: spStatusName,
    current_node_name: currentNodeName,
    current_approver_userid: currentApproverUserid,
    current_approver_name: currentApproverName,
    final_approver_userid: finalApproverUserid,
    final_approver_name: finalApproverName,
    final_approve_time: finalApproveTime,
  };
}

/**
 * 批量同步：按时间范围拉取 sp_no 列表，串行调 syncOneApproval
 * 遵循项目约定：串行避免 45009 限流，单条失败不中断
 *
 * @param {Object} config - wecom_config
 * @param {number} starttime - 起始时间戳（秒）
 * @param {number} endtime - 结束时间戳（秒）
 * @param {string} templateId - 审批模板 ID
 * @param {Object} opts - { onProgress?: (done, total) => void }
 * @returns {Promise<{synced: number, failed: number, errors: string[]}>}
 */
async function syncRange(config, starttime, endtime, templateId, opts = {}) {
  const { onProgress } = opts;
  let synced = 0;
  let failed = 0;
  const errors = [];
  let cursor = '';
  let totalSeen = 0;

  do {
    const { sp_no_list, next_cursor } = await getApprovalInfo(
      config,
      starttime,
      endtime,
      templateId,
      cursor
    );
    totalSeen += sp_no_list.length;

    // 串行调 detail（避免 45009）
    for (const spNo of sp_no_list) {
      try {
        await syncOneApproval(config, spNo);
        synced++;
        if (onProgress) onProgress(synced, totalSeen);
      } catch (err) {
        failed++;
        const errMsg = `sp_no=${spNo}: ${err.message}`;
        errors.push(errMsg);
        console.error(`[expense-approvals sync] ${errMsg}`);
        // 45009 退避 60 秒后继续
        if (err.message.includes('45009') || err.message.includes('freq out of limit')) {
          console.warn('[expense-approvals sync] 触发企微限流，退避 60s');
          await sleep(RATE_LIMIT_BACKOFF_MS);
        }
      }
      // 保守间隔
      await sleep(API_CALL_INTERVAL_MS);
    }

    cursor = next_cursor;
  } while (cursor);

  return { synced, failed, errors, total: totalSeen };
}

// ============================================================
// 路由
// ============================================================

/**
 * GET / — 分页列表
 * 查询参数：page, pageSize, status, paymentStatus, applyerUserid, startTime, endTime
 * 返回：{ list, total, summary: { approved_amount, paid_amount, unpaid_amount } }
 */
router.get('/', requireAuth, requirePermission('menu:expense-payment-monitor'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const { status, paymentStatus, applyerUserid, startTime, endTime, month, keyword } = req.query;

    const conditions = [];
    const params = [];
    if (status) { conditions.push('e.sp_status = ?'); params.push(Number(status)); }
    if (paymentStatus) { conditions.push("IFNULL(p.payment_status,'unpaid') = ?"); params.push(paymentStatus); }
    if (applyerUserid) { conditions.push('e.applyer_userid = ?'); params.push(applyerUserid); }
    // month 参数：格式 YYYY-MM，自动转换为该月时间范围
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      const [y, m] = String(month).split('-').map(Number);
      const monthStart = new Date(y, m - 1, 1, 0, 0, 0);
      const monthEnd = new Date(y, m, 0, 23, 59, 59);
      conditions.push('e.apply_time >= ? AND e.apply_time <= ?');
      params.push(monthStart.toISOString().slice(0, 19).replace('T', ' '));
      params.push(monthEnd.toISOString().slice(0, 19).replace('T', ' '));
    } else {
      if (startTime) { conditions.push('e.apply_time >= ?'); params.push(startTime); }
      if (endTime) { conditions.push('e.apply_time <= ?'); params.push(endTime); }
    }
    // keyword 参数：按单号/申请人姓名/金额模糊搜索
    if (keyword) {
      const kw = String(keyword).trim();
      if (kw) {
        conditions.push('(e.sp_no LIKE ? OR e.applyer_name LIKE ? OR CAST(e.amount AS CHAR) LIKE ?)');
        params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
      }
    }

    const whereSql = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // 列表：主表 LEFT JOIN payments + 取当前待审节点（is_current=1）
    const [rows] = await pool.query(
      `SELECT
         e.sp_no, e.sp_name, e.apply_time, e.applyer_userid, e.applyer_name,
         e.sp_status, e.sp_status_name, e.last_synced_at, e.amount,
         IFNULL(p.payment_status,'unpaid') AS payment_status,
         p.paid_time, p.paid_by_name, p.payment_remark,
         cn.node_name AS current_node_name,
         cn.approver_name AS current_approver_name
       FROM wecom_expense_approvals e
       LEFT JOIN wecom_expense_payments p ON e.sp_no = p.sp_no
       LEFT JOIN wecom_expense_approval_nodes cn ON e.sp_no = cn.sp_no AND cn.is_current = 1
       ${whereSql}
       ORDER BY e.apply_time DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // 总数
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM wecom_expense_approvals e
       LEFT JOIN wecom_expense_payments p ON e.sp_no = p.sp_no
       ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    // 合计（已通过金额、已支付金额、未支付金额）—— 直接用主表 amount 派生列
    const [summaryRows] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN e.sp_status = 2 THEN e.amount ELSE 0 END), 0) AS approved_amount,
         COALESCE(SUM(CASE WHEN e.sp_status = 2 AND IFNULL(p.payment_status,'unpaid') = 'paid' THEN e.amount ELSE 0 END), 0) AS paid_amount,
         COALESCE(SUM(CASE WHEN e.sp_status = 2 AND IFNULL(p.payment_status,'unpaid') = 'unpaid' THEN e.amount ELSE 0 END), 0) AS unpaid_amount
       FROM wecom_expense_approvals e
       LEFT JOIN wecom_expense_payments p ON e.sp_no = p.sp_no
       ${whereSql}`,
      params
    );

    res.json({
      list: rows,
      total,
      summary: summaryRows[0] || { approved_amount: 0, paid_amount: 0, unpaid_amount: 0 },
    });
  } catch (err) {
    console.error('[expense-approvals list] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:sp_no — 单条详情（含 raw_detail + nodes + forms + payment）
 */
router.get('/:sp_no', requireAuth, requirePermission('menu:expense-payment-monitor'), async (req, res) => {
  try {
    const { sp_no } = req.params;
    const [mainRows] = await pool.query(
      'SELECT * FROM wecom_expense_approvals WHERE sp_no = ?',
      [sp_no]
    );
    if (mainRows.length === 0) return res.status(404).json({ error: '审批单不存在' });

    const [nodes] = await pool.query(
      'SELECT * FROM wecom_expense_approval_nodes WHERE sp_no = ? ORDER BY node_index, id',
      [sp_no]
    );
    const [forms] = await pool.query(
      'SELECT * FROM wecom_expense_approval_forms WHERE sp_no = ? ORDER BY id',
      [sp_no]
    );
    const [payments] = await pool.query(
      'SELECT * FROM wecom_expense_payments WHERE sp_no = ?',
      [sp_no]
    );

    res.json({
      ...mainRows[0],
      nodes,
      forms,
      payment: payments[0] || { payment_status: 'unpaid' },
    });
  } catch (err) {
    console.error('[expense-approvals detail] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /sync — 增量同步（5 分钟节流）
 * 从 MAX(last_synced_at) 或 MAX(apply_time) 到现在
 */
router.post('/sync', requireAuth, requirePermission('menu:expense-payment-monitor'), async (req, res) => {
  try {
    const config = await getWecomHelpers().getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }
    const templateId = config.expense_payment_template_id;
    if (!templateId) {
      return res.status(400).json({ error: '请先在 WecomManager 配置"费用支付申请模板ID"' });
    }

    // 节流：5 分钟内不重复同步
    const [recentRows] = await pool.query(
      `SELECT MAX(last_synced_at) AS last_synced FROM wecom_expense_approvals`
    );
    const lastSynced = recentRows[0]?.last_synced;
    if (lastSynced) {
      const elapsed = Date.now() - new Date(lastSynced).getTime();
      if (elapsed < SYNC_THROTTLE_MS) {
        const waitSec = Math.ceil((SYNC_THROTTLE_MS - elapsed) / 1000);
        return res.json({
          synced: 0,
          failed: 0,
          total: 0,
          skipped: true,
          message: `刚同步过，${waitSec}秒后可再次同步`,
          last_synced_at: lastSynced,
        });
      }
    }

    // 计算时间范围：从最后一条审批时间到现在，按 31 天切片
    const [maxRows] = await pool.query(
      `SELECT COALESCE(MAX(apply_time), '2020-01-01') AS max_apply FROM wecom_expense_approvals`
    );
    let starttime = Math.floor(new Date(maxRows[0].max_apply).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    // 起始往前 1 小时兜底（防止边界丢失）
    starttime = Math.max(0, starttime - 3600);

    const result = { synced: 0, failed: 0, total: 0, errors: [] };
    let cursor = starttime;
    // 按 31 天切片
    while (cursor < now) {
      const sliceEnd = Math.min(cursor + 31 * 86400, now);
      const r = await syncRange(config, cursor, sliceEnd, templateId);
      result.synced += r.synced;
      result.failed += r.failed;
      result.total += r.total;
      result.errors.push(...r.errors);
      cursor = sliceEnd;
    }

    res.json({
      synced: result.synced,
      failed: result.failed,
      total: result.total,
      errors: result.errors.slice(0, 10),
      last_synced_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[expense-approvals sync] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /refresh-status — 刷新当前页非终态审批状态
 * 入参: { ids: string[] }
 * 串行调用企微 API（避免 45009 限流），单条失败不中断
 * 只刷新非终态记录（sp_status NOT IN 终态），参照项目约定"批量操作只作用于当前页"
 */
router.post('/refresh-status', requireAuth, requirePermission('menu:expense-payment-monitor'), async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请传 ids 数组' });
    }

    // 只查非终态记录
    const [rows] = await pool.query(
      `SELECT sp_no FROM wecom_expense_approvals
       WHERE sp_no IN (?) AND sp_status NOT IN (?)`,
      [ids, TERMINAL_STATUSES]
    );

    if (rows.length === 0) {
      return res.json({
        results: [],
        failed: [],
        summary: { total: ids.length, refreshed: 0, skipped: ids.length, failed: 0 },
      });
    }

    const config = await getWecomHelpers().getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }

    const results = [];
    const failed = [];
    let skipped = ids.length - rows.length;

    for (const row of rows) {
      try {
        const r = await syncOneApproval(config, row.sp_no);
        results.push(r);
        await sleep(API_CALL_INTERVAL_MS);
      } catch (err) {
        failed.push({ sp_no: row.sp_no, error: err.message });
        if (err.message.includes('45009') || err.message.includes('freq out of limit')) {
          console.warn('[expense-approvals refresh] 触发企微限流，退避 60s');
          await sleep(RATE_LIMIT_BACKOFF_MS);
        }
      }
    }

    res.json({
      results,
      failed,
      summary: {
        total: ids.length,
        refreshed: results.length,
        skipped,
        failed: failed.length,
      },
    });
  } catch (err) {
    console.error('[expense-approvals refresh-status] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:sp_no/mark-paid — 财务标记已支付
 * 需要 action:mark-expense-paid 权限
 */
router.post('/:sp_no/mark-paid', requireAuth, requirePermission('action:mark-expense-paid'), async (req, res) => {
  try {
    const { sp_no } = req.params;
    const { payment_remark } = req.body || {};
    const [rows] = await pool.query(
      'SELECT sp_no FROM wecom_expense_approvals WHERE sp_no = ?',
      [sp_no]
    );
    if (rows.length === 0) return res.status(404).json({ error: '审批单不存在' });

    const paidByName = req.user?.name || '未知';
    const paidByUserid = req.user?.id || '';
    await pool.query(
      `INSERT INTO wecom_expense_payments (sp_no, payment_status, paid_time, paid_by_userid, paid_by_name, payment_remark)
       VALUES (?, 'paid', NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         payment_status = 'paid',
         paid_time = NOW(),
         paid_by_userid = VALUES(paid_by_userid),
         paid_by_name = VALUES(paid_by_name),
         payment_remark = VALUES(payment_remark)`,
      [sp_no, paidByUserid, paidByName, payment_remark || '']
    );

    res.json({ sp_no, payment_status: 'paid', paid_time: new Date().toISOString() });
  } catch (err) {
    console.error('[expense-approvals mark-paid] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:sp_no/mark-unpaid — 财务撤销已支付标记
 * 需要 action:mark-expense-paid 权限
 */
router.post('/:sp_no/mark-unpaid', requireAuth, requirePermission('action:mark-expense-paid'), async (req, res) => {
  try {
    const { sp_no } = req.params;
    await pool.query(
      `INSERT INTO wecom_expense_payments (sp_no, payment_status)
       VALUES (?, 'unpaid')
       ON DUPLICATE KEY UPDATE
         payment_status = 'unpaid',
         paid_time = NULL,
         paid_by_userid = NULL,
         paid_by_name = NULL,
         payment_remark = NULL`,
      [sp_no]
    );

    res.json({ sp_no, payment_status: 'unpaid' });
  } catch (err) {
    console.error('[expense-approvals mark-unpaid] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 导出供同步脚本和 wecom.js 挂载使用
module.exports = router;
module.exports.syncRange = syncRange;
module.exports.syncOneApproval = syncOneApproval;
module.exports.getApprovalInfo = getApprovalInfo;
module.exports.parseAmountFromContents = parseAmountFromContents;
module.exports.SP_STATUS_MAP = SP_STATUS_MAP;
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
