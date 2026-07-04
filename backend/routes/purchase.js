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

    await pool.query('DELETE FROM purchase_records WHERE date = ?', [date]);

    const savedItems = [];
    for (const item of items) {
      const id = item.id && item.id.length === 36 ? item.id : uuidv4();
      await pool.query(
        `INSERT INTO purchase_records 
         (id, date, ingredient_id, ingredient_name, category_id, category_name,
          purchase_unit, purchase_quantity, purchase_unit_price,
          base_unit, base_unit_price, base_quantity, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          date,
          item.ingredient_id || item.ingredientId,
          item.ingredient_name || item.ingredientName,
          item.category_id || item.categoryId,
          item.category_name || item.categoryName,
          item.purchase_unit || item.purchaseUnit,
          item.purchase_quantity || item.purchaseQuantity,
          item.purchase_unit_price || item.purchaseUnitPrice,
          item.base_unit || item.baseUnit,
          item.base_unit_price || item.baseUnitPrice,
          item.base_quantity || item.baseQuantity,
          item.amount,
        ]
      );
      savedItems.push({ ...item, id, date });
    }

    res.json(savedItems);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
