/**
 * 外请人员打卡模块 - 打卡路由
 *
 * 接口列表：
 *   POST   /api/temp/checkins            打卡提交（微信端）
 *   GET    /api/temp/checkins/my         我的打卡记录（微信端）
 *   GET    /api/temp/checkins/today      今日是否已打卡
 *   GET    /api/temp/checkins/summary    我的月度汇总（微信端）
 *   GET    /api/temp/checkins/pending    待审核列表（企微端）
 *   GET    /api/temp/checkins/approved   已审核列表（企微端）
 *   POST   /api/temp/checkins/:id/approve  审核通过（企微端）
 *   POST   /api/temp/checkins/:id/reject   审核驳回（企微端）
 *   POST   /api/temp/checkins/add-record   补录打卡（企微端）
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { requireAuth } = require('../middleware/rbac');
const { requireTempAuth, getTempUserPositions, getTempPositions } = require('../middleware/tempAuth');
const { attachDataScope } = require('../middleware/tempDataScope');
const { logOperation } = require('../middleware/logger');

// ================================================
// 微信端接口（外请人员）
// ================================================

// 打卡提交
router.post('/', requireTempAuth, async (req, res) => {
  try {
    const { position_id, hours } = req.body;

    if (!position_id) {
      return res.status(400).json({ error: '请选择岗位' });
    }

    // 查岗位信息
    const [posRows] = await pool.query(`
      SELECT p.*, d.name as department_name
      FROM positions p
      JOIN departments d ON p.department_id = d.id
      WHERE p.id = ? AND p.status = 1
    `, [position_id]);

    if (posRows.length === 0) {
      return res.status(400).json({ error: '岗位不存在或已禁用' });
    }

    const position = posRows[0];

    // 验证打卡权限：我的岗位 或 临时岗位（external）
    const myPositions = await getTempUserPositions(req.tempUser.id);
    const tempPositions = await getTempPositions();
    const allAllowed = [...myPositions, ...tempPositions];
    const canCheckin = allAllowed.some(p => p.id === position_id);

    if (!canCheckin) {
      return res.status(403).json({ error: '无权在该岗位打卡' });
    }

    // 计算金额
    let amount;
    if (position.pay_type === 'per_hour') {
      if (!hours || hours <= 0) {
        return res.status(400).json({ error: '请输入工作小时数' });
      }
      amount = parseFloat(position.rate) * parseFloat(hours);
    } else {
      amount = parseFloat(position.rate);
    }

    const today = new Date().toISOString().split('T')[0];
    const id = uuidv4();

    await pool.query(`
      INSERT INTO checkin_records
        (id, user_source, user_id, user_name, user_phone,
         position_id, position_name, position_type, department_id, department_name,
         checkin_date, hours, amount, status)
      VALUES (?, 'temp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      id, req.tempUser.id, req.tempUser.name, req.tempUser.phone,
      position_id, position.name, position.type, position.department_id, position.department_name,
      today, hours || null, amount
    ]);

    const [records] = await pool.query('SELECT * FROM checkin_records WHERE id = ?', [id]);
    res.json(records[0]);
  } catch (err) {
    console.error('checkin submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 我的打卡记录
router.get('/my', requireTempAuth, async (req, res) => {
  try {
    const { month } = req.query;
    let dateFilter = '';
    const params = [req.tempUser.id];

    if (month) {
      dateFilter = 'AND DATE_FORMAT(checkin_date, "%Y-%m") = ?';
      params.push(month);
    }

    const [rows] = await pool.query(`
      SELECT * FROM checkin_records
      WHERE user_source = 'temp' AND user_id = ?
      ${dateFilter}
      ORDER BY checkin_date DESC, created_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('my checkins error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 今日是否已打卡
router.get('/today', requireTempAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await pool.query(`
      SELECT position_id, position_name, checkin_date, status
      FROM checkin_records
      WHERE user_source = 'temp' AND user_id = ? AND checkin_date = ?
    `, [req.tempUser.id, today]);

    res.json({ checked: rows.length > 0, records: rows });
  } catch (err) {
    console.error('today checkin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 我的月度汇总
router.get('/summary', requireTempAuth, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().substring(0, 7);

    const [rows] = await pool.query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' AND assessment_status = 'discounted'
                         THEN amount * assessment_discount
                    WHEN status = 'approved' THEN amount ELSE 0 END), 0) as final_amount
      FROM checkin_records
      WHERE user_source = 'temp' AND user_id = ?
        AND DATE_FORMAT(checkin_date, "%Y-%m") = ?
    `, [req.tempUser.id, targetMonth]);

    res.json(rows[0]);
  } catch (err) {
    console.error('summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 企微端接口（审核员）
// ================================================

// 待审核列表
router.get('/pending', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, date } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [...req.dataScope.params];
    let dateFilter = '';

    if (date) {
      dateFilter = 'AND checkin_date = ?';
      params.push(date);
    }

    params.push(parseInt(pageSize), offset);

    const [rows] = await pool.query(`
      SELECT cr.*, pa.user_id as auditor_id
      FROM checkin_records cr
      LEFT JOIN position_auditors pa ON cr.position_id = pa.position_id
      WHERE cr.status = 'pending' AND ${req.dataScope.sql}
      ${dateFilter}
      ORDER BY cr.created_at DESC
      LIMIT ? OFFSET ?
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('pending list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 已审核列表
router.get('/approved', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, month, status } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [...req.dataScope.params];

    let filters = `AND cr.status IN ('approved', 'rejected')`;
    if (month) {
      filters += ' AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?';
      params.push(month);
    }
    if (status) {
      filters += ' AND cr.status = ?';
      params.push(status);
    }

    params.push(parseInt(pageSize), offset);

    const [rows] = await pool.query(`
      SELECT cr.*
      FROM checkin_records cr
      WHERE 1=1 AND ${req.dataScope.sql}
      ${filters}
      ORDER BY cr.audited_at DESC
      LIMIT ? OFFSET ?
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('approved list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 审核通过
router.post('/:id/approve', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { id } = req.params;
    const { audit_note, adjust_amount } = req.body;

    // 验证权限：审核员只能审核自己负责岗位的记录
    const [record] = await pool.query('SELECT * FROM checkin_records WHERE id = ?', [id]);
    if (record.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    // 检查数据权限
    const scopeCheck = await pool.query(
      `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
      [record[0].position_id, req.user.id]
    );

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );

    if (scopeCheck[0][0].cnt === 0 && adminCheck[0].cnt === 0) {
      return res.status(403).json({ error: '无权审核此岗位的记录' });
    }

    const finalAmount = adjust_amount !== undefined ? adjust_amount : record[0].amount;

    await pool.query(`
      UPDATE checkin_records
      SET status = 'approved', audit_by = ?, audit_note = ?, audited_at = NOW(),
          amount = ?
      WHERE id = ?
    `, [req.user.id, audit_note || null, finalAmount, id]);

    await logOperation(req.user.id, id, 'temp_checkin', 'approve', { audit_note, adjust_amount }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('approve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 审核驳回
router.post('/:id/reject', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { id } = req.params;
    const { audit_note } = req.body;

    if (!audit_note) {
      return res.status(400).json({ error: '请填写驳回原因' });
    }

    const [record] = await pool.query('SELECT * FROM checkin_records WHERE id = ?', [id]);
    if (record.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    // 检查数据权限
    const [scopeCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
      [record[0].position_id, req.user.id]
    );

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );

    if (scopeCheck.cnt === 0 && adminCheck.cnt === 0) {
      return res.status(403).json({ error: '无权审核此岗位的记录' });
    }

    await pool.query(`
      UPDATE checkin_records
      SET status = 'rejected', audit_by = ?, audit_note = ?, audited_at = NOW()
      WHERE id = ?
    `, [req.user.id, audit_note, id]);

    await logOperation(req.user.id, id, 'temp_checkin', 'reject', { audit_note }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('reject error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 补录打卡（审核员代填）
router.post('/add-record', requireAuth, async (req, res) => {
  try {
    const { user_name, user_phone, position_id, checkin_date, hours, add_reason } = req.body;

    if (!user_name || !position_id || !checkin_date) {
      return res.status(400).json({ error: '姓名、岗位、日期为必填' });
    }

    // 查岗位
    const [posRows] = await pool.query(`
      SELECT p.*, d.name as department_name
      FROM positions p
      JOIN departments d ON p.department_id = d.id
      WHERE p.id = ? AND p.status = 1
    `, [position_id]);

    if (posRows.length === 0) {
      return res.status(400).json({ error: '岗位不存在' });
    }
    const position = posRows[0];

    // 验证审核员有权操作该岗位
    const [scopeCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
      [position_id, req.user.id]
    );

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );

    if (scopeCheck.cnt === 0 && adminCheck.cnt === 0) {
      return res.status(403).json({ error: '无权在此岗位补录' });
    }

    // 尝试匹配已注册用户
    let matchedUserId = null;
    let userSource = 'temp';

    if (user_phone) {
      const [tempMatch] = await pool.query(
        'SELECT id FROM temp_worker_users WHERE phone = ? AND status = 1 LIMIT 1',
        [user_phone]
      );
      if (tempMatch.length > 0) {
        matchedUserId = tempMatch[0].id;
      }
    }

    if (!matchedUserId && user_name) {
      const [tempMatch] = await pool.query(
        'SELECT id FROM temp_worker_users WHERE name = ? AND status = 1 LIMIT 1',
        [user_name]
      );
      if (tempMatch.length > 0) {
        matchedUserId = tempMatch[0].id;
      }
    }

    // 计算金额
    let amount;
    if (position.pay_type === 'per_hour') {
      amount = parseFloat(position.rate) * parseFloat(hours || 0);
    } else {
      amount = parseFloat(position.rate);
    }

    const id = uuidv4();

    // 补录记录直接通过审核
    await pool.query(`
      INSERT INTO checkin_records
        (id, user_source, user_id, user_name, user_phone,
         position_id, position_name, position_type, department_id, department_name,
         checkin_date, hours, amount,
         status, audit_by, audited_at,
         is_add_record, add_reason, add_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW(), 1, ?, ?)
    `, [
      id, userSource, matchedUserId, user_name, user_phone || null,
      position_id, position.name, position.type, position.department_id, position.department_name,
      checkin_date, hours || null, amount,
      req.user.id, add_reason || null, req.user.id
    ]);

    await logOperation(req.user.id, id, 'temp_checkin', 'add_record', {
      user_name, user_phone, position_id, checkin_date, add_reason
    }, req);

    const [records] = await pool.query('SELECT * FROM checkin_records WHERE id = ?', [id]);
    res.json(records[0]);
  } catch (err) {
    console.error('add-record error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 分配岗位（审核员操作：为扫码用户分配岗位）
router.post('/assign-position', requireAuth, async (req, res) => {
  try {
    const { temp_user_id, position_id, is_primary = 0 } = req.body;

    if (!temp_user_id || !position_id) {
      return res.status(400).json({ error: '缺少用户ID或岗位ID' });
    }

    // 验证审核员有权操作该岗位
    const [scopeCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
      [position_id, req.user.id]
    );

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );

    if (scopeCheck.cnt === 0 && adminCheck.cnt === 0) {
      return res.status(403).json({ error: '无权分配此岗位' });
    }

    await pool.query(
      `INSERT IGNORE INTO user_positions (id, user_source, user_id, position_id, is_primary, assigned_by)
       VALUES (?, 'temp', ?, ?, ?, ?)`,
      [uuidv4(), temp_user_id, position_id, is_primary, req.user.id]
    );

    await logOperation(req.user.id, temp_user_id, 'temp_checkin', 'assign_position', { position_id }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('assign-position error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
