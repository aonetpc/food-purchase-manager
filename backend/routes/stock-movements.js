const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

// 清洗数字字符串：移除千分位逗号、全角逗号、空白、货币符号等
function cleanNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/[,，\s¥￥$]/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

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
    const { warehouse_id, item_id, item_name, unit, reason, operator_id, operator_name, department_id, department_name } = req.body;
    const quantity = cleanNumber(req.body.quantity);
    const unit_price = cleanNumber(req.body.unit_price);
    if (!warehouse_id || !item_id || quantity === null || !unit) {
      return res.status(400).json({ error: '仓库、物资、数量、单位不能为空' });
    }

    await conn.beginTransaction();

    // 记录流水（带部门归集）
    const id = uuidv4();
    const total_amount = unit_price !== null ? quantity * unit_price : null;
    await conn.query(
      `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name, department_id, department_name)
       VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      [id, warehouse_id, item_id, item_name, quantity, unit, unit_price, total_amount, reason || null, operator_id || null, operator_name || null, department_id || null, department_name || null]
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

// 批量入库（支持复制粘贴解析后导入）
// body: { warehouse_id, operator_id, operator_name, department_id, department_name, items: [{ item_id, item_name, quantity, unit, unit_price, reason }] }
router.post('/batch-inbound', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_id, operator_id, operator_name, department_id, department_name, items } = req.body;
    if (!warehouse_id) {
      conn.release();
      return res.status(400).json({ error: '仓库不能为空' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      conn.release();
      return res.status(400).json({ error: '导入数据不能为空' });
    }

    await conn.beginTransaction();

    const successList = [];
    const failedList = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const { item_id, item_name, quantity, unit, unit_price, reason } = it;
      const lineNo = i + 1;

      if (!item_id) {
        failedList.push({ line: lineNo, item_name: item_name || '', error: '物资未匹配' });
        continue;
      }
      // 清洗数量/单价（兼容 Excel 复制带千分位逗号、¥符号等）
      const qty = cleanNumber(quantity);
      if (qty === null || qty <= 0) {
        failedList.push({ line: lineNo, item_name: item_name || '', error: '数量无效' });
        continue;
      }
      if (!unit) {
        failedList.push({ line: lineNo, item_name: item_name || '', error: '单位为空' });
        continue;
      }

      try {
        // 记录流水
        const id = uuidv4();
        const price = cleanNumber(unit_price);
        const total_amount = price !== null ? qty * price : null;
        await conn.query(
          `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name, department_id, department_name)
           VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'batch-manual', ?, ?, ?, ?)`,
          [id, warehouse_id, item_id, item_name || null, qty, unit, price, total_amount, reason || null, operator_id || null, operator_name || null, department_id || null, department_name || null]
        );

        // 更新库存（不存在则插入）
        const [existing] = await conn.query('SELECT id FROM inventory WHERE warehouse_id = ? AND item_id = ?', [warehouse_id, item_id]);
        if (existing.length > 0) {
          await conn.query('UPDATE inventory SET quantity = quantity + ?, unit = ? WHERE warehouse_id = ? AND item_id = ?', [qty, unit, warehouse_id, item_id]);
        } else {
          await conn.query('INSERT INTO inventory (id, warehouse_id, item_id, quantity, unit) VALUES (?, ?, ?, ?, ?)', [uuidv4(), warehouse_id, item_id, qty, unit]);
        }

        successList.push({ line: lineNo, item_id, item_name: item_name || '', quantity: qty, unit });
      } catch (e) {
        failedList.push({ line: lineNo, item_name: item_name || '', error: e.message || '入库失败' });
      }
    }

    await conn.commit();
    res.json({
      success: true,
      total: items.length,
      success_count: successList.length,
      failed_count: failedList.length,
      success: successList,
      failed: failedList,
    });
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
    const { warehouse_id, item_id, item_name, quantity, unit, unit_price, reason, operator_id, operator_name, department_id, department_name } = req.body;
    if (!warehouse_id || !item_id || !quantity || !unit) {
      return res.status(400).json({ error: '仓库、物资、数量、单位不能为空' });
    }
    if (!department_id) {
      return res.status(400).json({ error: '出库必须指定领用部门（用于成本归集）' });
    }

    await conn.beginTransaction();

    // 检查库存是否足够
    const [inv] = await conn.query('SELECT quantity FROM inventory WHERE warehouse_id = ? AND item_id = ?', [warehouse_id, item_id]);
    if (inv.length === 0 || Number(inv[0].quantity) < Number(quantity)) {
      await conn.rollback();
      return res.status(400).json({ error: '库存不足' });
    }

    // 记录流水（出库数量为负数，带部门归集）
    const id = uuidv4();
    const total_amount = unit_price ? Number(quantity) * Number(unit_price) : null;
    await conn.query(
      `INSERT INTO stock_movements (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount, reason, related_type, operator_id, operator_name, department_id, department_name)
       VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      [id, warehouse_id, item_id, item_name, -Math.abs(quantity), unit, unit_price || null, total_amount, reason || null, operator_id || null, operator_name || null, department_id, department_name || null]
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
