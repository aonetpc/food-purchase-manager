const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM categories ORDER BY sort_order ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, icon = '🏷️', color = '#666666' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '分类名称不能为空' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM categories WHERE name = ?',
      [name.trim()]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: '该分类名称已存在' });
    }

    const id = uuidv4();

    const [countResult] = await pool.query('SELECT COUNT(*) as cnt FROM categories');
    const sort_order = countResult[0].cnt + 1;

    await pool.query(
      'INSERT INTO categories (id, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), icon, color, sort_order]
    );

    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, color } = req.body;

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return res.status(400).json({ error: '分类名称不能为空' });
      }
      const [existing] = await pool.query(
        'SELECT id FROM categories WHERE name = ? AND id != ?',
        [trimmedName, id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: '该分类名称已存在' });
      }
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
    if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [catRows] = await pool.query('SELECT sort_order FROM categories WHERE id = ?', [id]);
    if (catRows.length === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }
    const deletedOrder = catRows[0].sort_order;

    await pool.query('DELETE FROM categories WHERE id = ?', [id]);

    await pool.query(
      'UPDATE categories SET sort_order = sort_order - 1 WHERE sort_order > ?',
      [deletedOrder]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/move-up', async (req, res) => {
  try {
    const { id } = req.params;

    const [catRows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    if (catRows.length === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }
    const current = catRows[0];

    const [prevRows] = await pool.query(
      'SELECT * FROM categories WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1',
      [current.sort_order]
    );
    if (prevRows.length === 0) {
      return res.status(400).json({ error: '已经是第一个了' });
    }
    const prev = prevRows[0];

    await pool.query('UPDATE categories SET sort_order = ? WHERE id = ?', [prev.sort_order, current.id]);
    await pool.query('UPDATE categories SET sort_order = ? WHERE id = ?', [current.sort_order, prev.id]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/move-down', async (req, res) => {
  try {
    const { id } = req.params;

    const [catRows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
    if (catRows.length === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }
    const current = catRows[0];

    const [nextRows] = await pool.query(
      'SELECT * FROM categories WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1',
      [current.sort_order]
    );
    if (nextRows.length === 0) {
      return res.status(400).json({ error: '已经是最后一个了' });
    }
    const next = nextRows[0];

    await pool.query('UPDATE categories SET sort_order = ? WHERE id = ?', [next.sort_order, current.id]);
    await pool.query('UPDATE categories SET sort_order = ? WHERE id = ?', [current.sort_order, next.id]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
