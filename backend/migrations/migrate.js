#!/usr/bin/env node
/**
 * 数据库迁移执行工具
 *
 * 使用方法：
 *   node migrate.js status   - 查看迁移状态
 *   node migrate.js up       - 执行所有未执行的迁移
 *   node migrate.js down     - 回滚最近一次迁移
 *   node migrate.js reset    - 回滚所有迁移（危险操作）
 *   node migrate.js backup   - 备份数据库（生成 SQL 文件）
 *
 * 说明：
 *   - 迁移脚本需放在 migrations 目录下，命名格式：NNN_描述.sql（如 001_init.sql）
 *   - 迁移按文件名排序顺序执行
 *   - 每次执行成功后会记录到 schema_migrations 表
 *   - 建议执行前先 backup
 */

// 先加载 .env（生产环境凭证），必须在 require('../db') 之前
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pool = require('../db');

const MIGRATIONS_DIR = __dirname;

// ================================================
// 工具函数
// ================================================

/**
 * 读取并解析迁移脚本文件
 *
 * 过滤规则：
 *   1. 命名形如 NNN_*.sql（编号支持任意位数，兼容 100/101 及未来 4 位数）
 *   2. 跳过 *_DONE.sql（一次性 DML 已手动执行并收尾）
 *   3. 跳过含 booking_checkup_items / booking_checkup_packages / booking_package_items
 *      的 INSERT/UPDATE/DELETE/REPLACE（移植自原 deploy.yml for 循环的体检/套餐数据保护）
 */
function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith('_DONE.sql'))
    .filter((f) => !containsProtectedDML(f))
    .sort();
}

/**
 * 检测 SQL 文件是否包含对体检/套餐业务数据表的一次性 DML
 * （这类文件如需执行应手动跑一次后改名 _DONE.sql，不能每次部署重跑覆盖用户数据）
 */
function containsProtectedDML(filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf8');
  const pattern =
    /((INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+`?booking_checkup_items`?)|((INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+`?booking_checkup_packages`?)|((INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+`?booking_package_items`?)/i;
  if (pattern.test(content)) {
    console.log(`  ⏭️  跳过（含体检/套餐业务数据 DML，需手动执行后改名 _DONE.sql）: ${filename}`);
    return true;
  }
  return false;
}

/**
 * 从文件名提取迁移编号（如 "001_init_rbac_tables.sql" → "001"）
 */
function getMigrationId(filename) {
  return filename.split('_')[0];
}

/**
 * 确保 schema_migrations 表存在
 */
async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) PRIMARY KEY,
      filename VARCHAR(200) NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_id (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * 获取已执行的迁移列表
 */
async function getExecutedMigrations() {
  const [rows] = await pool.query(
    'SELECT id, filename, executed_at FROM schema_migrations ORDER BY id ASC'
  );
  return rows;
}

/**
 * 执行单个迁移脚本（按分号分割语句逐条执行）
 */
async function executeMigration(filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf8');

  // 移除注释行，按分号分割
  const statements = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (err) {
        // 忽略 "已存在/不存在" 类错误（幂等处理）
        if (err.code === 'ER_DUP_FIELD_DATA' || err.errno === 1060) {
          console.log(`  ⚠️  字段已存在，跳过`);
        } else if (err.code === 'ER_DUP_KEYNAME' || err.errno === 1061) {
          console.log(`  ⚠️  索引/键已存在，跳过`);
        } else if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
          console.log(`  ⚠️  数据已存在，跳过`);
        } else if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.errno === 1050) {
          console.log(`  ⚠️  表已存在，跳过`);
        } else if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.errno === 1091) {
          console.log(`  ⚠️  字段/索引不存在，跳过`);
        } else if (err.code === 'ER_BAD_TABLE_ERROR' || err.errno === 1051) {
          console.log(`  ⚠️  表不存在（DROP），跳过`);
        } else if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) {
          console.log(`  ⚠️  字段不存在（可能已被其他迁移处理），跳过`);
        } else {
          // 非幂等错误：附加文件名、errno、语句预览，便于定位
          const preview = stmt.length > 80 ? stmt.slice(0, 80) + '...' : stmt;
          err.message = `${err.message} | file=${filename} errno=${err.errno || '?'} stmt=${preview}`;
          throw err;
        }
      }
    }

    // 记录迁移
    const migrationId = getMigrationId(filename);
    await conn.query(
      'INSERT INTO schema_migrations (id, filename) VALUES (?, ?)',
      [migrationId, filename]
    );

    await conn.commit();
    console.log(`  ✅ ${filename} 执行成功`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 回滚单个迁移（执行对应的 rollback 脚本，如果存在）
 */
async function rollbackMigration(migration) {
  // 找到对应的回滚脚本（rollback_NNN_to_NNN.sql）
  const id = migration.id;
  const rollbackFile = `rollback_${id}_to_${id}.sql`;

  if (fs.existsSync(path.join(MIGRATIONS_DIR, rollbackFile))) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, rollbackFile), 'utf8');
    const statements = content
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of statements) {
        try {
          await conn.query(stmt);
        } catch (err) {
          // 忽略不存在错误
          if (err.errno === 1051 || err.errno === 1091) {
            continue;
          }
          throw err;
        }
      }
      await conn.query('DELETE FROM schema_migrations WHERE id = ?', [id]);
      await conn.commit();
      console.log(`  ✅ 回滚 ${migration.filename} 成功`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } else {
    // 没有单独回滚脚本，只删除迁移记录
    await pool.query('DELETE FROM schema_migrations WHERE id = ?', [id]);
    console.log(`  ⚠️  无独立回滚脚本，仅删除迁移记录：${migration.filename}`);
    console.log(`     如需完全回滚，请执行：rollback_001_to_006.sql`);
  }
}

// ================================================
// 命令处理
// ================================================

/**
 * 查看迁移状态
 */
async function status() {
  await ensureMigrationsTable();
  const files = getMigrationFiles();
  const executed = await getExecutedMigrations();
  const executedIds = new Set(executed.map((m) => m.id));

  console.log('\n📋 迁移状态：');
  console.log('─'.repeat(70));
  console.log('编号  状态    文件名');
  console.log('─'.repeat(70));

  for (const file of files) {
    const id = getMigrationId(file);
    const isExecuted = executedIds.has(id);
    const status = isExecuted ? '✅ 已执行' : '⏳ 待执行';
    console.log(`${id}   ${status}   ${file}`);
  }

  console.log('─'.repeat(70));
  console.log(`总计：${files.length} 个迁移，已执行 ${executed.length} 个\n`);
}

/**
 * 执行所有未执行的迁移
 */
async function up() {
  await ensureMigrationsTable();
  const files = getMigrationFiles();
  const executed = await getExecutedMigrations();
  const executedIds = new Set(executed.map((m) => m.id));

  const pending = files.filter((f) => !executedIds.has(getMigrationId(f)));

  if (pending.length === 0) {
    console.log('\n✅ 所有迁移均已执行，无需操作\n');
    return;
  }

  console.log(`\n🚀 开始执行 ${pending.length} 个迁移...\n`);

  for (const file of pending) {
    try {
      await executeMigration(file);
    } catch (err) {
      console.error(`\n❌ 迁移失败：${file}`);
      console.error(`   错误：${err.message}\n`);
      console.error('💡 建议：');
      console.error('   1. 使用备份恢复：mysql -u food_purchase -p food_purchase < backup_YYYYMMDD.sql');
      console.error('   2. 修复迁移脚本后重试');
      process.exit(1);
    }
  }

  console.log(`\n✅ 全部迁移执行完成\n`);
}

/**
 * 回滚最近一次迁移
 */
async function down() {
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();

  if (executed.length === 0) {
    console.log('\n⚠️  没有可回滚的迁移\n');
    return;
  }

  const last = executed[executed.length - 1];
  console.log(`\n⏪ 开始回滚最近一次迁移：${last.filename}\n`);
  await rollbackMigration(last);
  console.log(`\n✅ 回滚完成\n`);
}

/**
 * 回滚所有迁移（危险操作）
 */
async function reset() {
  console.log('\n⚠️  警告：即将回滚所有迁移！这会删除所有 RBAC 相关表！');
  console.log('   建议优先使用备份恢复：mysql -u food_purchase -p food_purchase < backup_YYYYMMDD.sql');
  console.log('   5秒后开始执行（Ctrl+C 取消）...\n');

  await new Promise((resolve) => setTimeout(resolve, 5000));

  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();

  for (const migration of executed.reverse()) {
    await rollbackMigration(migration);
  }

  console.log(`\n✅ 全部回滚完成\n`);
}

/**
 * 备份数据库（生成 SQL 文件）
 */
async function backup() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .split('.')[0];
  const backupFile = path.join(MIGRATIONS_DIR, `backup_${timestamp}.sql`);

  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'food_purchase',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'food_purchase',
  };

  if (!dbConfig.password) {
    console.error('\n❌ 备份失败：DB_PASSWORD 环境变量未设置\n');
    process.exit(1);
  }

  const cmd = `mysqldump -h ${dbConfig.host} -u ${dbConfig.user} -p${dbConfig.password} ${dbConfig.database} > ${backupFile}`;

  console.log(`\n💾 开始备份数据库...`);
  console.log(`   文件：${backupFile}\n`);

  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`\n✅ 备份成功：${backupFile}\n`);
  } catch (err) {
    console.error(`\n❌ 备份失败：${err.message}\n`);
    process.exit(1);
  }
}

// ================================================
// 主入口
// ================================================

async function main() {
  const command = process.argv[2] || 'status';

  console.log(`\n🔧 食材采购管理系统 - 数据库迁移工具`);
  console.log('═'.repeat(70));

  try {
    switch (command) {
      case 'status':
        await status();
        break;
      case 'up':
        await up();
        break;
      case 'down':
        await down();
        break;
      case 'reset':
        await reset();
        break;
      case 'backup':
        await backup();
        break;
      default:
        console.log(`\n❓ 未知命令：${command}\n`);
        console.log('使用方法：');
        console.log('  node migrate.js status   - 查看迁移状态');
        console.log('  node migrate.js up       - 执行所有未执行的迁移');
        console.log('  node migrate.js down     - 回滚最近一次迁移');
        console.log('  node migrate.js reset    - 回滚所有迁移（危险）');
        console.log('  node migrate.js backup   - 备份数据库\n');
        break;
    }
  } catch (err) {
    console.error(`\n❌ 执行失败：${err.message}\n`);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
