const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM ingredients ORDER BY name ASC'
    );
    const result = rows.map(row => ({
      ...row,
      units: row.units ? JSON.parse(row.units) : null,
      base_price: parseFloat(row.base_price),
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      name,
      category_id,
      base_unit,
      base_price,
      image = '',
      units,
    } = req.body;

    const id = uuidv4();
    const unitsJson = units ? JSON.stringify(units) : null;

    await pool.query(
      `INSERT INTO ingredients (id, name, category_id, base_unit, base_price, image, units)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, category_id, base_unit, base_price, image, unitsJson]
    );

    const [rows] = await pool.query('SELECT * FROM ingredients WHERE id = ?', [id]);
    const result = {
      ...rows[0],
      units: rows[0].units ? JSON.parse(rows[0].units) : null,
      base_price: parseFloat(rows[0].base_price),
    };
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, base_unit, base_price, image, units } = req.body;

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id); }
    if (base_unit !== undefined) { fields.push('base_unit = ?'); values.push(base_unit); }
    if (base_price !== undefined) { fields.push('base_price = ?'); values.push(base_price); }
    if (image !== undefined) { fields.push('image = ?'); values.push(image); }
    if (units !== undefined) { fields.push('units = ?'); values.push(JSON.stringify(units)); }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE ingredients SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM ingredients WHERE id = ?', [id]);
    const result = {
      ...rows[0],
      units: rows[0].units ? JSON.parse(rows[0].units) : null,
      base_price: parseFloat(rows[0].base_price),
    };
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM ingredients WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
