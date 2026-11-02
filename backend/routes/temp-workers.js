/**
 * 外请人员打卡模块 - 人员管理路由（PC管理端）
 *
 * 接口列表：
 *   GET    /api/temp/workers           外请人员列表（管理员）
 *   POST   /api/temp/workers           新增人员（管理员手动建档，无手机人员兜底）
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

// 新增人员（管理员手动建档：无手机人员不扫码也可建档）
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '姓名为必填' });
    }
    const trimmedName = name.trim();
    const trimmedPhone = (phone && phone.trim()) || null;

    // 防重复建档（含禁用用户）
    if (trimmedPhone) {
      const [dup] = await pool.query(
        'SELECT id, status FROM temp_worker_users WHERE name = ? AND phone = ? LIMIT 1',
        [trimmedName, trimmedPhone]
      );
      if (dup.length > 0) {
        return res.status(400).json({ error: `已存在同名同手机号的人员档案（${dup[0].status === 1 ? '正常' : '已禁用'}），请勿重复建档` });
      }
    } else {
      const [dup] = await pool.query(
        'SELECT id, status FROM temp_worker_users WHERE name = ? LIMIT 1',
        [trimmedName]
      );
      if (dup.length > 0) {
        return res.status(400).json({ error: `已存在同名人员「${trimmedName}」（${dup[0].status === 1 ? '正常' : '已禁用'}），如确为不同人请填写手机号区分` });
      }
    }

    const id = uuidv4();
    await pool.query(
      'INSERT INTO temp_worker_users (id, name, phone, status) VALUES (?, ?, ?, 1)',
      [id, trimmedName, trimmedPhone]
    );

    await logOperation(req.user.id, id, 'temp_worker', 'create', { name: trimmedName, phone: trimmedPhone }, req);
    res.json({ success: true, id });
  } catch (err) {
    console.error('worker create error:', err);
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

    if (name !== undefined) {
      await pool.query(
        'UPDATE checkin_records SET user_name = ? WHERE user_source = ? AND user_id = ?',
        [name, 'temp', id]
      );
    }

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
