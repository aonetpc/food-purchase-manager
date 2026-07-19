// 角色权限中间件
// 使用方式：router.get('/xxx', requireRole('admin', 'finance', 'boss'), handler)

function requireRole(...roles) {
  return (req, res, next) => {
    // TODO: 后续接入JWT认证后，从 req.user 读取角色
    // 目前先提供工具函数，供后续接入使用
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '无权限访问' });
    }
    next();
  };
}

// 角色->可访问模块映射
const ROLE_PERMISSIONS = {
  admin:   ['daily', 'yearly', 'query', 'monthly'],
  finance: ['daily', 'yearly', 'query', 'monthly'],
  boss:    ['daily', 'yearly', 'query', 'monthly'],
  viewer:  ['daily', 'yearly', 'query'],
};

// 判断角色是否有权限访问某模块
function canAccess(role, module) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes(module);
}

module.exports = { requireRole, canAccess, ROLE_PERMISSIONS };
