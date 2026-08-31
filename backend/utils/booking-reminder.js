/**
 * ============================================================
 * 预订交互卡催办模块（R4）
 * ------------------------------------------------------------
 * 企微 response_code 有效期仅 72h（官方硬限制，无法调 30 天）
 * 催办间隔 60h：每次催办灰化上一张历史卡 + 发新卡(新 response_code)
 * 按钮文案规则：催办0次='去审批'，催办N>0='去审批 · 已催办N次'
 * 审批完成时：遍历所有 response_code 逐个尝试灰化"已确认 HH:mm"
 * ============================================================
 */

const pool = require('../db');
const uuid = require('uuid');

// 催办间隔 & 上限（可按需调整）
const REMIND_INTERVAL_MS = 70 * 60 * 60 * 1000;  // 70h（< code 72h 有效期，留 2h 安全余量）
const MAX_REMIND_COUNT   = 3;                     // 最多催办 3 次
const CODE_EXPIRE_MS     = 72 * 60 * 60 * 1000;  // code 官方有效期 72h（过期跳过 update）

// 获取 wecom config + 导出函数引用（require 延迟加载，避免循环依赖）
let _wecom = null;
function getWecom() {
  if (!_wecom) _wecom = require('../routes/wecom');
  return _wecom;
}

let _running = false;  // 定时任务防重入
let _tableMissingWarned = false;  // 表缺失只告警一次，避免每分钟刷屏

// 判断错误是否是「表不存在」/「列不存在」这一类 migration 还没跑的竞态错误
function _isMigrationRaceError(e) {
  const msg = String(e && e.message || '');
  return /Table.*doesn't exist/i.test(msg) || /Unknown column/i.test(msg);
}

// 表缺失只 warn 一次
function _warnTableMissingOnce(location) {
  if (_tableMissingWarned) return;
  _tableMissingWarned = true;
  console.warn(`[reminder] ${location}：booking_reminder_tasks 表缺失（或相关列未创建）。请尽快执行 migrations/105_booking_reminder_tasks.sql。后续同类错误不再重复报警。`);
}

// ============================================================
// 1. 发卡时创建催办任务（提交订单 / 销售员确认 / 审核 通过 后调用）
// ============================================================
async function createReminderTask(orderId, stage, userid) {
  if (!orderId || !stage || !userid) return null;
  try {
    const taskId = uuid.v4();
    const nextRemindAt = new Date(Date.now() + REMIND_INTERVAL_MS);
    await pool.query(`
      INSERT INTO booking_reminder_tasks (id, order_id, stage, userid, remind_count, max_remind, next_remind_at, status)
      VALUES (?, ?, ?, ?, 0, ?, ?, 'pending')
    `, [taskId, orderId, stage, userid, MAX_REMIND_COUNT, nextRemindAt]);
    console.log(`[reminder] 创建催办任务: order=${orderId}, stage=${stage}, user=${userid}, next=${nextRemindAt.toISOString()}`);
    return taskId;
  } catch (e) {
    // 【方案S：兼容迁移105未跑】表不存在时只告警一次，不阻塞提交/审核流程
    if (_isMigrationRaceError(e)) {
      _warnTableMissingOnce('createReminderTask');
      return null;
    }
    console.error('[reminder] 创建催办任务失败:', e.message);
    return null;
  }
}

// ============================================================
// 2. 定时催办主流程（每分钟查一次）
// ============================================================
async function runPendingReminders() {
  if (_running) return;
  _running = true;
  let rows = [];
  try {
    const [res] = await pool.query(`
      SELECT * FROM booking_reminder_tasks
      WHERE status = 'pending' AND next_remind_at <= NOW()
      LIMIT 30
    `);
    rows = res;
  } catch (eQuery) {
    // 【方案S：兼容迁移105未跑】表不存在直接 return，不阻塞、不刷屏
    if (_isMigrationRaceError(eQuery)) {
      _warnTableMissingOnce('runPendingReminders');
      _running = false;
      return;
    }
    _running = false;
    throw eQuery;
  }
  try {
    if (!rows.length) return;

    const wecom = getWecom();
    const config = await wecom.getWecomConfig().catch(() => null);
    if (!config) return;

    for (const task of rows) {
      try {
        await executeOneReminder(config, task);
      } catch (e) {
        // 单任务失败不阻塞其他任务：表缺失类归为降级不报错
        if (_isMigrationRaceError(e)) {
          _warnTableMissingOnce(`executeOneReminder(task=${task.id})`);
          continue;
        }
        console.error(`[reminder] 催办任务 ${task.id} 异常:`, e.message);
      }
    }
  } finally {
    _running = false;
  }
}

async function executeOneReminder(config, task) {
  // 1. 查订单
  const [orderRows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [task.order_id]);
  if (!orderRows.length) {
    try { await pool.query("UPDATE booking_reminder_tasks SET status='completed' WHERE id=?", [task.id]); }
    catch (e) { if (_isMigrationRaceError(e)) _warnTableMissingOnce('executeOneReminder UPDATE completed(L120)'); }
    return;
  }
  const order = orderRows[0];

  // 已关闭/已完成 → 自动结束催办
  if (['confirmed', 'rejected', 'completed'].includes(order.status)) {
    try { await pool.query("UPDATE booking_reminder_tasks SET status='completed' WHERE id=?", [task.id]); }
    catch (e) { if (_isMigrationRaceError(e)) _warnTableMissingOnce('executeOneReminder UPDATE completed(L127)'); }
    return;
  }

  const cardCodes = safeParse(order.wecom_card_response_codes) || {};
  const stageKey = task.stage === 'reviewing' ? 'approve'
                 : task.stage === 'sales_confirming' ? 'sales_confirm'
                 : null;
  if (!stageKey) return;

  const cardEntry = cardCodes[stageKey];
  const { sendTemplateCardToUser, updateTemplateCard, updateTemplateCardButton } = config ? getWecom() : {};
  if (!sendTemplateCardToUser) return;

  // 2. 灰化上一张历史卡（text → "已催办N次"，不能 update 按钮但能 update 卡片内容）
  //    方式：直接 updateTemplateCardButton 把按钮变灰（更简单）；如果过期则 updateTemplateCard 更新卡片内容提示已催办
  if (cardEntry && cardEntry.response_code && cardEntry.at) {
    const elapsed = Date.now() - new Date(cardEntry.at).getTime();
    if (elapsed < CODE_EXPIRE_MS) {
      // 还在有效期 → 灰化按钮
      try {
        const greyLabel = `已催办${task.remind_count + 1}次`;
        await updateTemplateCardButton(config, task.userid, cardEntry.response_code, greyLabel, 2); // style=2 灰
      } catch (e) {
        console.warn(`[reminder] 灰化历史卡过期/失败(code=${cardEntry.response_code?.substring(0,8)}...): ${e.message}`);
      }
    } else {
      console.warn(`[reminder] 历史卡 code 已过期(elapsed=${Math.round(elapsed/3600000)}h)，跳过灰化`);
    }
  }

  // 3. 发新卡（新 response_code），按钮文案：催办N+1次
  const orderNo = order.order_no || order.id;
  const customerName = order.customer_name || '未知客户';
  const bizSummary = (getWecom().buildBizSummary || (() => '—'))(order);
  const newRemindCount = task.remind_count + 1;
  const btnText = newRemindCount === 0 ? '去审批' : `去审批 · 已催办${newRemindCount}次`;
  const btnType = task.stage === 'sales_confirming' ? '去确认' : '去审核';
  const cardUrl = config.app_domain ? `${config.app_domain}/booking-confirm?id=${encodeURIComponent(order.id || '')}` : '';
  const changeTime = formatNowCN();

  const hContent = [
    { keyname: '订单号', value: orderNo },
    { keyname: '客户', value: customerName },
    { keyname: '业务', value: bizSummary },
    { keyname: '催办次数', value: `${newRemindCount}/${task.max_remind}` },
  ];
  if (order.remark) hContent.splice(2, 0, { keyname: '备注', value: order.remark });

  const newCode = uuid.v4();
  await sendTemplateCardToUser(config, task.userid, {
    card_type: 'button_interaction',
    source: { desc: '预订管理系统' },
    main_title: {
      title: `📋 ${task.stage === 'reviewing' ? '订单待审批' : '订单待确认'}`,
      desc: newRemindCount > 0 ? `已催办 ${newRemindCount} 次 · 请尽快处理` : customerName,
    },
    sub_title_text: `订单号：${orderNo}\n${newRemindCount > 0 ? `催办时间：${changeTime}` : '请尽快处理'}`,
    horizontal_content_list: hContent,
    button_list: [{ text: newRemindCount === 0 ? btnType : `${btnType} · 已催办${newRemindCount}次`, style: 1, type: 1, key: `go_booking_${order.id}`, url: cardUrl }],
  });

  // 4. 存新 code 到 order.wecom_card_response_codes[stageKey + '_reminds'] 数组
  if (!cardCodes[stageKey + '_reminds']) cardCodes[stageKey + '_reminds'] = [];
  cardCodes[stageKey + '_reminds'].push({ response_code: newCode, at: changeTime });
  cardCodes[stageKey + '_remind_count'] = newRemindCount;
  cardCodes[stageKey] = { userid: task.userid, response_code: newCode, at: changeTime };
  await pool.query('UPDATE booking_orders SET wecom_card_response_codes = ? WHERE id = ?',
    [JSON.stringify(cardCodes), order.id]);

  // 5. 更新催办任务状态
  // 【方案S：迁移105未跑 → 表缺失降级】UPDATE 失败不阻塞（灰化+发新卡已经做了）
  if (newRemindCount >= task.max_remind) {
    try {
      await pool.query("UPDATE booking_reminder_tasks SET status='completed', remind_count=?, last_response_code=?, last_response_at=NOW() WHERE id=?",
        [newRemindCount, newCode, task.id]);
      console.log(`[reminder] 达到最大催办次数，停止催办: order=${task.order_id}, count=${newRemindCount}`);
    } catch (e) {
      if (_isMigrationRaceError(e)) _warnTableMissingOnce('executeOneReminder UPDATE max-count(L201)');
      else throw e;
    }
  } else {
    try {
      const nextAt = new Date(Date.now() + REMIND_INTERVAL_MS);
      await pool.query("UPDATE booking_reminder_tasks SET remind_count=?, next_remind_at=?, last_response_code=?, last_response_at=NOW(), updated_at=NOW() WHERE id=?",
        [newRemindCount, nextAt, newCode, task.id]);
      console.log(`[reminder] 催办完成: order=${task.order_id}, count=${newRemindCount}, next=${nextAt.toISOString()}`);
    } catch (e) {
      if (_isMigrationRaceError(e)) _warnTableMissingOnce('executeOneReminder UPDATE next(L206)');
      else throw e;
    }
  }
}

// ============================================================
// 3. 审批完成时：遍历所有 response_code 逐个尝试灰化 + 取消催办
// 调用点：approveOrder / rejectOrder / salesConfirmOrder / completeOrder
// ============================================================
async function greyAllCardsOnApprove(orderId, stage, resultLabel) {
  if (!orderId) return;
  try {
    const [orderRows] = await pool.query('SELECT * FROM booking_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!orderRows.length) return;
    const order = orderRows[0];
    const cardCodes = safeParse(order.wecom_card_response_codes) || {};
    const stageKey = stage === 'reviewing' ? 'approve'
                   : stage === 'sales_confirming' ? 'sales_confirm'
                   : null;
    if (!stageKey) return;

    const wecom = getWecom();
    const config = await wecom.getWecomConfig().catch(() => null);
    if (!config) return;
    const { updateTemplateCardButton } = wecom;
    const nowStr = formatNowCN().slice(11, 16);  // HH:mm

    // 收集所有 response_code：当前 code + 催办历史 code
    const allCodes = [];
    const primary = cardCodes[stageKey];
    if (primary && primary.response_code) {
      allCodes.push({ code: primary.response_code, at: primary.at, label: 'primary' });
    }
    const reminds = cardCodes[stageKey + '_reminds'] || [];
    for (const r of reminds) {
      if (r.response_code) allCodes.push({ code: r.response_code, at: r.at, label: 'remind' });
    }

    let successCount = 0;
    for (const entry of allCodes) {
      const elapsed = entry.at ? (Date.now() - new Date(entry.at).getTime()) : 0;
      if (entry.at && elapsed >= CODE_EXPIRE_MS) {
        console.log(`[reminder-grey] 跳过过期 code(elapsed=${Math.round(elapsed/3600000)}h)`);
        continue;
      }
      try {
        await updateTemplateCardButton(config,
          stage === 'sales_confirming' ? cardCodes.sales_confirm?.userid : config.booking_approver_userid,
          entry.code, `${resultLabel} ${nowStr}`, 2);
        successCount++;
      } catch (e) {
        console.warn(`[reminder-grey] 灰化失败(code=${entry.code?.substring(0,8)}...): ${e.message}`);
      }
    }

    // 4. 取消催办任务
    // 【方案S：迁移105未跑 → 表缺失降级】UPDATE 失败不阻塞卡片灰化
    try {
      await pool.query("UPDATE booking_reminder_tasks SET status='completed' WHERE order_id=?", [orderId]);
    } catch (eTask) {
      if (_isMigrationRaceError(eTask)) {
        _warnTableMissingOnce('greyAllCardsOnApprove UPDATE completed');
      } else {
        console.warn('[reminder-grey] 取消催办任务失败:', eTask.message);
      }
    }

    console.log(`[reminder-grey] 审批完成灰化: order=${orderId}, success=${successCount}/${allCodes.length}`);
  } catch (e) {
    console.error('[reminder-grey] 审批灰化异常:', e.message);
  }
}

// ============================================================
// 4. 取消催办（订单撤回/删除）
// ============================================================
async function cancelReminder(orderId) {
  if (!orderId) return;
  try {
    await pool.query("UPDATE booking_reminder_tasks SET status='cancelled' WHERE order_id=?", [orderId]);
  } catch (e) {
    // 【方案S：迁移105未跑 → 表缺失降级】静默跳过
    if (_isMigrationRaceError(e)) {
      _warnTableMissingOnce('cancelReminder UPDATE cancelled');
    }
    // 其他错误也静默（撤回/删除流程不应该因为催办表问题而失败）
  }
}

// ============================================================
// 5. 启动定时任务（应用启动时调用一次）
// ============================================================
function startReminderScheduler() {
  // 每分钟查一次
  setInterval(() => {
    runPendingReminders().catch(() => {});
  }, 60 * 1000);
  console.log('[reminder] 催办定时任务已启动(每 60s 轮询一次)');

  // 立即跑一次（启动时兜底）
  runPendingReminders().catch(() => {});
}

// ============================================================
// 工具
// ============================================================
function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
}
function formatNowCN(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
  createReminderTask,
  runPendingReminders,
  greyAllCardsOnApprove,
  cancelReminder,
  startReminderScheduler,
};
