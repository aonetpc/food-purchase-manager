const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM suppliers ORDER BY sort_order ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, contact, phone, address, sort_order = 0 } = req.body;

    if (!name) {
      return res.status(400).json({ error: '供应商名称不能为空' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM suppliers WHERE name = ?',
      [name]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '该供应商名称已存在' });
    }

    const id = uuidv4();
    const [countResult] = await pool.query('SELECT COUNT(*) as cnt FROM suppliers');
    const newSortOrder = sort_order || countResult[0].cnt + 1;

    await pool.query(
      'INSERT INTO suppliers (id, name, contact, phone, address, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, contact || null, phone || null, address || null, newSortOrder]
    );

    const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact, phone, address } = req.body;

    if (!name) {
      return res.status(400).json({ error: '供应商名称不能为空' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM suppliers WHERE name = ? AND id != ?',
      [name, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '该供应商名称已存在' });
    }

    await pool.query(
      'UPDATE suppliers SET name = ?, contact = ?, phone = ?, address = ? WHERE id = ?',
      [name, contact || null, phone || null, address || null, id]
    );

    const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/move-up/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM suppliers ORDER BY sort_order ASC');
    const idx = rows.findIndex(r => r.id === id);
    if (idx <= 0) {
      return res.json({ success: false, message: '已经在最前面' });
    }
    const prev = rows[idx - 1];
    await pool.query('UPDATE suppliers SET sort_order = ? WHERE id = ?', [prev.sort_order, id]);
    await pool.query('UPDATE suppliers SET sort_order = ? WHERE id = ?', [rows[idx].sort_order, prev.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/move-down/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM suppliers ORDER BY sort_order ASC');
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0 || idx >= rows.length - 1) {
      return res.json({ success: false, message: '已经在最后面' });
    }
    const next = rows[idx + 1];
    await pool.query('UPDATE suppliers SET sort_order = ? WHERE id = ?', [next.sort_order, id]);
    await pool.query('UPDATE suppliers SET sort_order = ? WHERE id = ?', [rows[idx].sort_order, next.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;