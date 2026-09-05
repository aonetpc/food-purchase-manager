#!/usr/bin/env node
/**
 * 体检配单/体检中心菜单权限独立修复脚本
 *
 * 背景：
 *   迁移 108（原 107，改名避编号冲突）通过 migrate.js up 执行，
 *   但 deploy.yml 的 `node migrate.js up 2>&1 || echo "..."` 会吞掉
 *   非零退出码，导致迁移失败时部署继续，问题被静默。
 *   本脚本绕过 migrate.js，直接用 mysql2 逐条执行相同 SQL，
 *   并打印详细日志，方便定位失败原因。
 *
 * 修复内容（与 108_fix_checkup_permissions_and_cleanup.sql 一致）：
 *   1. 新增 menu:checkup-center 权限，module_id='booking-board'
 *   2. 修正 menu:checkup-templates 的 module_id='booking-board'
 *   3. 删除"预订调度"脏数据（name='预订调度' AND code<>'menu:booking-board'）
 *   4. 确保 menu:booking-board 的 module_id='booking-board'
 *   5. 角色分配双保险：
 *      5a. admin/booker 角色直接分配 menu:checkup-center
 *      5b. 凡拥有 menu:permission 的角色，自动补齐 3 个体检相关菜单
 *
 * 幂等：可重复执行，不会产生重复数据
 *
 * 用法：
 *   cd /opt/food-purchase/backend
 *   node scripts/fix-checkup-permissions.js
 */

// 先加载 .env（生产环境凭证），必须在 require('../db') 之前
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../db');

async function fixCheckupPermissions() {
  console.log('\n🔧 体检配单/体检中心菜单权限独立修复脚本');
  console.log('═'.repeat(70));

  let conn;
  try {
    conn = await pool.getConnection();
    console.log('✅ 数据库连接成功\n');

    // ================================================
    // 0. 修复前状态检查
    // ================================================
    console.log('🔍 步骤0：修复前状态检查');
    console.log('─'.repeat(70));

    const [beforeMenus] = await conn.query(`
      SELECT code, name, module_id, path, status
      FROM permissions
      WHERE code IN ('menu:booking-board', 'menu:checkup-templates', 'menu:checkup-center')
      ORDER BY code
    `);
    console.log('  当前体检相关菜单权限:');
    if (beforeMenus.length === 0) {
      console.log('    (无)');
    } else {
      beforeMenus.forEach(m => {
        console.log(`    ${m.code} | ${m.name} | module=${m.module_id} | status=${m.status}`);
      });
    }

    const [beforeDup] = await conn.query(`
      SELECT id, code, name, module_id FROM permissions WHERE name = '预订调度'
    `);
    console.log(`\n  name='预订调度' 的记录数: ${beforeDup.length}`);
    beforeDup.forEach(d => {
      console.log(`    id=${d.id} | code=${d.code} | module=${d.module_id}`);
    });
    console.log('');

    // ================================================
    // 1. 新增 menu:checkup-center（体检中心）权限
    // ================================================
    console.log('📝 步骤1：新增 menu:checkup-center（体检中心）权限');
    console.log('─'.repeat(70));

    try {
      await conn.query(`
        INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
        SELECT UUID(), 'booking-board', 'menu:checkup-center', '体检中心', 'menu', NULL, '/checkup-center', 'ClipboardList', 2, 1
      `);
      console.log('  ✅ INSERT IGNORE 完成');
    } catch (err) {
      console.log(`  ⚠️ INSERT 失败（可能已存在）: errno=${err.errno} ${err.message}`);
    }

    // 已存在则补正
    const [update1Result] = await conn.query(`
      UPDATE permissions
      SET module_id = 'booking-board',
          name = '体检中心',
          path = '/checkup-center',
          icon = 'ClipboardList',
          status = 1,
          type = 'menu'
      WHERE code = 'menu:checkup-center'
    `);
    console.log(`  ✅ UPDATE 补正完成，影响行数: ${update1Result.affectedRows}`);
    console.log('');

    // ================================================
    // 2. 新增/修正 menu:checkup-templates（体检配单）权限
    //    注意：103 迁移可能没跑，permissions 表里可能根本没有这条记录，
    //    只 UPDATE 不 INSERT 会导致体检配单菜单缺失。
    // ================================================
    console.log('📝 步骤2：新增/修正 menu:checkup-templates（体检配单）权限');
    console.log('─'.repeat(70));

    try {
      await conn.query(`
        INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
        SELECT UUID(), 'booking-board', 'menu:checkup-templates', '体检配单', 'menu', NULL, '/checkup-templates', 'ClipboardCheck', 3, 1
      `);
      console.log('  ✅ INSERT IGNORE menu:checkup-templates 完成');
    } catch (err) {
      console.log(`  ⚠️ INSERT 失败（可能已存在）: errno=${err.errno} ${err.message}`);
    }

    // 已存在则补正（module_id/name/path/icon/status 全字段对齐）
    const [update2Result] = await conn.query(`
      UPDATE permissions
      SET module_id = 'booking-board',
          name = '体检配单',
          path = '/checkup-templates',
          icon = 'ClipboardCheck',
          status = 1,
          type = 'menu'
      WHERE code = 'menu:checkup-templates'
    `);
    console.log(`  ✅ UPDATE 补正完成，影响行数: ${update2Result.affectedRows}`);
    console.log('');

    // ================================================
    // 3. 删除"预订调度"脏数据
    // ================================================
    console.log('🗑️  步骤3：删除"预订调度"脏数据（name=预订调度 AND code<>menu:booking-board）');
    console.log('─'.repeat(70));

    const [deleteResult] = await conn.query(`
      DELETE FROM permissions
      WHERE name = '预订调度' AND code <> 'menu:booking-board'
    `);
    console.log(`  ✅ DELETE 完成，删除行数: ${deleteResult.affectedRows}`);
    console.log('');

    // ================================================
    // 4. 确保 menu:booking-board 存在且 module_id='booking-board'
    //    （与步骤1/2统一模式：INSERT IGNORE + UPDATE 补正，防止记录不存在）
    // ================================================
    console.log('📝 步骤4：确保 menu:booking-board 存在且 module_id 正确');
    console.log('─'.repeat(70));

    try {
      await conn.query(`
        INSERT IGNORE INTO permissions (id, module_id, code, name, type, parent_id, path, icon, sort_order, status)
        SELECT UUID(), 'booking-board', 'menu:booking-board', '预订调度', 'menu', NULL, '/booking-board', 'Calendar', 1, 1
      `);
      console.log('  ✅ INSERT IGNORE menu:booking-board 完成');
    } catch (err) {
      console.log(`  ⚠️ INSERT 失败（可能已存在）: errno=${err.errno} ${err.message}`);
    }

    const [update4Result] = await conn.query(`
      UPDATE permissions
      SET module_id = 'booking-board',
          name = '预订调度',
          path = '/booking-board',
          icon = 'Calendar',
          status = 1,
          type = 'menu'
      WHERE code = 'menu:booking-board'
    `);
    console.log(`  ✅ UPDATE 补正完成，影响行数: ${update4Result.affectedRows}`);
    console.log('');

    // ================================================
    // 5a. admin/booker 角色直接分配 menu:checkup-center
    // ================================================
    console.log('👥 步骤5a：admin/booker 角色分配 menu:checkup-center');
    console.log('─'.repeat(70));

    const [insert5aResult] = await conn.query(`
      INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
      SELECT UUID(), r.id, p.id
      FROM roles r
      JOIN permissions p ON p.code = 'menu:checkup-center'
      WHERE r.code IN ('admin', 'booker')
    `);
    console.log(`  ✅ INSERT IGNORE 完成，插入行数: ${insert5aResult.affectedRows}`);
    console.log('');

    // ================================================
    // 5b. 凡拥有 menu:permission 的角色，自动补齐 3 个体检相关菜单
    // ================================================
    console.log('👥 步骤5b：拥有 menu:permission 的角色自动补齐 3 个体检菜单（双保险）');
    console.log('─'.repeat(70));

    const [insert5bResult] = await conn.query(`
      INSERT IGNORE INTO role_permissions (id, role_id, permission_id)
      SELECT UUID(), r.id, p.id
      FROM roles r
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions pm ON pm.id = rp.permission_id AND pm.code = 'menu:permission'
      JOIN permissions p ON p.code IN ('menu:booking-board', 'menu:checkup-templates', 'menu:checkup-center')
    `);
    console.log(`  ✅ INSERT IGNORE 完成，插入行数: ${insert5bResult.affectedRows}`);
    console.log('');

    // ================================================
    // 6. 修复后状态验证
    // ================================================
    console.log('🔍 步骤6：修复后状态验证');
    console.log('═'.repeat(70));

    const [afterMenus] = await conn.query(`
      SELECT code, name, module_id, path, status
      FROM permissions
      WHERE module_id = 'booking-board' AND type = 'menu'
      ORDER BY sort_order
    `);
    console.log('  booking-board 模块下所有菜单权限:');
    afterMenus.forEach(m => {
      console.log(`    ✅ ${m.code} | ${m.name} | path=${m.path} | status=${m.status}`);
    });

    const [afterDup] = await conn.query(`
      SELECT id, code, name, module_id FROM permissions WHERE name = '预订调度'
    `);
    console.log(`\n  name='预订调度' 的记录数（应只剩 1 条 menu:booking-board）: ${afterDup.length}`);
    afterDup.forEach(d => {
      console.log(`    ${d.code === 'menu:booking-board' ? '✅' : '❌'} code=${d.code} | module=${d.module_id}`);
    });

    const [afterRoles] = await conn.query(`
      SELECT r.code AS role_code, r.name AS role_name, p.code AS perm_code, p.name AS perm_name
      FROM roles r
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.code IN ('menu:booking-board', 'menu:checkup-templates', 'menu:checkup-center')
      ORDER BY r.code, p.code
    `);
    console.log(`\n  各角色拥有体检相关菜单情况 (${afterRoles.length} 条):`);
    afterRoles.forEach(r => {
      console.log(`    ✅ ${r.role_code} (${r.role_name}) → ${r.perm_code} (${r.perm_name})`);
    });

    console.log('\n' + '═'.repeat(70));
    console.log('✅ 修复完成\n');

  } catch (err) {
    console.error('\n❌ 修复失败:');
    console.error(`   错误: ${err.message}`);
    console.error(`   errno: ${err.errno || '?'}`);
    console.error(`   code: ${err.code || '?'}`);
    if (err.sql) {
      console.error(`   SQL: ${err.sql.slice(0, 200)}${err.sql.length > 200 ? '...' : ''}`);
    }
    console.error('\n💡 建议:');
    console.error('   1. 检查 modules 表是否有 id="booking-board" 的记录（外键约束）');
    console.error('   2. 检查 roles 表是否有 code="admin"/"booker" 的角色');
    console.error('   3. 检查 permissions 表是否有 code="menu:permission" 的记录');
    process.exit(1);
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}

fixCheckupPermissions();
