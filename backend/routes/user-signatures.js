const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const { user_id, user_source } = req.query;
    if (!user_id || !user_source) {
      return res.status(400).json({ error: '缺少用户ID或用户来源' });
    }

    const [rows] = await pool.query(
      'SELECT signature_data FROM user_signatures WHERE user_id = ? AND user_source = ?',
      [user_id, user_source]
    );

    if (rows.length === 0) {
      return res.json({ signature_data: null });
    }

    res.json({ signature_data: rows[0].signature_data });
  } catch (err) {
    console.error('get signature error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { user_id, user_source, signature_data } = req.body;
    if (!user_id || !user_source || !signature_data) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    await pool.query(
      'INSERT INTO user_signatures (id, user_id, user_source, signature_data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE signature_data = ?, updated_at = CURRENT_TIMESTAMP',
      [uuidv4(), user_id, user_source, signature_data, signature_data]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('save signature error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
