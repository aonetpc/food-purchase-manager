const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM departments ORDER BY sort_order ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, sort_order = 0 } = req.body;

    if (!name) {
      return res.status(400).json({ error: '部门名称不能为空' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM departments WHERE name = ?',
      [name]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '该部门名称已存在' });
    }

    const id = uuidv4();
    const [countResult] = await pool.query('SELECT COUNT(*) as cnt FROM departments');
    const newSortOrder = sort_order || countResult[0].cnt + 1;

    await pool.query(
      'INSERT INTO departments (id, name, sort_order) VALUES (?, ?, ?)',
      [id, name, newSortOrder]
    );

    const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sort_order } = req.body;

    if (name) {
      const [existing] = await pool.query(
        'SELECT id FROM departments WHERE name = ? AND id != ?',
        [name, id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: '该部门名称已存在' });
      }
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE departments SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM departments WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [purchaseCount] = await pool.query(
      'SELECT COUNT(*) as cnt FROM purchase_records WHERE department_id = ?',
      [id]
    );
    if (purchaseCount[0].cnt > 0) {
      return res.status(400).json({ error: '该部门下有采购记录，无法删除' });
    }

    await pool.query('DELETE FROM departments WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/move-up', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [rows] = await conn.query('SELECT id, sort_order FROM departments ORDER BY sort_order ASC');
    const idx = rows.findIndex(r => r.id === id);
    if (idx <= 0) {
      return res.status(400).json({ error: '已经是第一个部门' });
    }

    const current = rows[idx];
    const prev = rows[idx - 1];

    await conn.query('UPDATE departments SET sort_order = ? WHERE id = ?', [prev.sort_order, current.id]);
    await conn.query('UPDATE departments SET sort_order = ? WHERE id = ?', [current.sort_order, prev.id]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.post('/:id/move-down', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [rows] = await conn.query('SELECT id, sort_order FROM departments ORDER BY sort_order ASC');
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= rows.length - 1) {
      return res.status(400).json({ error: '已经是最后一个部门' });
    }

    const current = rows[idx];
    const next = rows[idx + 1];

    await conn.query('UPDATE departments SET sort_order = ? WHERE id = ?', [next.sort_order, current.id]);
    await conn.query('UPDATE departments SET sort_order = ? WHERE id = ?', [current.sort_order, next.id]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;