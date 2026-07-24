/**
 * RBAC权限中间件
 * 从数据库动态获取用户权限，支持菜单级、按钮级、API级权限控制
 * 
 * 使用方式：
 * 
 * 1. 登录态校验（所有请求自动校验）
 *    app.use(requireAuth())
 * 
 * 2. 角色权限校验
 *    router.get('/admin', requireRole('admin'), handler)
 * 
 * 3. 权限码校验（更细粒度）
 *    router.get('/users', requirePermission('action:user:manage'), handler)
 * 
 * 4. 获取当前用户权限列表
 *    router.get('/permissions', getUserPermissions, handler)
 */

const pool = require('../db');

/**
 * 登录态校验中间件
 * 从请求头获取token（或从session/cookie），查询用户信息
 */
async function requireAuth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    // 从 token 解析用户信息
    // token 格式可能是 "Bearer xxx" 或 "Bearer userId"
    let userId = token.replace(/^Bearer\s+/i, '').trim();

    // 尝试解析JSON token (Base64编码的userId)
    try {
      const decoded = JSON.parse(Buffer.from(userId, 'base64').toString('utf-8'));
      if (decoded && decoded.userId) {
        userId = decoded.userId;
      }
    } catch (e) {
      // 不是 base64 编码的JSON，直接使用原值
    }

    const [rows] = await pool.query(
      'SELECT id, username, name, role, role_id, status, phone, department_id, wecom_userid FROM users WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    const user = rows[0];

    // 检查用户状态
    if (user.status !== 1) {
      return res.status(403).json({ error: '用户已被禁用' });
    }

    // 直接从数据库查询用户的角色代码（不依赖 user.role 或 user.role_id 字段）
    let roleCode = null;
    try {
      const [roleRows] = await pool.query(`
        SELECT DISTINCT r.code
        FROM (
          SELECT role_id FROM user_roles WHERE user_id = ?
          UNION
          SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
        ) t
        JOIN roles r ON r.id = t.role_id
        ORDER BY r.sort_order ASC
        LIMIT 1
      `, [userId, userId]);
      if (roleRows.length > 0) {
        roleCode = roleRows[0].code;
      }
    } catch (e) {
      // 查询失败，忽略
    }

    // 如果查询到角色代码，更新 user.role 字段
    if (roleCode) {
      user.role = roleCode;
    } else if (user.role_id) {
      // 降级：尝试从 role_id 查询
      try {
        const [roleRows] = await pool.query('SELECT code FROM roles WHERE id = ?', [user.role_id]);
        if (roleRows.length > 0) {
          user.role = roleRows[0].code;
        }
      } catch (e) {
        // 查询失败，忽略
      }
    }

    // 更新最后登录时间
    pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date(), userId]);

    // 将用户信息挂载到req对象
    req.user = user;

    // 获取用户权限列表（支持多角色合并）
    let roleRows = [];
    try {
      [roleRows] = await pool.query(`
        SELECT DISTINCT role_id FROM (
          SELECT role_id FROM user_roles WHERE user_id = ?
          UNION
          SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
        ) t
      `, [userId, userId]);
    } catch (e) {
      try {
        [roleRows] = await pool.query('SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL', [userId]);
      } catch (e2) {
        req.user.permissions = [];
        req.user.permissionCodes = new Set();
        return next();
      }
    }

    let permRows = [];
    if (roleRows.length > 0) {
      const roleIds = roleRows.map(r => r.role_id);
      const placeholders = roleIds.map(() => '?').join(',');
      try {
        [permRows] = await pool.query(`
          SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.module_id, p.sort_order
          FROM role_permissions rp
          JOIN permissions p ON rp.permission_id = p.id
          WHERE rp.role_id IN (${placeholders}) AND p.status = 1
          ORDER BY p.sort_order ASC
        `, roleIds);
      } catch (e) {
        permRows = [];
      }
    }

    req.user.permissions = permRows;
    req.user.permissionCodes = new Set(permRows.map(p => p.code));

    next();
  } catch (err) {
    console.error('auth middleware error:', err);
    return res.status(500).json({ error: '认证失败' });
  }
}

/**
 * 角色权限校验中间件
 * 检查用户角色是否在允许列表中
 * 
 * 使用：requireRole('admin', 'finance', 'boss')
 */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }

    console.log('[DEBUG requireRole] user:', {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      role_id: req.user.role_id,
      permissionCodes: req.user.permissionCodes ? Array.from(req.user.permissionCodes) : null,
      requiredRoles: roles
    });

    // 检查单角色（兼容旧字段）
    if (roles.includes(req.user.role)) {
      console.log('[DEBUG requireRole] 通过: req.user.role');
      return next();
    }

    // 检查 role_id 对应的角色代码
    if (req.user.role_id) {
      try {
        const [roleRows] = await pool.query('SELECT code FROM roles WHERE id = ?', [req.user.role_id]);
        console.log('[DEBUG requireRole] role_id查询结果:', roleRows);
        if (roleRows.length > 0 && roles.includes(roleRows[0].code)) {
          console.log('[DEBUG requireRole] 通过: role_id查询');
          return next();
        }
      } catch (e) {
        console.error('[DEBUG requireRole] role_id查询失败:', e);
      }
    }

    // 查多角色（user_roles 表 + users.role_id）
    try {
      const [roleCodeRows] = await pool.query(`
        SELECT DISTINCT r.code
        FROM (
          SELECT role_id FROM user_roles WHERE user_id = ?
          UNION
          SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
        ) t
        JOIN roles r ON r.id = t.role_id
      `, [req.user.id, req.user.id]);
      console.log('[DEBUG requireRole] 多角色查询结果:', roleCodeRows);
      const multiRoleCodes = roleCodeRows.map(r => r.code);
      if (roles.some(r => multiRoleCodes.includes(r))) {
        console.log('[DEBUG requireRole] 通过: 多角色查询');
        return next();
      }
    } catch (e) {
      console.error('[DEBUG requireRole] 多角色查询失败:', e);
    }

    // 降级：检查用户是否拥有管理员级别的权限码
    // 如果用户拥有 menu:users 或 menu:roles 权限，说明是管理员
    if (roles.includes('admin') && req.user.permissionCodes) {
      const adminPermCodes = ['menu:users', 'menu:roles', 'menu:categories', 'menu:departments'];
      const hasAdminPerm = adminPermCodes.some(code => req.user.permissionCodes.has(code));
      console.log('[DEBUG requireRole] 权限码降级检查:', { adminPermCodes, hasAdminPerm });
      if (hasAdminPerm) {
        console.log('[DEBUG requireRole] 通过: 权限码降级检查');
        return next();
      }
    }

    console.log('[DEBUG requireRole] 拒绝: 所有检查都失败');
    return res.status(403).json({ error: '无权限访问' });
  };
}

/**
 * 权限码校验中间件
 * 检查用户是否拥有指定权限码
 * 
 * 使用：requirePermission('action:user:manage')
 */
function requirePermission(permissionCode) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }

    if (!req.user.permissionCodes.has(permissionCode)) {
      return res.status(403).json({ error: '无权限执行此操作' });
    }

    next();
  };
}

/**
 * 获取用户权限列表
 * 返回当前用户的所有权限（菜单+按钮+API）
 */
async function getUserPermissions(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }

    const { role_id } = req.user;

    // 获取角色信息
    const [roleRows] = await pool.query(
      'SELECT id, code, name, description FROM roles WHERE id = ?',
      [role_id]
    );
    const role = roleRows.length > 0 ? roleRows[0] : null;

    // 获取权限列表（按模块分组）
    const [permRows] = await pool.query(`
      SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.parent_id, p.module_id, m.code as module_code, m.name as module_name
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      JOIN modules m ON p.module_id = m.id
      WHERE rp.role_id = ? AND p.status = 1 AND m.status = 1
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `, [role_id]);

    // 按模块分组
    const modules = {};
    permRows.forEach(perm => {
      if (!modules[perm.module_code]) {
        modules[perm.module_code] = {
          code: perm.module_code,
          name: perm.module_name,
          icon: perm.icon,
          menus: [],
          actions: [],
        };
      }

      if (perm.type === 'menu') {
        modules[perm.module_code].menus.push({
          id: perm.id,
          code: perm.code,
          name: perm.name,
          path: perm.path,
          icon: perm.icon,
          parent_id: perm.parent_id,
        });
      } else {
        modules[perm.module_code].actions.push({
          id: perm.id,
          code: perm.code,
          name: perm.name,
        });
      }
    });

    res.json({
      role,
      modules: Object.values(modules),
      permissionCodes: permRows.map(p => p.code),
      menuPaths: permRows.filter(p => p.type === 'menu' && p.path).map(p => p.path),
    });
  } catch (err) {
    console.error('getUserPermissions error:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * 获取所有角色列表（管理员用）
 */
async function getRoles(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, code, name, description, is_system, sort_order FROM roles ORDER BY sort_order ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getRoles error:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * 获取所有权限列表（管理员用）
 */
async function getPermissions(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.code, p.name, p.type, p.path, p.icon, p.parent_id, p.module_id, p.sort_order, p.status,
             m.code as module_code, m.name as module_name
      FROM permissions p
      LEFT JOIN modules m ON p.module_id = m.id
      ORDER BY m.sort_order ASC, p.sort_order ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('getPermissions error:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * 获取所有模块列表
 */
async function getModules(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, code, name, icon, description, sort_order, status FROM modules WHERE status = 1 ORDER BY sort_order ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('getModules error:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * 判断用户是否有权限
 * @param {string} permissionCode - 权限码
 * @returns {boolean}
 */
function hasPermission(req, permissionCode) {
  if (!req.user || !req.user.permissionCodes) {
    return false;
  }
  return req.user.permissionCodes.has(permissionCode);
}

/**
 * 判断用户是否有权限访问路径
 * @param {string} path - 路由路径
 * @returns {boolean}
 */
function canAccessPath(req, path) {
  if (!req.user || !req.user.permissions) {
    return false;
  }
  return req.user.permissions.some(p => p.type === 'menu' && p.path === path);
}

module.exports = {
  requireAuth,
  requireRole,
  requirePermission,
  getUserPermissions,
  getRoles,
  getPermissions,
  getModules,
  hasPermission,
  canAccessPath,
};
