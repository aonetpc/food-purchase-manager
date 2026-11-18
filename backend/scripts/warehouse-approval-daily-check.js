#!/usr/bin/env node
/**
 * 仓库采购审批 — 每日核对（首期只跑报告模式）
 *
 * 做三件事：
 *   1. 扫描在途单据（采购审批中 / 报销中 / 预付款审批中 / 月结付款待回款）
 *   2. 逐条查询企微审批详情，按统一映射比对本地状态
 *   3. 只输出差异报告：不写业务库、不发通知
 *
 * 用法（服务器手动或由 Gatekeeper 挂 cron，每日一次）：
 *   cd /opt/food-purchase/backend
 *   node scripts/warehouse-approval-daily-check.js
 *
 * 说明：本脚本不进 deploy.yml 自动执行；调度由 Gatekeeper 在部署层配置。
 */

// 先加载 .env（生产环境凭证），必须在 require('../db') 之前
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!process.env.DB_PASSWORD) {
  console.error('[审批每日核对] DB_PASSWORD missing');
  process.exit(1);
}

const { reconcileApprovals } = require('../utils/warehouse-approval-reconcile');

(async () => {
  console.log(`[审批每日核对] 开始 ${new Date().toISOString()}`);
  const result = await reconcileApprovals({ dryRun: true });

  if (!result.ok) {
    console.error(`[审批每日核对] 失败：${result.error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    scanned: result.scanned,
    difference_count: result.difference_count,
    differences: result.differences,
    errors: result.errors,
  }, null, 2));

  console.log(`[审批每日核对] 完成：扫描 ${result.scanned} 条，差异 ${result.difference_count} 条，异常 ${result.errors.length} 条`);
  process.exit(0);
})().catch((err) => {
  console.error('[审批每日核对] 执行异常:', err);
  process.exit(1);
});
