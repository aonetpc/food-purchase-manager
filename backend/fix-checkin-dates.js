#!/usr/bin/env node
/**
 * 修复打卡记录的 UTC 时间为北京时间
 *
 * 问题原因：之前代码使用 new Date().toISOString() 获取时间，
 * 返回的是 UTC 时间（比北京时间少8小时），直接存入了 checkin_time 字段。
 * 例如：北京时间 07-25 07:00 打卡，存储为 07-24 23:00
 *
 * 修复方案：将所有 checkin_time 加8小时，并更新 checkin_date
 *
 * 安全措施：
 * 1. 执行前自动备份
 * 2. 通过 schema_migrations 标记确保只执行一次
 */

const pool = require('./db');
const { getTodayStr } = require('./utils/date');

async function fixCheckinDates() {
  console.log('\n🔧 修复打卡记录 UTC 时间 → 北京时间\n');
  console.log('═'.repeat(60));

  const today = getTodayStr();
  console.log(`今日（北京时间）：${today}\n`);

  let conn;
  try {
    conn = await pool.getConnection();

    // 1. 确保标记表存在
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(100) PRIMARY KEY,
        filename VARCHAR(200) NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 2. 检查是否已修复过
    const [markers] = await conn.query(
      "SELECT id FROM schema_migrations WHERE id = 'fix_utc_dates_20260725'"
    );

    if (markers.length > 0) {
      console.log('✅ UTC 日期修复已执行过，跳过\n');
      return;
    }

    // 3. 备份
    console.log('📦 步骤1：备份数据...');
    await conn.query(
      'CREATE TABLE IF NOT EXISTS checkin_records_backup_20260725 AS SELECT * FROM checkin_records'
    );
    console.log('   ✅ 备份完成：checkin_records_backup_20260725\n');

    // 4. 查询修复前的数据
    console.log('📊 步骤2：修复前数据统计...');
    const [beforeStats] = await conn.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN checkin_time IS NOT NULL THEN 1 ELSE 0 END) as has_time,
        SUM(CASE WHEN checkin_date = ? THEN 1 ELSE 0 END) as today
      FROM checkin_records
    `, [today]);
    console.log(`   总记录数：${beforeStats[0].total}`);
    console.log(`   有打卡时间：${beforeStats[0].has_time}`);
    console.log(`   今日记录：${beforeStats[0].today}\n`);

    // 5. 显示修复前的记录示例
    console.log('📋 修复前记录示例（最多10条）：');
    const [beforeSamples] = await conn.query(`
      SELECT id, user_name, checkin_date, checkin_time, created_at, status
      FROM checkin_records
      WHERE checkin_time IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);
    beforeSamples.forEach(r => {
      console.log(`   ${r.user_name} | 日期:${r.checkin_date} | 时间:${r.checkin_time} | 创建:${r.created_at} | ${r.status}`);
    });
    console.log('');

    // 6. 执行修复
    console.log('🔧 步骤3：修复 UTC 时间 → 北京时间（+8小时）...');

    const [result] = await conn.query(`
      UPDATE checkin_records
      SET
        checkin_date = DATE(DATE_ADD(checkin_time, INTERVAL 8 HOUR)),
        checkin_time = DATE_ADD(checkin_time, INTERVAL 8 HOUR)
      WHERE checkin_time IS NOT NULL
        AND checkin_time != '0000-00-00 00:00:00'
    `);
    console.log(`   ✅ 修复了 ${result.affectedRows} 条记录\n`);

    // 7. 显示修复后的记录
    console.log('📋 修复后记录示例：');
    const [afterSamples] = await conn.query(`
      SELECT id, user_name, checkin_date, checkin_time, created_at, status
      FROM checkin_records
      WHERE checkin_time IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);
    afterSamples.forEach(r => {
      console.log(`   ${r.user_name} | 日期:${r.checkin_date} | 时间:${r.checkin_time} | 创建:${r.created_at} | ${r.status}`);
    });
    console.log('');

    // 8. 修复后统计
    console.log('📊 步骤4：修复后数据统计...');
    const [afterStats] = await conn.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN checkin_date = ? THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM checkin_records
      WHERE checkin_time IS NOT NULL
    `, [today]);
    console.log(`   总记录数：${afterStats[0].total}`);
    console.log(`   今日记录：${afterStats[0].today}`);
    console.log(`   待审核：${afterStats[0].pending}\n`);

    // 9. 标记已执行
    await conn.query(
      "INSERT INTO schema_migrations (id, filename) VALUES ('fix_utc_dates_20260725', 'fix-checkin-dates.js')"
    );

    console.log('═'.repeat(60));
    console.log('✅ 修复完成！\n');

  } catch (err) {
    console.error('\n❌ 修复失败：', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}

fixCheckinDates();
