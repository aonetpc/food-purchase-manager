const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

// 出入库流水查询
router.get('/', async (req, res) => {
  try {
    const { warehouse_id, movement_type, start_date, end_date, page = 1, page_size = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(page_size);

    let sql = `
      SELECT sm.*, w.name as warehouse_name
      FROM stock_movements sm
      JOIN warehouses w ON sm.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];
    if (warehouse_id) { sql += ' AND sm.warehouse_id = ?'; params.push(warehouse_id); }
    if (movement_type) { sql += ' AND sm.movement_type = ?'; params.push(movement_type); }
    if (start_date) { sql += ' AND sm.created_at >= ?'; params.push(start_date); }
    if (end_date) { sql += ' AND sm.created_at <= ?'; params.push(end_date + ' 23:59:59'); }
    sql += ' ORDER BY sm.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(page_size), offset);

    const [rows] = await pool.query(sql, params);

    // 总数
    let countSql = 'SELECT COUNT(*) as total FROM stock_movements WHERE 1=1';
    const countParams = [];
    if (warehouse_id) { countSql += ' AND warehouse_id = ?'; countParams.push(warehouse_id); }
    if (movement_type) { countSql += ' AND movement_type = ?'; countParams.push(movement_type); }
    if (start_date) { countSql += ' AND created_at >= ?'; countParams.push(start_date); }
    if (end_date) { countSql += ' AND created_at <= ?'; countParams.push(end_date + ' 23:59:59'); }
    const [countResult] = await pool.query(countSql, countParams);

    res.json({ data: rows, total: countResult[0].total, page: Number(page), page_size: Number(page_size) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 手动入库
router.post('/inbound', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_id, item_id, item_name, quantity, unit, unit_price, reason, operator_id, operator_name } = req.body;
    if (!warehouse_id || !item_id || !quantity || !unit) {
      return res.status(400).json({ error: '仓库、物资、数量、单位不能为空' });
    }

    await conn.beginTransaction();

    // 记录流水
    const id = uuidv4();
    const total_amount = unit_price ? Number(quantity) * Number(unit_price) : null;
    await conn.query(
      `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'manual', ?, ?)`,
      [id, warehouse_id, item_id, item_name, quantity, unit, unit_price || null, total_amount, reason || null, operator_id || null, operator_name || null]
    );

    // 更新库存（不存在则插入）
    const [existing] = await conn.query('SELECT id FROM inventory WHERE warehouse_id = ? AND item_id = ?', [warehouse_id, item_id]);
    if (existing.length > 0) {
      await conn.query('UPDATE inventory SET quantity = quantity + ?, unit = ? WHERE warehouse_id = ? AND item_id = ?', [quantity, unit, warehouse_id, item_id]);
    } else {
      await conn.query('INSERT INTO inventory (id, warehouse_id, item_id, quantity, unit) VALUES (?, ?, ?, ?, ?)', [uuidv4(), warehouse_id, item_id, quantity, unit]);
    }

    await conn.commit();
    res.json({ success: true, id });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 手动出库
router.post('/outbound', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_id, item_id, item_name, quantity, unit, unit_price, reason, operator_id, operator_name } = req.body;
    if (!warehouse_id || !item_id || !quantity || !unit) {
      return res.status(400).json({ error: '仓库、物资、数量、单位不能为空' });
    }

    await conn.beginTransaction();

    // 检查库存是否足够
    const [inv] = await conn.query('SELECT quantity FROM inventory WHERE warehouse_id = ? AND item_id = ?', [warehouse_id, item_id]);
    if (inv.length === 0 || Number(inv[0].quantity) < Number(quantity)) {
      await conn.rollback();
      return res.status(400).json({ error: '库存不足' });
    }

    // 记录流水（出库数量为负数）
    const id = uuidv4();
    const total_amount = unit_price ? Number(quantity) * Number(unit_price) : null;
    await conn.query(
      `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name)
       VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 'manual', ?, ?)`,
      [id, warehouse_id, item_id, item_name, -Math.abs(quantity), unit, unit_price || null, total_amount, reason || null, operator_id || null, operator_name || null]
    );

    // 扣减库存
    await conn.query('UPDATE inventory SET quantity = quantity - ? WHERE warehouse_id = ? AND item_id = ?', [quantity, warehouse_id, item_id]);

    await conn.commit();
    res.json({ success: true, id });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
