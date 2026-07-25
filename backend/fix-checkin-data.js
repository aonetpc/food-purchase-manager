#!/usr/bin/env node
/**
 * 修复打卡记录数据：
 * 1. 删除重复打卡记录（同一用户同一时间同一岗位多条记录）
 * 2. 修复UTC时间为北京时间（+8小时）
 */

const pool = require('./db');

async function fixCheckinData() {
  console.log('\n🔧 修复打卡记录数据\n');
  console.log('═'.repeat(60));

  let conn;
  try {
    conn = await pool.getConnection();

    // 1. 备份
    console.log('📦 步骤1：备份数据...');
    await conn.query(
      'DROP TABLE IF EXISTS checkin_records_backup_before_fix'
    );
    await conn.query(
      'CREATE TABLE checkin_records_backup_before_fix AS SELECT * FROM checkin_records'
    );
    console.log('   ✅ 备份完成\n');

    // 2. 删除重复记录
    console.log('🗑️ 步骤2：删除重复打卡记录...');
    const [dupResult] = await conn.query(`
      DELETE cr1 FROM checkin_records cr1
      INNER JOIN checkin_records cr2 
        ON cr1.user_id = cr2.user_id 
        AND cr1.checkin_date = cr2.checkin_date 
        AND cr1.checkin_time = cr2.checkin_time
        AND cr1.position_id = cr2.position_id
      WHERE cr1.id > cr2.id
    `);
    console.log(`   ✅ 删除了 ${dupResult.affectedRows} 条重复记录\n`);

    // 3. 修复UTC时间
    console.log('⌚ 步骤3：修复UTC时间 → 北京时间（+8小时）...');
    const [timeResult] = await conn.query(`
      UPDATE checkin_records
      SET
        checkin_date = DATE(DATE_ADD(checkin_time, INTERVAL 8 HOUR)),
        checkin_time = DATE_ADD(checkin_time, INTERVAL 8 HOUR)
      WHERE checkin_time IS NOT NULL
        AND checkin_time != '0000-00-00 00:00:00'
        AND TIME(checkin_time) >= '16:00:00'
    `);
    console.log(`   ✅ 修复了 ${timeResult.affectedRows} 条记录的时间\n`);

    // 4. 统计结果
    console.log('📊 步骤4：修复后统计...');
    const [stats] = await conn.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM checkin_records
    `);
    console.log(`   总记录数：${stats[0].total}`);
    console.log(`   待审核：${stats[0].pending}`);
    console.log(`   已通过：${stats[0].approved}`);
    console.log(`   已驳回：${stats[0].rejected}\n`);

    // 5. 今日数据
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [todayStats] = await conn.query(`
      SELECT
        COUNT(*) as today_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as today_pending
      FROM checkin_records
      WHERE checkin_date = ?
    `, [todayStr]);
    console.log(`   今日打卡：${todayStats[0].today_count}`);
    console.log(`   今日待审核：${todayStats[0].today_pending}\n`);

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

fixCheckinData();
