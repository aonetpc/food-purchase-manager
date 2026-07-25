#!/usr/bin/env node
/**
 * 修复打卡记录数据：
 * 1. 删除重复打卡记录（同一用户同一日期同一小时内多条记录）
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
    await conn.query('DROP TABLE IF EXISTS checkin_records_backup_before_fix');
    await conn.query('CREATE TABLE checkin_records_backup_before_fix AS SELECT * FROM checkin_records');
    console.log('   ✅ 备份完成\n');

    // 2. 查看重复记录情况
    console.log('🔍 步骤2：查看重复记录情况...');
    const [duplicates] = await conn.query(`
      SELECT user_id, user_name, checkin_date, checkin_time, position_name, COUNT(*) as cnt
      FROM checkin_records
      WHERE status = 'pending'
      GROUP BY user_id, checkin_date, DATE_FORMAT(checkin_time, '%H:%i')
      HAVING COUNT(*) > 1
      ORDER BY checkin_date DESC, checkin_time DESC
    `);
    console.log(`   发现 ${duplicates.length} 组重复记录：`);
    duplicates.forEach(d => {
      console.log(`     ${d.user_name} | ${d.checkin_date} ${d.checkin_time} | ${d.position_name} | ${d.cnt}条`);
    });
    console.log('');

    // 3. 删除重复记录（同一用户同一日期同一小时内只保留一条）
    console.log('🗑️ 步骤3：删除重复打卡记录...');
    const [dupResult] = await conn.query(`
      DELETE cr1 FROM checkin_records cr1
      INNER JOIN checkin_records cr2 
        ON cr1.user_id = cr2.user_id 
        AND cr1.checkin_date = cr2.checkin_date 
        AND DATE_FORMAT(cr1.checkin_time, '%H:%i') = DATE_FORMAT(cr2.checkin_time, '%H:%i')
        AND cr1.user_source = cr2.user_source
      WHERE cr1.id > cr2.id
        AND cr1.status = 'pending'
    `);
    console.log(`   ✅ 删除了 ${dupResult.affectedRows} 条重复记录\n`);

    // 4. 再次检查是否还有重复
    const [remainingDups] = await conn.query(`
      SELECT user_id, user_name, checkin_date, checkin_time, COUNT(*) as cnt
      FROM checkin_records
      WHERE status = 'pending'
      GROUP BY user_id, checkin_date, DATE_FORMAT(checkin_time, '%H:%i')
      HAVING COUNT(*) > 1
    `);
    console.log(`   剩余重复记录：${remainingDups.length} 组\n`);

    // 5. 修复UTC时间
    console.log('⌚ 步骤4：修复UTC时间 → 北京时间（+8小时）...');
    const [timeResult] = await conn.query(`
      UPDATE checkin_records
      SET
        checkin_date = DATE(DATE_ADD(checkin_time, INTERVAL 8 HOUR)),
        checkin_time = DATE_ADD(checkin_time, INTERVAL 8 HOUR)
      WHERE checkin_time IS NOT NULL
        AND checkin_time != '0000-00-00 00:00:00'
    `);
    console.log(`   ✅ 修复了 ${timeResult.affectedRows} 条记录的时间\n`);

    // 6. 统计结果
    console.log('📊 步骤5：修复后统计...');
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

    // 7. 今日数据
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
