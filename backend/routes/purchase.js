const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

const dbToFrontend = (row) => ({
  id: row.id,
  date: row.date,
  ingredient_id: row.ingredient_id,
  ingredient_name: row.ingredient_name,
  category_id: row.category_id || '',
  category_name: row.category_name || '',
  purchase_unit: row.purchase_unit,
  purchase_quantity: parseFloat(row.purchase_quantity),
  purchase_unit_price: parseFloat(row.purchase_unit_price),
  base_unit: row.base_unit || '',
  base_unit_price: parseFloat(row.base_unit_price) || 0,
  base_quantity: parseFloat(row.base_quantity) || 0,
  amount: parseFloat(row.amount),
  created_at: row.created_at,
});

router.get('/', async (req, res) => {
  try {
    const { date, start_date, end_date, month, year } = req.query;
    let sql = 'SELECT * FROM purchase_records';
    const params = [];

    if (date) {
      sql += ' WHERE date = ?';
      params.push(date);
    } else if (month) {
      sql += " WHERE DATE_FORMAT(date, '%Y-%m') = ?";
      params.push(month);
    } else if (year) {
      sql += ' WHERE YEAR(date) = ?';
      params.push(year);
    } else if (start_date && end_date) {
      sql += ' WHERE date >= ? AND date <= ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY date ASC, created_at ASC';

    const [rows] = await pool.query(sql, params);
    const result = rows.map(dbToFrontend);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const item = req.body;
    const id = uuidv4();

    await pool.query(
      `INSERT INTO purchase_records 
       (id, date, ingredient_id, ingredient_name, category_id, category_name,
        purchase_unit, purchase_quantity, purchase_unit_price,
        base_unit, base_unit_price, base_quantity, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        item.date,
        item.ingredient_id,
        item.ingredient_name,
        item.category_id,
        item.category_name,
        item.purchase_unit,
        item.purchase_quantity,
        item.purchase_unit_price,
        item.base_unit,
        item.base_unit_price,
        item.base_quantity,
        item.amount,
      ]
    );

    const [rows] = await pool.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    res.json(dbToFrontend(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = req.body;

    const fields = [];
    const values = [];

    const fieldMap = {
      date: 'date',
      ingredient_id: 'ingredient_id',
      ingredient_name: 'ingredient_name',
      category_id: 'category_id',
      category_name: 'category_name',
      purchase_unit: 'purchase_unit',
      purchase_quantity: 'purchase_quantity',
      purchase_unit_price: 'purchase_unit_price',
      base_unit: 'base_unit',
      base_unit_price: 'base_unit_price',
      base_quantity: 'base_quantity',
      amount: 'amount',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (item[key] !== undefined) {
        fields.push(`${dbField} = ?`);
        values.push(item[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE purchase_records SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    res.json(dbToFrontend(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM purchase_records WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/batch-save', async (req, res) => {
  try {
    const { date, items } = req.body;

    if (!date) {
      return res.status(400).json({ error: '缺少日期参数' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query(
        'SELECT id FROM purchase_records WHERE date = ?',
        [date]
      );
      const existingIds = new Set(existingRows.map(r => r.id));

      const incomingIds = new Set(
        items
          .map(item => item.id || item.ingredientId)
          .filter(id => id && id.length === 36)
      );

      const idsToDelete = [...existingIds].filter(id => !incomingIds.has(id));
      if (idsToDelete.length > 0) {
        const placeholders = idsToDelete.map(() => '?').join(',');
        await conn.query(
          `DELETE FROM purchase_records WHERE id IN (${placeholders})`,
          idsToDelete
        );
      }

      const savedItems = [];
      for (const item of items) {
        const id = item.id && item.id.length === 36 ? item.id : uuidv4();
        const ingredientId = item.ingredient_id || item.ingredientId;
        const ingredientName = item.ingredient_name || item.ingredientName;
        const categoryId = item.category_id || item.categoryId;
        const categoryName = item.category_name || item.categoryName;
        const purchaseUnit = item.purchase_unit || item.purchaseUnit;
        const purchaseQuantity = item.purchase_quantity ?? item.purchaseQuantity;
        const purchaseUnitPrice = item.purchase_unit_price ?? item.purchaseUnitPrice;
        const baseUnit = item.base_unit || item.baseUnit || '';
        const baseUnitPrice = item.base_unit_price ?? item.baseUnitPrice ?? 0;
        const baseQuantity = item.base_quantity ?? item.baseQuantity ?? 0;
        const amount = item.amount ?? 0;

        if (existingIds.has(id)) {
          await conn.query(
            `UPDATE purchase_records SET
              ingredient_id = ?, ingredient_name = ?,
              category_id = ?, category_name = ?,
              purchase_unit = ?, purchase_quantity = ?, purchase_unit_price = ?,
              base_unit = ?, base_unit_price = ?, base_quantity = ?,
              amount = ?
             WHERE id = ?`,
            [
              ingredientId, ingredientName,
              categoryId, categoryName,
              purchaseUnit, purchaseQuantity, purchaseUnitPrice,
              baseUnit, baseUnitPrice, baseQuantity,
              amount,
              id
            ]
          );
        } else {
          await conn.query(
            `INSERT INTO purchase_records 
             (id, date, ingredient_id, ingredient_name, category_id, category_name,
              purchase_unit, purchase_quantity, purchase_unit_price,
              base_unit, base_unit_price, base_quantity, amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id, date, ingredientId, ingredientName, categoryId, categoryName,
              purchaseUnit, purchaseQuantity, purchaseUnitPrice,
              baseUnit, baseUnitPrice, baseQuantity, amount
            ]
          );
        }

        savedItems.push({
          ...item,
          id,
          date,
          ingredient_id: ingredientId,
          ingredient_name: ingredientName,
          category_id: categoryId,
          category_name: categoryName,
          purchase_unit: purchaseUnit,
          purchase_quantity: purchaseQuantity,
          purchase_unit_price: purchaseUnitPrice,
          base_unit: baseUnit,
          base_unit_price: baseUnitPrice,
          base_quantity: baseQuantity,
          amount,
        });
      }

      await conn.commit();
      res.json(savedItems);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('batch-save error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/move-date', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id, newDate } = req.body;

    if (!id || !newDate) {
      return res.status(400).json({ error: '缺少参数' });
    }

    await conn.beginTransaction();

    const [itemRows] = await conn.query('SELECT * FROM purchase_records WHERE id = ?', [id]);
    if (itemRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }

    const item = itemRows[0];
    const oldDate = item.date;

    if (oldDate === newDate) {
      await conn.rollback();
      return res.status(400).json({ error: '目标日期与原日期相同' });
    }

    const [existingRows] = await conn.query(
      'SELECT * FROM purchase_records WHERE date = ? AND ingredient_id = ? AND purchase_unit = ?',
      [newDate, item.ingredient_id, item.purchase_unit]
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const newQuantity = parseFloat(existing.purchase_quantity) + parseFloat(item.purchase_quantity);
      const newAmount = parseFloat(existing.amount) + parseFloat(item.amount);

      await conn.query(
        'UPDATE purchase_records SET purchase_quantity = ?, amount = ? WHERE id = ?',
        [newQuantity, newAmount, existing.id]
      );
      await conn.query('DELETE FROM purchase_records WHERE id = ?', [id]);
    } else {
      await conn.query('UPDATE purchase_records SET date = ? WHERE id = ?', [newDate, id]);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('move-date error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.delete('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    await pool.query('DELETE FROM purchase_records WHERE date = ?', [date]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
