const express = require('express');
const cors = require('cors');
const path = require('path');

const categoriesRouter = require('./routes/categories');
const ingredientsRouter = require('./routes/ingredients');
const purchaseRouter = require('./routes/purchase');
const authRouter = require('./routes/auth');
const departmentsRouter = require('./routes/departments');
const suppliersRouter = require('./routes/suppliers');
const wecomRouter = require('./routes/wecom');
const purchaseConfirmationsRouter = require('./routes/purchase-confirmations');

// 外请人员打卡模块
const tempAuthRouter = require('./routes/temp-auth');
const tempPositionsRouter = require('./routes/temp-positions');
const tempCheckinsRouter = require('./routes/temp-checkins');
const tempAssessmentsRouter = require('./routes/temp-assessments');
const tempStatsRouter = require('./routes/temp-stats');
const tempWorkersRouter = require('./routes/temp-workers');

const { requireAuth, getUserPermissions, getRoles, getPermissions, getModules, requireRole } = require('./middleware/rbac');
const rolesRouter = require('./routes/roles');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/wecom', wecomRouter);

// 权限相关接口（需登录）
app.get('/api/permissions', requireAuth, getUserPermissions);
app.get('/api/permissions/list', requireAuth, requireRole('admin'), getPermissions);
app.get('/api/roles', requireAuth, requireRole('admin'), getRoles);
app.get('/api/modules', requireAuth, getModules);

// 角色管理接口（管理员专用）
app.use('/api/roles', rolesRouter);

// 业务接口（需登录）
app.use('/api/categories', requireAuth, categoriesRouter);
app.use('/api/ingredients', requireAuth, ingredientsRouter);
app.use('/api/purchase', requireAuth, purchaseRouter);
app.use('/api/departments', requireAuth, departmentsRouter);
app.use('/api/suppliers', requireAuth, suppliersRouter);

// 采购确认接口（部分接口不需要登录）
app.use('/api/purchase-confirmations', purchaseConfirmationsRouter);

// ================================================
// 外请人员打卡模块
// ================================================
// 微信端（外请人员，独立认证）
app.use('/api/temp/auth', tempAuthRouter);
app.use('/api/temp/checkins', tempCheckinsRouter); // 内含微信端 + 企微端接口

// 企微端（审核员/董事长，复用现有认证）
app.use('/api/temp/positions', tempPositionsRouter);
app.use('/api/temp/assessments', tempAssessmentsRouter);
app.use('/api/temp/stats', tempStatsRouter);

// PC管理端（管理员）
app.use('/api/temp/workers', tempWorkersRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 临时调试接口：查看角色权限数据（用于排查菜单不显示问题）
app.get('/api/debug/role-perms', async (req, res) => {
  try {
    const pool = require('./db');
    const { getUserMergedPermissions } = require('./routes/auth');
    const [roles] = await pool.query('SELECT id, code, name FROM roles ORDER BY sort_order');
    const [permissions] = await pool.query('SELECT id, code, name, type, path, module_id FROM permissions WHERE status = 1 ORDER BY code');
    const [rolePerms] = await pool.query('SELECT rp.role_id, rp.permission_id, r.code as role_code, p.code as perm_code FROM role_permissions rp JOIN roles r ON rp.role_id = r.id JOIN permissions p ON rp.permission_id = p.id ORDER BY r.code, p.code');
    const [users] = await pool.query('SELECT id, username, name, role, role_id FROM users WHERE username IN ("admin", "viewer", "finance", "boss")');

    // 测试 viewer 用户的合并权限（直接复制函数逻辑）
    const viewer = users.find(u => u.username === 'viewer');
    let viewerMergedPerms = null;
    let viewerError = null;
    let viewerRoleRows = null;
    let viewerPermRows = null;
    if (viewer) {
      try {
        [viewerRoleRows] = await pool.query(`
          SELECT DISTINCT role_id FROM (
            SELECT role_id FROM user_roles WHERE user_id = ?
            UNION
            SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
          ) t
        `, [viewer.id, viewer.id]);

        if (viewerRoleRows.length > 0) {
          const roleIds = viewerRoleRows.map(r => r.role_id);
          const placeholders = roleIds.map(() => '?').join(',');
          [viewerPermRows] = await pool.query(`
            SELECT DISTINCT p.id, p.code, p.name, p.type, p.path, p.icon, p.module_id, m.code as module_code, m.name as module_name, m.icon as module_icon
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            JOIN modules m ON p.module_id = m.id
            WHERE rp.role_id IN (${placeholders}) AND p.status = 1 AND m.status = 1
            ORDER BY m.sort_order ASC, p.sort_order ASC
          `, roleIds);

          const modules = {};
          const seenCodes = new Set();
          viewerPermRows.forEach(perm => {
            if (seenCodes.has(perm.code)) return;
            seenCodes.add(perm.code);
            if (!modules[perm.module_code]) {
              modules[perm.module_code] = { code: perm.module_code, name: perm.module_name, icon: perm.module_icon, menus: [], actions: [] };
            }
            if (perm.type === 'menu') {
              modules[perm.module_code].menus.push({ code: perm.code, name: perm.name, path: perm.path, icon: perm.icon });
            } else {
              modules[perm.module_code].actions.push({ code: perm.code, name: perm.name });
            }
          });

          viewerMergedPerms = {
            modules: Object.values(modules),
            codes: viewerPermRows.map(p => p.code).filter((v, i, a) => a.indexOf(v) === i),
            menuPaths: viewerPermRows.filter(p => p.type === 'menu' && p.path).map(p => p.path).filter((v, i, a) => a.indexOf(v) === i),
            roleIds,
          };
        } else {
          viewerMergedPerms = { modules: [], codes: [], menuPaths: [], roleIds: [] };
        }
      } catch (e) {
        viewerError = e.message;
      }
    }

    res.json({
      role_count: roles.length,
      permission_count: permissions.length,
      role_permission_count: rolePerms.length,
      roles,
      permissions: permissions.filter(p => p.type === 'menu').map(p => ({ code: p.code, name: p.name, path: p.path })),
      role_permissions_summary: rolePerms.reduce((acc, rp) => {
        if (!acc[rp.role_code]) acc[rp.role_code] = [];
        acc[rp.role_code].push(rp.perm_code);
        return acc;
      }, {}),
      users,
      viewer_merged_permissions: viewerMergedPerms,
      viewer_error: viewerError,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Server running on http://127.0.0.1:${PORT}`);
});
