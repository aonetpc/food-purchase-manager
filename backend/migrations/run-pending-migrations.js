#!/usr/bin/env node
/**
 * 单独执行 033 和 036 迁移脚本
 *
 * 用法：
 *   cd /opt/food-purchase/backend
 *   node run-pending-migrations.js
 *
 * 说明：
 *   - 033 添加 user_departments 和 user_confirmations 字段
 *   - 036 添加 reimbursement_error 字段
 *   - 两个脚本都是幂等的（已存在会跳过）
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function runMigrationFile(file) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  文件不存在：${file}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  // 拆分语句
  const statements = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`\n🚀 执行迁移：${file}`);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      console.log(`  ✅ 语句执行成功`);
    } catch (err) {
      // 幂等处理
      if (err.code === 'ER_DUP_FIELD_DATA' || err.errno === 1060) {
        console.log(`  ⚠️  字段已存在，跳过`);
      } else if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        console.log(`  ⚠️  数据已存在，跳过`);
      } else if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.errno === 1091) {
        console.log(`  ⚠️  字段/索引不存在，跳过`);
      } else {
        console.error(`  ❌ 语句执行失败：`, err.message);
        throw err;
      }
    }
  }

  // 检查/记录到 schema_migrations
  const id = file.split('_')[0];
  await pool.query(
    `INSERT IGNORE INTO schema_migrations (id, filename) VALUES (?, ?)`,
    [id, file]
  );
  console.log(`  ✅ ${file} 完成`);
}

async function checkColumn(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return rows[0].cnt > 0;
}

async function main() {
  console.log('\n🔧 检查并补齐缺失的数据库字段\n');
  console.log('═'.repeat(60));

  // 检查 purchase_confirmations 表的字段
  console.log('\n📋 字段检查：');
  console.log(`  user_departments:    ${await checkColumn('purchase_confirmations', 'user_departments') ? '✅ 已存在' : '❌ 缺失'}`);
  console.log(`  user_confirmations:  ${await checkColumn('purchase_confirmations', 'user_confirmations') ? '✅ 已存在' : '❌ 缺失'}`);
  console.log(`  reimbursement_error: ${await checkColumn('purchase_confirmations', 'reimbursement_error') ? '✅ 已存在' : '❌ 缺失'}`);

  // 确保 schema_migrations 表存在
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) PRIMARY KEY,
      filename VARCHAR(200) NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_id (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 执行 033 迁移
  await runMigrationFile('033_purchase_confirmations_add_user_fields.sql');

  // 执行 036 迁移
  await runMigrationFile('036_add_reimbursement_error.sql');

  // 再次检查
  console.log('\n📋 迁移后字段状态：');
  console.log(`  user_departments:    ${await checkColumn('purchase_confirmations', 'user_departments') ? '✅ 已存在' : '❌ 缺失'}`);
  console.log(`  user_confirmations:  ${await checkColumn('purchase_confirmations', 'user_confirmations') ? '✅ 已存在' : '❌ 缺失'}`);
  console.log(`  reimbursement_error: ${await checkColumn('purchase_confirmations', 'reimbursement_error') ? '✅ 已存在' : '❌ 缺失'}`);

  console.log('\n✅ 全部完成！\n');
  await pool.end();
}

main().catch((err) => {
  console.error('\n❌ 执行失败：', err.message);
  console.error(err);
  process.exit(1);
});
