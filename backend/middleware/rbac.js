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
  // 优先读取 Authorization header（标准API调用）
  // 回退支持 URL query 参数 token（window.open 新窗口打开PDF等场景，浏览器不会自动带 Authorization header）
  //   ?auth_token=xxx 用于 PC 端登录用户（base64编码的用户token）
  //   注意：盘点H5免登录的 ?token=xxx / ?r_token=xxx 不在这里处理，走各自模块的 token middleware
  let token = req.headers['authorization'];
  if (!token && req.query.auth_token) {
    token = `Bearer ${req.query.auth_token}`;
  }
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

    // 检查单角色（兼容旧字段）
    if (roles.includes(req.user.role)) {
      return next();
    }

    // 检查 role_id 对应的角色代码
    if (req.user.role_id) {
      try {
        const [roleRows] = await pool.query('SELECT code FROM roles WHERE id = ?', [req.user.role_id]);
        if (roleRows.length > 0 && roles.includes(roleRows[0].code)) {
          return next();
        }
      } catch (e) {
        // 查询失败，忽略
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
      const multiRoleCodes = roleCodeRows.map(r => r.code);
      if (roles.some(r => multiRoleCodes.includes(r))) {
        return next();
      }
    } catch (e) {
      // 查询失败，忽略
    }

    // 降级：检查用户是否拥有管理员级别的权限码
    // 如果用户拥有 menu:users 或 menu:roles 权限，说明是管理员
    if (roles.includes('admin') && req.user.permissionCodes) {
      const adminPermCodes = ['menu:users', 'menu:roles', 'menu:categories', 'menu:departments'];
      const hasAdminPerm = adminPermCodes.some(code => req.user.permissionCodes.has(code));
      if (hasAdminPerm) {
        return next();
      }
    }

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
 * 预订模块写操作权限校验中间件（入口白名单 —— 细粒度业务限制交给各 handler 内部）
 *
 * 历史：v1 只放 admin/booker，导致 sales 角色在 H5 BookingConfirm 页
 *       签字后点"销售员确认"直接 403，错误红框在页顶被滚动遮挡，
 *       用户感知为"点了没反应"。
 *
 * 当前策略：入口白名单放开到常见业务角色（admin / booker / sales /
 *            purchaser / finance / boss / temp_auditor / temp_chairman），
 *            sales 只能"确认本人名下订单"，审核/驳回/标记完成等管理动作
 *            仍限制为 admin/booker —— 这些限制在各路由 handler 内部
 *            按业务语义分别校验（见 booking-board.js sales-confirm /
 *            approve / reject / complete 各路由内的判断）。
 *
 * 使用：router.post('/orders', requireAuth, requireBookingWrite, handler)
 */
async function requireBookingWrite(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录' });
  }

  // 入口白名单：能进到路由 handler 就算过；业务操作角色限制交给 handler 内部
  const allowedRoles = [
    'admin',
    'booker',
    'sales',
    'purchaser',
    'finance',
    'boss',
    'temp_auditor',
    'temp_chairman',
  ];

  // 1. 优先校验 user.role（requireAuth 中已动态查询并回填）
  if (allowedRoles.includes(req.user.role)) {
    return next();
  }

  // 2. 多角色查询（user_roles 表 + users.role_id）
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
    const userRoleCodes = roleCodeRows.map(r => r.code);
    if (allowedRoles.some(r => userRoleCodes.includes(r))) {
      return next();
    }
  } catch (e) {
    // 查询失败，忽略
  }

  // 3. 降级：检查权限码（action:booking:create / action:booking:config / action:booking:approve）
  if (req.user.permissionCodes &&
      (req.user.permissionCodes.has('action:booking:create') ||
       req.user.permissionCodes.has('action:booking:config') ||
       req.user.permissionCodes.has('action:booking:approve'))) {
    return next();
  }

  return res.status(403).json({ error: '无操作权限，请联系管理员开通预订相关角色' });
}

/**
 * 体检中心（项目库/套餐库/品牌配置）写接口专用权限中间件。
 *
 * 业务语义：
 *   体检中心是"基础数据配置"模块，和订单写操作（requireBookingWrite）是两套权限体系：
 *   - booker / sales 能新建订单、能在「体检配单」工具里创建自用套餐，
 *     但不能改动体检中心的基础配置（项目增删、套餐模板、品牌价格）。
 *   - 只有 admin/boss 两个管理级角色可以写入体检中心基础配置。
 *   - 「体检配单」checkup-templates.js 不使用本中间件，它走自有归属判断。
 *
 * 使用：router.post('/config/checkup-items', requireAuth, requireBookingAdmin, handler)
 */
async function requireBookingAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录或会话过期' });
  }
  // 体检中心写接口白名单
  const ADMIN_ROLES = ['admin', 'boss'];

  // 1. 直接 role 字段命中
  if (ADMIN_ROLES.includes(req.user.role)) {
    return next();
  }
  // 2. 多角色表（user_roles）兜底判断
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
    const userRoleCodes = roleCodeRows.map(r => r.code);
    if (ADMIN_ROLES.some(r => userRoleCodes.includes(r))) {
      return next();
    }
  } catch (e) {
    // 查询失败保守处理：拒绝
  }
  // 3. 权限码兜底：action:booking:config（基础配置权限）
  if (req.user.permissionCodes && req.user.permissionCodes.has('action:booking:config')) {
    return next();
  }
  return res.status(403).json({ error: '无操作权限：体检中心配置仅管理员可修改' });
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
  requireBookingWrite,
  requireBookingAdmin,
  getUserPermissions,
  getRoles,
  getPermissions,
  getModules,
  hasPermission,
  canAccessPath,
};
