const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { isManagerUser } = require('../middleware/warehouseScope');

// ================================================
// 仓库 CRUD
// ================================================

// 获取仓库列表
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT w.*, d.name as department_name
      FROM warehouses w
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.status = 1
      ORDER BY w.sort_order ASC, w.created_at ASC
    `);

    // 聚合每个仓库的管理员/查看人真实姓名（列表显示用，避免前端反复查询）
    const warehouseIds = rows.map(r => r.id);
    let userMap = {};
    if (warehouseIds.length > 0) {
      const placeholders = warehouseIds.map(() => '?').join(',');
      const [wuRows] = await pool.query(
        `SELECT wu.warehouse_id, wu.role, u.id as user_id, u.name as user_name, u.wecom_userid
         FROM warehouse_users wu
         JOIN users u ON u.id = wu.user_id
         WHERE wu.warehouse_id IN (${placeholders})`,
        warehouseIds
      );
      for (const r of wuRows) {
        if (!userMap[r.warehouse_id]) userMap[r.warehouse_id] = [];
        userMap[r.warehouse_id].push({ user_id: r.user_id, name: r.user_name, role: r.role, wecom_userid: r.wecom_userid });
      }
    }

    // 加上 confirmer 的用户信息（它是单 userid 字符串，单独查）
    const confirmerUserids = [...new Set(rows.map(r => r.confirmer_userid).filter(Boolean))];
    let confirmerMap = {};
    if (confirmerUserids.length > 0) {
      const placeholders = confirmerUserids.map(() => '?').join(',');
      const [cuRows] = await pool.query(
        `SELECT id, name, wecom_userid FROM users WHERE wecom_userid IN (${placeholders})`,
        confirmerUserids
      );
      cuRows.forEach(u => { confirmerMap[u.wecom_userid] = { user_id: u.id, name: u.name }; });
    }

    const result = rows.map(r => ({
      ...r,
      managers: (userMap[r.id] || []).filter(u => u.role === 'manager'),
      viewers: (userMap[r.id] || []).filter(u => u.role === 'viewer'),
      confirmer_name: r.confirmer_userid ? (confirmerMap[r.confirmer_userid]?.name || r.confirmer_userid) : null,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 仓库用户关联
// ================================================

// 获取某个仓库绑定的用户列表
router.get('/:id/users', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT wu.id, wu.role, u.id as user_id, u.name, u.username, u.wecom_userid, u.role as user_role_code
       FROM warehouse_users wu
       JOIN users u ON u.id = wu.user_id
       WHERE wu.warehouse_id = ?
       ORDER BY wu.role, u.name`,
      [id]
    );
    // 再把 confirmer 也一起返回（单选，保持现有字段）
    const [whRows] = await pool.query(`SELECT confirmer_userid FROM warehouses WHERE id = ?`, [id]);
    const confirmer = whRows[0]?.confirmer_userid || null;
    let confirmerUser = null;
    if (confirmer) {
      const [cuRows] = await pool.query(`SELECT id, name, wecom_userid FROM users WHERE wecom_userid = ? LIMIT 1`, [confirmer]);
      confirmerUser = cuRows[0] ? { user_id: cuRows[0].id, name: cuRows[0].name, wecom_userid: cuRows[0].wecom_userid } : null;
    }
    res.json({
      managers: rows.filter(r => r.role === 'manager').map(r => ({ user_id: r.user_id, name: r.name })),
      viewers: rows.filter(r => r.role === 'viewer').map(r => ({ user_id: r.user_id, name: r.name })),
      confirmer: confirmerUser,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 保存某个仓库的用户绑定（同时同步 confirmer_userid 到 warehouses 表）
// body: { manager_ids: string[], viewer_ids: string[], confirmer_user_id?: string }
router.put('/:id/users', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    if (!(await isManagerUser(req.user.id))) {
      return res.status(403).json({ error: '只有管理员可配置仓库用户' });
    }
    const { id } = req.params;
    const { manager_ids = [], viewer_ids = [], confirmer_user_id } = req.body;

    await conn.beginTransaction();

    // 清理旧的仓库用户
    await conn.query(`DELETE FROM warehouse_users WHERE warehouse_id = ?`, [id]);

    // 插入管理员
    for (const userId of [...new Set(manager_ids)].filter(Boolean)) {
      await conn.query(
        `INSERT INTO warehouse_users (id, warehouse_id, user_id, role) VALUES (?, ?, ?, 'manager')`,
        [uuidv4(), id, userId]
      );
    }
    // 插入查看人
    for (const userId of [...new Set(viewer_ids)].filter(Boolean)) {
      // 同一个人如果又是管理员就忽略 viewer
      if (manager_ids.includes(userId)) continue;
      await conn.query(
        `INSERT INTO warehouse_users (id, warehouse_id, user_id, role) VALUES (?, ?, ?, 'viewer')`,
        [uuidv4(), id, userId]
      );
    }

    // 同步 warehouses.manager_userid（取第一个管理员的 wecom_userid，保持盘点模块兼容性）
    const [firstManagerRow] = manager_ids[0]
      ? await conn.query(`SELECT wecom_userid FROM users WHERE id = ?`, [manager_ids[0]])
      : [[null]];
    const firstWecomId = firstManagerRow[0]?.wecom_userid || null;

    // 同步 confirmer（如果传了 confirmer_user_id，查 wecom_userid 写回去；不传则不改动）
    let confirmerWecom = undefined;
    if (confirmer_user_id !== undefined) {
      if (!confirmer_user_id) {
        confirmerWecom = null;
      } else {
        const [cuRows] = await conn.query(`SELECT wecom_userid FROM users WHERE id = ?`, [confirmer_user_id]);
        confirmerWecom = cuRows[0]?.wecom_userid || null;
      }
    }

    // 写回 warehouses 表
    const fields = [];
    const values = [];
    fields.push('manager_userid = ?'); values.push(firstWecomId);
    if (confirmerWecom !== undefined) { fields.push('confirmer_userid = ?'); values.push(confirmerWecom); }
    values.push(id);
    await conn.query(`UPDATE warehouses SET ${fields.join(', ')} WHERE id = ?`, values);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 新建仓库
router.post('/', async (req, res) => {
  try {
    const { name, code, type = 'dept', department_id, manager_userid, confirmer_userid, location, sort_order = 0, enable_stock_take = 1 } = req.body;
    if (!name) return res.status(400).json({ error: '仓库名称不能为空' });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO warehouses (id, name, code, type, department_id, manager_userid, confirmer_userid, location, sort_order, enable_stock_take)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, code || null, type, department_id || null, manager_userid || null, confirmer_userid || null, location || null, sort_order, enable_stock_take ? 1 : 0]
    );

    const [rows] = await pool.query(`
      SELECT w.*, d.name as department_name
      FROM warehouses w LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.id = ?
    `, [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 编辑仓库
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, type, department_id, manager_userid, confirmer_userid, location, sort_order, status, enable_stock_take } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (code !== undefined) { fields.push('code = ?'); values.push(code); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (department_id !== undefined) { fields.push('department_id = ?'); values.push(department_id); }
    if (manager_userid !== undefined) { fields.push('manager_userid = ?'); values.push(manager_userid); }
    if (confirmer_userid !== undefined) { fields.push('confirmer_userid = ?'); values.push(confirmer_userid); }
    if (location !== undefined) { fields.push('location = ?'); values.push(location); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (enable_stock_take !== undefined) { fields.push('enable_stock_take = ?'); values.push(enable_stock_take ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

    values.push(id);
    await pool.query(`UPDATE warehouses SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query(`
      SELECT w.*, d.name as department_name
      FROM warehouses w LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.id = ?
    `, [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 删除仓库（软删除）
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 检查是否有库存
    const [inv] = await pool.query('SELECT COUNT(*) as cnt FROM inventory WHERE warehouse_id = ? AND quantity != 0', [id]);
    if (inv[0].cnt > 0) return res.status(400).json({ error: '该仓库仍有库存，无法删除' });

    await pool.query('UPDATE warehouses SET status = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 仓库物资三级分类 CRUD
// ================================================

// 获取分类树
router.get('/categories/tree', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM warehouse_categories WHERE status = 1 ORDER BY level ASC, sort_order ASC');
    // 构建树形结构
    const tree = [];
    const map = {};
    rows.forEach(r => { map[r.id] = { ...r, children: [] }; });
    rows.forEach(r => {
      if (r.parent_id && map[r.parent_id]) {
        map[r.parent_id].children.push(map[r.id]);
      } else {
        tree.push(map[r.id]);
      }
    });
    res.json(tree);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 获取分类列表（扁平）
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM warehouse_categories WHERE status = 1 ORDER BY level ASC, sort_order ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 新建分类
router.post('/categories', async (req, res) => {
  try {
    const { name, parent_id, code, sort_order = 0 } = req.body;
    if (!name) return res.status(400).json({ error: '分类名称不能为空' });

    // 计算层级和 full_path
    let level = 1;
    let full_path = name;
    if (parent_id) {
      const [parent] = await pool.query('SELECT * FROM warehouse_categories WHERE id = ?', [parent_id]);
      if (parent.length === 0) return res.status(400).json({ error: '父分类不存在' });
      level = parent[0].level + 1;
      if (level > 2) return res.status(400).json({ error: '最多支持二级分类' });
      full_path = parent[0].full_path + '/' + name;
    }

    const id = uuidv4();
    await pool.query(
      'INSERT INTO warehouse_categories (id, parent_id, level, name, code, full_path, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, parent_id || null, level, name, code || null, full_path, sort_order]
    );

    const [rows] = await pool.query('SELECT * FROM warehouse_categories WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 编辑分类
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, sort_order, status } = req.body;
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push('name = ?'); values.push(name);
      // 更新 full_path
      const [current] = await pool.query('SELECT * FROM warehouse_categories WHERE id = ?', [id]);
      if (current.length > 0) {
        if (current[0].parent_id) {
          const [parent] = await pool.query('SELECT full_path FROM warehouse_categories WHERE id = ?', [current[0].parent_id]);
          if (parent.length > 0) {
            fields.push('full_path = ?'); values.push(parent[0].full_path + '/' + name);
          }
        } else {
          fields.push('full_path = ?'); values.push(name);
        }
      }
    }
    if (code !== undefined) { fields.push('code = ?'); values.push(code); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

    values.push(id);
    await pool.query(`UPDATE warehouse_categories SET ${fields.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query('SELECT * FROM warehouse_categories WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 删除分类（软删除，检查子分类和物资）
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 检查子分类
    const [children] = await pool.query('SELECT COUNT(*) as cnt FROM warehouse_categories WHERE parent_id = ? AND status = 1', [id]);
    if (children[0].cnt > 0) return res.status(400).json({ error: '该分类下有子分类，无法删除' });
    // 检查物资
    const [items] = await pool.query('SELECT COUNT(*) as cnt FROM warehouse_items WHERE category_id = ? AND status = 1', [id]);
    if (items[0].cnt > 0) return res.status(400).json({ error: '该分类下有物资，无法删除' });

    await pool.query('UPDATE warehouse_categories SET status = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 仓库物资库 CRUD
// ================================================

// 获取物资列表
router.get('/items', async (req, res) => {
  try {
    const { category_id, keyword } = req.query;
    let sql = `
      SELECT wi.*, wc.name as category_name, wc.full_path as category_full_path
      FROM warehouse_items wi
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE wi.status = 1
    `;
    const params = [];
    if (category_id) { sql += ' AND wi.category_id = ?'; params.push(category_id); }
    if (keyword) { sql += ' AND (wi.name LIKE ? OR wi.sku LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    sql += ' ORDER BY wi.created_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 相似度查询：用于批量导入时检测输错字的物资
// 返回精确匹配 + 候选列表（LIKE 粗筛）
router.get('/items/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ exact: null, candidates: [] });

    const keyword = q.trim();
    // 1. 精确匹配（name 完全相等）
    const [exact] = await pool.query(
      'SELECT wi.*, wc.name as category_name, wc.full_path as category_full_path FROM warehouse_items wi LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id WHERE wi.name = ? AND wi.status = 1',
      [keyword]
    );
    // 2. 候选：name 包含关键词 或 关键词包含 name
    const [candidates] = await pool.query(
      `SELECT wi.*, wc.name as category_name, wc.full_path as category_full_path
       FROM warehouse_items wi
       LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
       WHERE wi.status = 1 AND wi.name != ? AND (wi.name LIKE ? OR ? LIKE CONCAT('%', wi.name, '%'))
       ORDER BY wi.created_at DESC LIMIT 10`,
      [keyword, `%${keyword}%`, keyword]
    );
    res.json({ exact: exact[0] || null, candidates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 新建物资
router.post('/items', async (req, res) => {
  try {
    const { name, category_id, sku, spec, unit = '个', reference_price = 0, instant_use = 0 } = req.body;
    if (!name) return res.status(400).json({ error: '物资名称不能为空' });

    // 查重：启用状态下同名物资不允许重复创建（合并规格后 name 即唯一标识）
    const [dup] = await pool.query(
      'SELECT id FROM warehouse_items WHERE name = ? AND status = 1',
      [name.trim()]
    );
    if (dup.length > 0) {
      return res.status(409).json({ error: '已存在同名物资，请直接使用或修改名称', existing_id: dup[0].id });
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO warehouse_items (id, category_id, name, sku, spec, unit, reference_price, instant_use)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, category_id || null, name.trim(), sku || null, spec || '', unit, reference_price, instant_use ? 1 : 0]
    );

    const [rows] = await pool.query(`
      SELECT wi.*, wc.name as category_name, wc.full_path as category_full_path
      FROM warehouse_items wi LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE wi.id = ?
    `, [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 编辑物资
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, sku, spec, unit, reference_price, status, instant_use } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id); }
    if (sku !== undefined) { fields.push('sku = ?'); values.push(sku); }
    if (spec !== undefined) { fields.push('spec = ?'); values.push(spec); }
    if (unit !== undefined) { fields.push('unit = ?'); values.push(unit); }
    if (reference_price !== undefined) { fields.push('reference_price = ?'); values.push(reference_price); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (instant_use !== undefined) { fields.push('instant_use = ?'); values.push(instant_use ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

    values.push(id);
    await pool.query(`UPDATE warehouse_items SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query(`
      SELECT wi.*, wc.name as category_name, wc.full_path as category_full_path
      FROM warehouse_items wi LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE wi.id = ?
    `, [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 删除物资（软删除）
router.delete('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE warehouse_items SET status = 0 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
