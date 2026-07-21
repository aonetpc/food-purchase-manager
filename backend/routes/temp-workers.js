/**
 * 外请人员打卡模块 - 人员管理路由（PC管理端）
 *
 * 接口列表：
 *   GET    /api/temp/workers           外请人员列表（管理员）
 *   GET    /api/temp/workers/:id       人员详情
 *   PUT    /api/temp/workers/:id       编辑人员（禁用/启用）
 *   GET    /api/temp/workers/:id/positions  人员已分配岗位
 *   POST   /api/temp/workers/:id/positions  分配岗位
 *   DELETE /api/temp/workers/:id/positions/:positionId  取消岗位分配
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/rbac');
const { logOperation } = require('../middleware/logger');

// 外请人员列表
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, status } = req.query;

    let sql = `
      SELECT twu.*,
             COUNT(up.id) as position_count,
             GROUP_CONCAT(p.name SEPARATOR ', ') as position_names
      FROM temp_worker_users twu
      LEFT JOIN user_positions up ON twu.id = up.user_id AND up.user_source = 'temp'
      LEFT JOIN positions p ON up.position_id = p.id AND p.status = 1
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (twu.name LIKE ? OR twu.phone LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (status !== undefined && status !== '') {
      sql += ' AND twu.status = ?';
      params.push(parseInt(status));
    }

    sql += ' GROUP BY twu.id ORDER BY twu.created_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('workers list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 人员详情
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT * FROM temp_worker_users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '人员不存在' });
    }

    // 获取已分配岗位
    const [positions] = await pool.query(`
      SELECT p.*, d.name as department_name, up.is_primary, up.assigned_at
      FROM user_positions up
      JOIN positions p ON up.position_id = p.id
      JOIN departments d ON p.department_id = d.id
      WHERE up.user_source = 'temp' AND up.user_id = ?
    `, [id]);

    res.json({ ...rows[0], positions });
  } catch (err) {
    console.error('worker detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 编辑人员（禁用/启用）
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, status } = req.body;

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有更新字段' });
    }

    values.push(id);
    await pool.query(`UPDATE temp_worker_users SET ${fields.join(', ')} WHERE id = ?`, values);

    await logOperation(req.user.id, id, 'temp_worker', 'update', req.body, req);

    res.json({ success: true });
  } catch (err) {
    console.error('worker update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取人员已分配岗位
router.get('/:id/positions', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT p.*, d.name as department_name, up.is_primary, up.assigned_at
      FROM user_positions up
      JOIN positions p ON up.position_id = p.id
      JOIN departments d ON p.department_id = d.id
      WHERE up.user_source = 'temp' AND up.user_id = ?
    `, [id]);
    res.json(rows);
  } catch (err) {
    console.error('worker positions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 分配岗位
router.post('/:id/positions', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { position_id, is_primary = 0 } = req.body;

    if (!position_id) {
      return res.status(400).json({ error: '缺少岗位ID' });
    }

    await pool.query(
      `INSERT IGNORE INTO user_positions (id, user_source, user_id, position_id, is_primary, assigned_by)
       VALUES (?, 'temp', ?, ?, ?, ?)`,
      [uuidv4(), id, position_id, is_primary, req.user.id]
    );

    await logOperation(req.user.id, id, 'temp_worker', 'assign_position', { position_id }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('assign position error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 取消岗位分配
router.delete('/:id/positions/:positionId', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id, positionId } = req.params;

    await pool.query(
      'DELETE FROM user_positions WHERE user_source = ? AND user_id = ? AND position_id = ?',
      ['temp', id, positionId]
    );

    await logOperation(req.user.id, id, 'temp_worker', 'remove_position', { position_id: positionId }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('remove position error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
