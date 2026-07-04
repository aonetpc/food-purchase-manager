const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await pool.query(
      'SELECT id, username, name, role FROM users WHERE username = ? AND password_hash = ?',
      [username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, name, role FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
