const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

function parseUnits(unitsData) {
  if (!unitsData) return null;
  if (typeof unitsData === 'string') {
    try {
      return JSON.parse(unitsData);
    } catch {
      return null;
    }
  }
  return unitsData;
}

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM ingredients ORDER BY name ASC'
    );
    const result = rows.map(row => ({
      ...row,
      units: parseUnits(row.units),
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

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '食材名称不能为空' });
    }
    if (!category_id) {
      return res.status(400).json({ error: '请选择食材分类' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM ingredients WHERE name = ? AND category_id = ?',
      [name.trim(), category_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '该分类下已存在相同名称的食材' });
    }

    const id = uuidv4();
    const unitsJson = units ? JSON.stringify(units) : null;

    await pool.query(
      `INSERT INTO ingredients (id, name, category_id, base_unit, base_price, image, units)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), category_id, base_unit, base_price, image, unitsJson]
    );

    const [rows] = await pool.query('SELECT * FROM ingredients WHERE id = ?', [id]);
    const result = {
      ...rows[0],
      units: parseUnits(rows[0].units),
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

    if (name !== undefined || category_id !== undefined) {
      const checkName = name !== undefined ? name.trim() : null;
      const checkCategory = category_id !== undefined ? category_id : null;

      if (checkName !== null && checkName === '') {
        return res.status(400).json({ error: '食材名称不能为空' });
      }

      let existingQuery = 'SELECT id FROM ingredients WHERE id != ? AND (';
      let existingParams = [id];
      let conditions = [];

      if (checkName !== null) {
        conditions.push('name = ?');
        existingParams.push(checkName);
      }
      if (checkCategory !== null) {
        conditions.push('category_id = ?');
        existingParams.push(checkCategory);
      }

      if (conditions.length > 0) {
        existingQuery += conditions.join(' AND ') + ') LIMIT 1';
        const [existing] = await pool.query(existingQuery, existingParams);
        if (existing.length > 0) {
          return res.status(400).json({ error: '该分类下已存在相同名称的食材' });
        }
      }
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
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
      units: parseUnits(rows[0].units),
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
