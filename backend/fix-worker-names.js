#!/usr/bin/env node
/**
 * 同步外请人员姓名到打卡记录
 * 将 checkin_records 中的 user_name 更新为 temp_worker_users 中的最新姓名
 */

const pool = require('./db');

async function fixWorkerNames() {
  console.log('\n🔧 同步外请人员姓名到打卡记录\n');
  console.log('═'.repeat(60));

  let conn;
  try {
    conn = await pool.getConnection();

    // 备份
    console.log('📦 步骤1：备份打卡记录表...');
    await conn.query('DROP TABLE IF EXISTS checkin_records_backup_names');
    await conn.query('CREATE TABLE checkin_records_backup_names AS SELECT * FROM checkin_records');
    console.log('   ✅ 备份完成\n');

    // 查看需要同步的记录
    console.log('🔍 步骤2：查找姓名不一致的记录...');
    const [mismatches] = await conn.query(`
      SELECT 
        cr.id as record_id,
        cr.user_id,
        cr.user_name as record_name,
        twu.name as worker_name,
        cr.checkin_date,
        cr.checkin_time,
        cr.position_name
      FROM checkin_records cr
      JOIN temp_worker_users twu ON cr.user_source = 'temp' AND cr.user_id = twu.id
      WHERE cr.user_name != twu.name
      ORDER BY cr.checkin_date DESC, cr.checkin_time DESC
    `);

    console.log(`   发现 ${mismatches.length} 条记录姓名不一致：`);
    mismatches.forEach(m => {
      console.log(`     [${m.record_id}] ${m.record_name} → ${m.worker_name} | ${m.checkin_date} ${m.checkin_time}`);
    });
    console.log('');

    // 同步姓名
    console.log('🔄 步骤3：同步姓名...');
    const [result] = await conn.query(`
      UPDATE checkin_records cr
      JOIN temp_worker_users twu ON cr.user_source = 'temp' AND cr.user_id = twu.id
      SET cr.user_name = twu.name
      WHERE cr.user_name != twu.name
    `);

    console.log(`   ✅ 更新了 ${result.affectedRows} 条记录\n`);

    // 验证结果
    console.log('✅ 步骤4：验证结果...');
    const [remaining] = await conn.query(`
      SELECT COUNT(*) as cnt
      FROM checkin_records cr
      JOIN temp_worker_users twu ON cr.user_source = 'temp' AND cr.user_id = twu.id
      WHERE cr.user_name != twu.name
    `);
    console.log(`   剩余不一致记录：${remaining[0].cnt} 条\n`);

    console.log('═'.repeat(60));
    console.log('✅ 同步完成！\n');

  } catch (err) {
    console.error('\n❌ 同步失败：', err.message);
    console.error(err.stack);
  } finally {
    if (conn) conn.release();
  }
}

fixWorkerNames().then(() => process.exit(0)).catch(() => process.exit(0));
