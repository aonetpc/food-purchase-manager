/**
 * 仓库数据范围判定 —— 统一给 inventory.js / stock-movements.js / warehouse-purchases.js 等使用
 *
 * 判定顺序：
 *   1. 超级角色（admin / finance / boss）→ 全仓库
 *   2. 其他用户 → 以下 3 个集合的并集：
 *        A. 在 warehouse_users 里被配为 manager 或 viewer 的仓库
 *        B. 本部门下属的仓库（warehouses.department_id = user.department_id）
 *        C. 所有 type = 'main' 的总仓
 *
 * 对外提供 3 个工具函数：
 *   isManagerUser(userId)              -> bool   是不是超级角色
 *   getUserWarehouseFilter(user)       -> { sql, params }  用于 JOIN warehouses 过滤
 *   getUserWarehouseIds(user)          -> string[]  只返回可见的 warehouse_id 数组
 */
const pool = require('../db');

const SUPER_ROLES = ['admin', 'finance', 'boss'];

async function isManagerUser(userId) {
  if (!userId) return false;
  try {
    const [rows] = await pool.query(
      `SELECT 1
       FROM (
         SELECT role_id FROM user_roles WHERE user_id = ?
         UNION
         SELECT role_id FROM users WHERE id = ? AND role_id IS NOT NULL
       ) t
       JOIN roles r ON r.id = t.role_id
       WHERE r.code IN (?, ?, ?)
       LIMIT 1`,
      [userId, userId, ...SUPER_ROLES]
    );
    return rows.length > 0;
  } catch (e) {
    console.error('[warehouseScope.isManagerUser] error:', e);
    return false;
  }
}

async function getUserWarehouseIds(user) {
  if (!user) return [];
  if (await isManagerUser(user.id)) return null; // null = 全部权限
  const userId = user.id;
  const deptId = user.department_id || null;

  const ids = new Set();
  try {
    // A. 我被直接分配到 warehouse_users 的仓库（manager/viewer 都包含）
    const [rowsA] = await pool.query(
      `SELECT DISTINCT warehouse_id FROM warehouse_users WHERE user_id = ?`,
      [userId]
    );
    rowsA.forEach(r => r.warehouse_id && ids.add(r.warehouse_id));

    // B. 本部门仓库
    if (deptId) {
      const [rowsB] = await pool.query(
        `SELECT id FROM warehouses WHERE status = 1 AND department_id = ?`,
        [deptId]
      );
      rowsB.forEach(r => r.id && ids.add(r.id));
    }

    // C. 所有 type='main' 总仓
    const [rowsC] = await pool.query(
      `SELECT id FROM warehouses WHERE status = 1 AND type = 'main'`
    );
    rowsC.forEach(r => r.id && ids.add(r.id));
  } catch (e) {
    console.error('[warehouseScope.getUserWarehouseIds] error:', e);
  }
  return [...ids];
}

async function getUserWarehouseFilter(user, alias = 'w') {
  if (await isManagerUser(user && user.id)) {
    return { sql: '', params: [] };
  }
  const ids = await getUserWarehouseIds(user);
  if (ids.length === 0) {
    return { sql: ' AND 1=0', params: [] };
  }
  const placeholders = ids.map(() => '?').join(',');
  return {
    sql: ` AND ${alias}.id IN (${placeholders})`,
    params: ids,
  };
}

module.exports = {
  SUPER_ROLES,
  isManagerUser,
  getUserWarehouseIds,
  getUserWarehouseFilter,
};
