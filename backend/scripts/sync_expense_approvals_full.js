#!/usr/bin/env node
/**
 * 费用支付审批历史 — 首次全量同步脚本
 *
 * 一次性把企微"费用支付申请"审批模板的全部历史审批单同步到本地 4 张表
 * 按时间范围（默认近 2 年）以 31 天为切片，串行调用
 *   - oa/getapprovalinfo（cursor 分页拿 sp_no 列表）
 *   - oa/getapprovaldetail（逐条拉详情落库）
 * 串行 + 100ms 间隔避免企微 45009 限流
 *
 * 前置条件：
 *   1. wecom_config 已配置 corp_id / app_secret
 *   2. wecom_config.expense_payment_template_id 已填写"费用支付申请"模板 ID
 *      （在 WecomManager 页面"费用支付申请配置"卡片填写后保存）
 *
 * 用法：
 *   cd /opt/food-purchase/backend
 *   node scripts/sync_expense_approvals_full.js
 *   # 指定起始时间（默认 2 年前）
 *   node scripts/sync_expense_approvals_full.js --start=2024-01-01
 *
 * 注意：脚本不进 deploy.yml 自动执行，只在服务器手动跑一次
 */

// 先加载 .env（生产环境凭证），必须在 require('../db') 之前
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db');
const expenseApprovals = require('../routes/expense-approvals');
const { getWecomConfig } = require('../routes/wecom');

// ============================================================
// 参数解析
// ============================================================
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('\n🔄 费用支付审批历史 — 首次全量同步');
  console.log('═'.repeat(70));

  const args = parseArgs();

  // 1. 读配置
  const config = await getWecomConfig();
  if (!config || !config.corp_id || !config.app_secret) {
    console.error('❌ 请先在 WecomManager 配置企业微信应用（corp_id / app_secret）');
    process.exit(1);
  }
  const templateId = config.expense_payment_template_id;
  if (!templateId) {
    console.error('❌ 请先在 WecomManager 配置"费用支付申请模板ID"');
    process.exit(1);
  }
  console.log(`✅ 企微配置已加载`);
  console.log(`   模板ID: ${templateId}`);

  // 2. 计算时间范围
  //    默认从 2 年前到现在，或 --start=YYYY-MM-DD 指定
  const now = Math.floor(Date.now() / 1000);
  let startTimestamp;
  if (args.start) {
    startTimestamp = Math.floor(new Date(args.start + 'T00:00:00+08:00').getTime() / 1000);
    if (isNaN(startTimestamp)) {
      console.error(`❌ --start 参数格式错误，应为 YYYY-MM-DD`);
      process.exit(1);
    }
  } else {
    // 默认 2 年前
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    startTimestamp = Math.floor(twoYearsAgo.getTime() / 1000);
  }
  console.log(`   时间范围: ${new Date(startTimestamp * 1000).toISOString()} → ${new Date(now * 1000).toISOString()}`);

  // 3. 检查已有数据
  const [existing] = await pool.query(
    'SELECT COUNT(*) AS cnt, MAX(last_synced_at) AS last_synced FROM wecom_expense_approvals'
  );
  console.log(`   已有数据: ${existing[0].cnt} 条，最后同步: ${existing[0].last_synced || '无'}`);
  if (existing[0].cnt > 0) {
    console.log('   ⚠️  已有数据，将幂等更新（INSERT ... ON DUPLICATE KEY UPDATE）');
  }

  console.log('\n' + '─'.repeat(70));

  // 4. 按 31 天切片同步
  const SLICE_DAYS = 31;
  const SLICE_SECONDS = SLICE_DAYS * 86400;
  let totalSynced = 0;
  let totalFailed = 0;
  let totalErrors = [];
  let sliceIndex = 0;

  for (let cursor = startTimestamp; cursor < now; cursor += SLICE_SECONDS) {
    sliceIndex++;
    const sliceEnd = Math.min(cursor + SLICE_SECONDS, now);
    const sliceStartStr = new Date(cursor * 1000).toISOString().slice(0, 10);
    const sliceEndStr = new Date(sliceEnd * 1000).toISOString().slice(0, 10);

    console.log(`\n📦 切片 ${sliceIndex}: ${sliceStartStr} ~ ${sliceEndStr}`);

    const result = await expenseApprovals.syncRange(config, cursor, sliceEnd, templateId, {
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) {
          console.log(`   进度: ${done}/${total} 已同步`);
        }
      },
    });

    totalSynced += result.synced;
    totalFailed += result.failed;
    totalErrors.push(...result.errors);
    console.log(`   切片完成: 同步 ${result.synced} 条, 失败 ${result.failed} 条`);
  }

  // 5. 总结
  console.log('\n' + '═'.repeat(70));
  console.log('✅ 全量同步完成');
  console.log(`   总同步: ${totalSynced} 条`);
  console.log(`   总失败: ${totalFailed} 条`);
  if (totalErrors.length > 0) {
    console.log(`   错误详情（前 10 条）:`);
    totalErrors.slice(0, 10).forEach((e, i) => console.log(`   ${i + 1}. ${e}`));
  }

  // 6. 验证落库数据
  const [verify] = await pool.query(
    `SELECT sp_status, sp_status_name, COUNT(*) AS cnt
     FROM wecom_expense_approvals
     GROUP BY sp_status, sp_status_name
     ORDER BY sp_status`
  );
  console.log('\n📊 落库数据按状态统计:');
  verify.forEach(r => console.log(`   ${r.sp_status_name}: ${r.cnt} 条`));

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ 全量同步失败:', err.message);
  console.error(err.stack);
  process.exit(1);
});
