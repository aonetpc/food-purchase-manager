#!/usr/bin/env node
/**
 * 费用支付审批 — 本地回填脚本（零企微 API 调用）
 *
 * 背景：
 *   1. 主表新增 amount 派生列，旧数据 amount=0，需要从 raw_detail 重新解析回填
 *   2. nodes 表唯一键从 (sp_no,node_index) 改为 (sp_no,node_index,approver_userid)，
 *      会签多审批人场景需要重新写入
 *
 * 本脚本从 wecom_expense_approvals.raw_detail 字段（getapprovaldetail 完整返回）
 * 重新解析，不调用任何企微 API，不会触发 45009 限流。
 *
 * 用法：
 *   cd /opt/food-purchase/backend
 *   node scripts/backfill_expense_amount_and_nodes.js
 *   # 只回填指定单号
 *   node scripts/backfill_expense_amount_and_nodes.js --sp-no=202506160031
 *
 * 注意：运行前需先执行迁移 114（加 amount 列 + 改唯一键）
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db');
const { parseAmountFromContents, SP_STATUS_MAP } = require('../routes/expense-approvals');

// 从 user_login_methods + users 查真实姓名（同步脚本逻辑的本地复用）
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
  } catch {
    return null;
  }
}

// 解析参数
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

// 回填单条审批单（从 raw_detail 重新解析 amount + nodes）
async function backfillOne(spNo, rawDetail) {
  const info = rawDetail || {};

  // 1. 解析金额
  const contents = info.apply_data?.contents || [];
  const amount = parseAmountFromContents(contents);

  // 2. 更新主表 amount
  await pool.query(
    'UPDATE wecom_expense_approvals SET amount = ? WHERE sp_no = ?',
    [amount, spNo]
  );

  // 3. 重写 nodes 表（先删后插，修复会签多审批人唯一键）
  await pool.query('DELETE FROM wecom_expense_approval_nodes WHERE sp_no = ?', [spNo]);

  const spRecord = info.sp_record || [];
  const processList = info.process_list?.node_list || [];
  let currentNodeName = null;

  for (let i = 0; i < spRecord.length; i++) {
    const node = spRecord[i];
    const nodeStatus = node.sp_status;
    const nodeName = (processList[i] && processList[i].node_name) || `节点${i + 1}`;
    const approveType = node.approverattr || (processList[i] && processList[i].apv_rel);

    const isCurrent = nodeStatus === 1 && currentNodeName === null ? 1 : 0;
    if (isCurrent) currentNodeName = nodeName;

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
          spNo, i,
          processList[i] ? processList[i].node_type : null,
          nodeName,
          approveType ? Number(approveType) : null,
          nodeStatus,
          approverUserid, approverName, speech, approveTime, isCurrent,
        ]
      );
    }
  }

  return { sp_no: spNo, amount, node_count: spRecord.length };
}

async function main() {
  console.log('\n🔄 费用支付审批 — 本地回填（amount + nodes，零企微 API 调用）');
  console.log('═'.repeat(70));

  const args = parseArgs();

  // 读取需要回填的审批单（有 raw_detail 的）
  let sql = 'SELECT sp_no, raw_detail FROM wecom_expense_approvals WHERE raw_detail IS NOT NULL';
  const params = [];
  if (args['sp-no']) {
    sql += ' AND sp_no = ?';
    params.push(args['sp-no']);
  }
  sql += ' ORDER BY apply_time DESC';

  const [rows] = await pool.query(sql, params);
  console.log(`待回填记录数: ${rows.length}`);

  let success = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const rawDetail = typeof row.raw_detail === 'string'
        ? JSON.parse(row.raw_detail)
        : row.raw_detail;
      const r = await backfillOne(row.sp_no, rawDetail);
      success++;
      if ((i + 1) % 100 === 0 || i === rows.length - 1) {
        console.log(`   进度: ${i + 1}/${rows.length} 已回填（${row.sp_no} amount=${r.amount}）`);
      }
    } catch (err) {
      failed++;
      const msg = `${row.sp_no}: ${err.message}`;
      errors.push(msg);
      console.error(`   失败: ${msg}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('✅ 回填完成');
  console.log(`   成功: ${success} 条`);
  console.log(`   失败: ${failed} 条`);
  if (errors.length > 0) {
    console.log(`   错误详情（前 10 条）:`);
    errors.slice(0, 10).forEach((e, i) => console.log(`   ${i + 1}. ${e}`));
  }

  // 验证
  const [stat] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END) AS with_amount,
       SUM(amount) AS total_amount
     FROM wecom_expense_approvals`
  );
  console.log('\n📊 金额统计:');
  console.log(`   总记录: ${stat[0].total}`);
  console.log(`   有金额: ${stat[0].with_amount}`);
  console.log(`   金额合计: ${stat[0].total_amount}`);

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ 回填失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
