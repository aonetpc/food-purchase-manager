#!/usr/bin/env node
/**
 * schema_migrations 回填脚本
 *
 * 背景：
 *   010 之后的迁移从未通过 migrate.js up 执行（旧版 deploy.yml for 循环或手工执行），
 *   导致 schema_migrations 表只有 001-009 的记录，010-107 全部显示为"待执行"。
 *   每次部署 migrate.js up 都会尝试重跑这些旧迁移，浪费时间且有潜在风险。
 *
 * 作用：
 *   将 010-107 的迁移文件回填到 schema_migrations 表（INSERT IGNORE，幂等），
 *   使 migrate.js up 只执行真正新增的迁移（108 及以后）。
 *
 * 安全：
 *   - 只 INSERT schema_migrations 表，不修改任何业务表
 *   - 不回填 108（它需要 migrate.js 正常执行）
 *   - 重复执行安全（INSERT IGNORE）
 *
 * 用法：
 *   cd /opt/food-purchase/backend
 *   node scripts/backfill-schema-migrations.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// 只回填 010-107（108 及以后留给 migrate.js 正常执行）
const BACKFILL_MAX_ID = 107;

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith('_DONE.sql'))
    .sort();
}

function getMigrationId(filename) {
  return filename.split('_')[0];
}

async function backfill() {
  console.log('\n📥 schema_migrations 回填脚本');
  console.log('═'.repeat(70));

  let conn;
  try {
    conn = await pool.getConnection();
    console.log('✅ 数据库连接成功\n');

    // 确保 schema_migrations 表存在
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(100) PRIMARY KEY,
        filename VARCHAR(200) NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_id (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const files = getMigrationFiles();
    const toBackfill = files.filter((f) => {
      const id = parseInt(getMigrationId(f), 10);
      return id >= 10 && id <= BACKFILL_MAX_ID;
    });

    console.log(`📋 待回填迁移文件数: ${toBackfill.length}（010-${BACKFILL_MAX_ID}）`);
    console.log('─'.repeat(70));

    let inserted = 0;
    let skipped = 0;

    for (const file of toBackfill) {
      const id = getMigrationId(file);
      try {
        const [result] = await conn.query(
          'INSERT IGNORE INTO schema_migrations (id, filename) VALUES (?, ?)',
          [id, file]
        );
        if (result.affectedRows > 0) {
          console.log(`  ✅ ${id}  ${file}`);
          inserted++;
        } else {
          console.log(`  ⏭️  ${id}  ${file}（已存在，跳过）`);
          skipped++;
        }
      } catch (err) {
        console.log(`  ❌ ${id}  ${file}  失败: errno=${err.errno} ${err.message}`);
      }
    }

    console.log('─'.repeat(70));
    console.log(`📊 回填完成：新增 ${inserted} 条，跳过 ${skipped} 条（已存在）\n`);

    // 验证
    const [rows] = await conn.query(
      'SELECT id, filename FROM schema_migrations ORDER BY id ASC'
    );
    console.log(`📋 schema_migrations 当前共 ${rows.length} 条记录:`);
    rows.forEach((r) => console.log(`   ${r.id}  ${r.filename}`));

    console.log(`\n✅ 回填完成。下次 migrate.js up 只会执行 108 及以后的迁移。\n`);
  } catch (err) {
    console.error(`\n❌ 回填失败: ${err.message}\n`);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

backfill();
