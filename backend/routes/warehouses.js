const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

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
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
