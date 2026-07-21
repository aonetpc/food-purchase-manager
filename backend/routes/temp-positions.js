/**
 * 外请人员打卡模块 - 岗位管理路由
 *
 * 接口列表：
 *   GET    /api/temp/positions           获取岗位列表
 *   POST   /api/temp/positions           创建岗位（管理员）
 *   PUT    /api/temp/positions/:id       更新岗位（管理员）
 *   DELETE /api/temp/positions/:id       删除岗位（管理员）
 *   GET    /api/temp/positions/:id/auditors  获取岗位审核员
 *   POST   /api/temp/positions/:id/auditors  分配审核员
 *   DELETE /api/temp/positions/:id/auditors/:userId  移除审核员
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/rbac');
const { logOperation } = require('../middleware/logger');

// 获取岗位列表（管理员/审核员可调用）
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, d.name as department_name, d.full_path as department_path,
             (SELECT COUNT(*) FROM position_auditors pa WHERE pa.position_id = p.id) as auditor_count,
             (SELECT COUNT(*) FROM user_positions up WHERE up.position_id = p.id) as worker_count
      FROM positions p
      LEFT JOIN departments d ON p.department_id = d.id
      ORDER BY d.sort_order ASC, p.sort_order ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 创建岗位（管理员）
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, department_id, type, pay_type, rate, need_assessment = 0, sort_order = 0 } = req.body;

    if (!name || !department_id || !type || !pay_type || rate === undefined) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO positions (id, department_id, name, type, pay_type, rate, need_assessment, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, department_id, name, type, pay_type, rate, need_assessment, sort_order]
    );

    await logOperation(req.user.id, null, 'temp_position', 'create', { name, department_id, type, pay_type, rate }, req);

    const [rows] = await pool.query('SELECT * FROM positions WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 更新岗位（管理员）
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, department_id, type, pay_type, rate, need_assessment, sort_order, status } = req.body;

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (department_id !== undefined) { fields.push('department_id = ?'); values.push(department_id); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (pay_type !== undefined) { fields.push('pay_type = ?'); values.push(pay_type); }
    if (rate !== undefined) { fields.push('rate = ?'); values.push(rate); }
    if (need_assessment !== undefined) { fields.push('need_assessment = ?'); values.push(need_assessment); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE positions SET ${fields.join(', ')} WHERE id = ?`, values);

    await logOperation(req.user.id, id, 'temp_position', 'update', req.body, req);

    const [rows] = await pool.query('SELECT * FROM positions WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 删除岗位（管理员，软删除）
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // 检查是否有打卡记录
    const [count] = await pool.query(
      'SELECT COUNT(*) as cnt FROM checkin_records WHERE position_id = ?',
      [id]
    );
    if (count[0].cnt > 0) {
      // 有记录则禁用
      await pool.query('UPDATE positions SET status = 0 WHERE id = ?', [id]);
      return res.json({ success: true, message: '岗位已有打卡记录，已禁用' });
    }

    await pool.query('DELETE FROM positions WHERE id = ?', [id]);
    await logOperation(req.user.id, id, 'temp_position', 'delete', {}, req);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 获取岗位审核员列表
router.get('/:id/auditors', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT pa.id, pa.user_id, u.name, u.username, u.phone, u.role
      FROM position_auditors pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.position_id = ?
      ORDER BY u.name ASC
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 分配审核员到岗位
router.post('/:id/auditors', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: '缺少审核员ID' });
    }

    await pool.query(
      'INSERT IGNORE INTO position_auditors (id, position_id, user_id) VALUES (?, ?, ?)',
      [uuidv4(), id, user_id]
    );

    await logOperation(req.user.id, id, 'temp_position', 'assign_auditor', { user_id }, req);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 移除审核员
router.delete('/:id/auditors/:userId', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, userId } = req.params;
    await pool.query(
      'DELETE FROM position_auditors WHERE position_id = ? AND user_id = ?',
      [id, userId]
    );

    await logOperation(req.user.id, id, 'temp_position', 'remove_auditor', { user_id: userId }, req);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
