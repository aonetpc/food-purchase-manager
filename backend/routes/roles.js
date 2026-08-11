const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/rbac');
const { logOperation } = require('../middleware/logger');

/**
 * 系统内置角色定义（缺失时自动补齐）
 * 每个角色: { code, name, description, sortOrder }
 */
const SYSTEM_ROLES = [
  { code: 'admin',          name: '管理员',     description: '系统管理员，拥有所有权限',                     sortOrder: 1 },
  { code: 'boss',           name: '董事长',     description: '高层管理人员，可查看全部报表',                 sortOrder: 2 },
  { code: 'finance',        name: '财务',       description: '财务人员，可查看月度分析报表',                 sortOrder: 3 },
  { code: 'viewer',         name: '食材查询',   description: '普通查看权限',                               sortOrder: 4 },
  { code: 'booker',         name: '预订员',     description: '预订调度模块操作员，可创建/编辑/提交订单',     sortOrder: 5 },
  { code: 'sales',          name: '销售员',     description: '销售业务员，仅可查看预订订单',                 sortOrder: 6 },
  { code: 'purchaser',      name: '采购员',     description: '仓库采购：创建采购单、录入收货',               sortOrder: 7 },
  { code: 'temp_auditor',   name: '审核员',     description: '审核外请人员打卡记录，可分配岗位、补录、考核', sortOrder: 8 },
  { code: 'temp_chairman',  name: '外请董事长', description: '外请模块外请人工看板（只读）',                 sortOrder: 9 },
  { code: 'warehouse',      name: '仓库管理员', description: '负责部门仓库的查询、管理',                     sortOrder: 10 },
];

/**
 * 确保系统内置角色存在（幂等）
 * 在获取角色列表前自动补齐缺失的内置角色
 * 使用 INSERT IGNORE + code 唯一约束天然幂等，不依赖 UUID() 函数
 */
async function ensureSystemRoles() {
  for (const role of SYSTEM_ROLES) {
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
      await pool.query(
        'INSERT IGNORE INTO roles (id, code, name, description, is_system, sort_order) VALUES (?, ?, ?, ?, 1, ?)',
        [id, role.code, role.name, role.description, role.sortOrder]
      );
    } catch (e) {
      console.error('[ensureSystemRoles] failed for', role.code, e.message);
      // 单个角色失败不影响其他角色和主流程
    }
  }
}

/**
 * 获取所有角色列表
 * GET /api/roles
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    // 自动补齐缺失的系统内置角色
    await ensureSystemRoles();

    const [rows] = await pool.query(
      'SELECT id, code, name, description, is_system, sort_order FROM roles ORDER BY sort_order ASC'
    );

    // 查每个角色的用户数（仅统计启用的用户，与销售员选择器口径一致）
    // 使用 UNION DISTINCT 合并 user_roles（多角色）和 users.role_id（旧单角色）两处来源，
    // 避免同一用户在两处都有时被双重计数
    const [countRows] = await pool.query(`
      SELECT t.role_id, COUNT(DISTINCT t.user_id) AS user_count
      FROM (
        SELECT ur.role_id, ur.user_id
        FROM user_roles ur
        INNER JOIN users u ON u.id = ur.user_id
        WHERE u.status = 1

        UNION DISTINCT

        SELECT u.role_id, u.id AS user_id
        FROM users u
        WHERE u.role_id IS NOT NULL AND u.status = 1
      ) t
      GROUP BY t.role_id
    `);
    const countMap = {};
    countRows.forEach(c => { countMap[c.role_id] = c.user_count; });

    const result = rows.map(r => ({
      ...r,
      user_count: countMap[r.id] || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('getRoles error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 获取角色的权限列表
 * GET /api/roles/:id/permissions
 */
router.get('/:id/permissions', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const [permRows] = await pool.query(`
      SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.parent_id, p.module_id, p.sort_order,
             m.code as module_code, m.name as module_name
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN modules m ON p.module_id = m.id
      WHERE rp.role_id = ? AND p.status = 1 AND m.status = 1
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `, [id]);

    res.json(permRows);
  } catch (err) {
    console.error('getRolePermissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 更新角色的权限
 * PUT /api/roles/:id/permissions
 * body: { permissionIds: [...] }
 */
router.put('/:id/permissions', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { permissionIds } = req.body;

    // admin 角色不可修改权限
    const [roleRows] = await conn.query('SELECT code, is_system FROM roles WHERE id = ?', [id]);
    if (roleRows.length === 0) {
      conn.release();
      return res.status(404).json({ error: '角色不存在' });
    }
    if (roleRows[0].code === 'admin') {
      conn.release();
      return res.status(403).json({ error: '管理员角色权限不可修改' });
    }

    await conn.beginTransaction();

    // 清空旧权限
    await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);

    // 插入新权限
    if (permissionIds && permissionIds.length > 0) {
      const values = permissionIds.map(pid => [Date.now().toString(36) + Math.random().toString(36).substr(2), id, pid]);
      await conn.query('INSERT INTO role_permissions (id, role_id, permission_id) VALUES ?', [values]);
    }

    await conn.commit();

    await logOperation(req.user.id, id, 'role', 'update_permissions', {
      role_code: roleRows[0].code,
      permission_count: permissionIds ? permissionIds.length : 0
    }, req);

    res.json({ success: true, message: '权限更新成功' });
  } catch (err) {
    await conn.rollback();
    console.error('updateRolePermissions error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 新增角色
 * POST /api/roles
 * body: { code, name, description }
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { code, name, description } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: '角色编码和名称为必填项' });
    }

    const [existRows] = await pool.query('SELECT id FROM roles WHERE code = ?', [code]);
    if (existRows.length > 0) {
      return res.status(400).json({ error: '角色编码已存在' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    await pool.query(
      'INSERT INTO roles (id, code, name, description, is_system, sort_order) VALUES (?, ?, ?, ?, 0, 99)',
      [id, code, name, description || '']
    );

    await logOperation(req.user.id, id, 'role', 'create', { code, name }, req);

    res.json({ success: true, id, message: '角色创建成功' });
  } catch (err) {
    console.error('createRole error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 编辑角色
 * PUT /api/roles/:id
 * body: { name, description }
 */
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const [roleRows] = await pool.query('SELECT code, is_system FROM roles WHERE id = ?', [id]);
    if (roleRows.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }
    if (roleRows[0].code === 'admin') {
      return res.status(403).json({ error: '管理员角色不可修改' });
    }

    await pool.query('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name, description || '', id]);

    await logOperation(req.user.id, id, 'role', 'update', { name, description }, req);

    res.json({ success: true, message: '角色更新成功' });
  } catch (err) {
    console.error('updateRole error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 删除角色
 * DELETE /api/roles/:id
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const [roleRows] = await pool.query('SELECT code, is_system FROM roles WHERE id = ?', [id]);
    if (roleRows.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }
    if (roleRows[0].is_system === 1) {
      return res.status(403).json({ error: '系统内置角色不可删除' });
    }

    // 检查是否有用户在使用此角色
    const [userCountRows] = await pool.query(`
      SELECT COUNT(DISTINCT user_id) AS cnt FROM user_roles WHERE role_id = ?
      UNION ALL
      SELECT COUNT(*) AS cnt FROM users WHERE role_id = ?
    `, [id, id]);
    const totalUsers = userCountRows.reduce((sum, r) => sum + r.cnt, 0);
    if (totalUsers > 0) {
      return res.status(400).json({ error: `该角色下还有 ${totalUsers} 个用户，无法删除` });
    }

    await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);
    await pool.query('DELETE FROM roles WHERE id = ?', [id]);

    await logOperation(req.user.id, id, 'role', 'delete', { code: roleRows[0].code }, req);

    res.json({ success: true, message: '角色删除成功' });
  } catch (err) {
    console.error('deleteRole error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 获取用户的多角色列表
 * GET /api/roles/user/:userId
 */
router.get('/user/:userId', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    const [rows] = await pool.query(`
      SELECT r.id, r.code, r.name, r.is_system
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ?
      ORDER BY r.sort_order ASC
    `, [userId]);

    // 也查 users.role_id（兼容旧数据）
    const [userRows] = await pool.query('SELECT role_id FROM users WHERE id = ?', [userId]);
    if (userRows.length > 0 && userRows[0].role_id) {
      const [singleRoleRows] = await pool.query(`
        SELECT r.id, r.code, r.name, r.is_system
        FROM roles r
        WHERE r.id = ? AND r.id NOT IN (
          SELECT role_id FROM user_roles WHERE user_id = ?
        )
      `, [userRows[0].role_id, userId]);
      rows.push(...singleRoleRows);
    }

    res.json(rows);
  } catch (err) {
    console.error('getUserRoles error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 更新用户的多角色
 * PUT /api/roles/user/:userId
 * body: { roleIds: [...] }
 */
router.put('/user/:userId', requireAuth, requireRole('admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { userId } = req.params;
    const { roleIds } = req.body;

    // 不能移除自己的 admin 角色
    if (userId === req.user.id) {
      const [adminCheck] = await conn.query(`
        SELECT COUNT(*) as cnt FROM (
          SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ? AND r.code = 'admin'
          UNION
          SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'
        ) t
      `, [userId, userId]);
      if (adminCheck[0].cnt > 0 && (!roleIds || roleIds.length === 0)) {
        conn.release();
        return res.status(400).json({ error: '不能移除当前管理员的所有角色' });
      }
    }

    await conn.beginTransaction();

    // 清空旧的多角色关联
    await conn.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);

    // 插入新的角色关联
    if (roleIds && roleIds.length > 0) {
      const values = roleIds.map(rid => [Date.now().toString(36) + Math.random().toString(36).substr(2), userId, rid]);
      await conn.query('INSERT INTO user_roles (id, user_id, role_id) VALUES ?', [values]);
    }

    // 同步更新 users.role / role_id（取第一个角色作为主角色）
    if (roleIds && roleIds.length > 0) {
      const [primaryRole] = await conn.query('SELECT code FROM roles WHERE id = ?', [roleIds[0]]);
      if (primaryRole.length > 0) {
        await conn.query('UPDATE users SET role_id = ?, role = ? WHERE id = ?', [roleIds[0], primaryRole[0].code, userId]);
      }
    } else {
      await conn.query('UPDATE users SET role_id = NULL, role = NULL WHERE id = ?', [userId]);
    }

    await conn.commit();

    await logOperation(req.user.id, userId, 'user', 'update_roles', { roleIds }, req);

    res.json({ success: true, message: '角色分配成功' });
  } catch (err) {
    await conn.rollback();
    console.error('updateUserRoles error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * 获取所有权限列表（按模块分组，树形结构）
 * GET /api/roles/permissions/all
 */
router.get('/permissions/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.parent_id, p.module_id, p.sort_order, p.status,
             m.code as module_code, m.name as module_name, m.sort_order as module_sort_order
      FROM permissions p
      LEFT JOIN modules m ON p.module_id = m.id
      WHERE p.status = 1 AND (m.status = 1 OR m.status IS NULL)
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `);

    // 按模块分组
    const modules = {};
    rows.forEach(perm => {
      const modCode = perm.module_code || 'other';
      if (!modules[modCode]) {
        modules[modCode] = {
          code: modCode,
          name: perm.module_name || '其他',
          permissions: [],
        };
      }
      modules[modCode].permissions.push({
        id: perm.id,
        code: perm.code,
        name: perm.name,
        type: perm.type,
        path: perm.path,
        icon: perm.icon,
      });
    });

    res.json(Object.values(modules));
  } catch (err) {
    console.error('getAllPermissions error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
