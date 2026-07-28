const express = require('express');
const router = express.Router();
const pool = require('../db');

// 库存查询（按仓库筛选，含物资和分类信息）
router.get('/', async (req, res) => {
  try {
    const { warehouse_id, keyword, low_stock_only } = req.query;
    let sql = `
      SELECT i.*,
             wi.name as item_name, wi.sku, wi.spec, wi.reference_price,
             wc.name as category_name, wc.full_path as category_full_path,
             w.name as warehouse_name, w.type as warehouse_type
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      JOIN warehouses w ON i.warehouse_id = w.id
      WHERE wi.status = 1 AND w.status = 1
    `;
    const params = [];
    if (warehouse_id) { sql += ' AND i.warehouse_id = ?'; params.push(warehouse_id); }
    if (keyword) { sql += ' AND (wi.name LIKE ? OR wi.sku LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (low_stock_only === 'true') { sql += ' AND i.quantity <= i.min_stock AND i.min_stock > 0'; }
    sql += ' ORDER BY w.sort_order ASC, wi.name ASC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 库存汇总（按仓库统计物资数、总价值、预警数）
router.get('/summary', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT w.id as warehouse_id, w.name as warehouse_name, w.type,
             COUNT(i.id) as item_count,
             COALESCE(SUM(i.quantity * wi.reference_price), 0) as total_value,
             SUM(CASE WHEN i.quantity <= i.min_stock AND i.min_stock > 0 THEN 1 ELSE 0 END) as low_stock_count
      FROM warehouses w
      LEFT JOIN inventory i ON w.id = i.warehouse_id
      LEFT JOIN warehouse_items wi ON i.item_id = wi.id
      WHERE w.status = 1
      GROUP BY w.id
      ORDER BY w.sort_order ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
