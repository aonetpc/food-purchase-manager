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
    let posRows;
    let realPositionId = position_id;
    if (position_id === 'temp-position-default') {
      // 临时岗位：从数据库查找，没有则自动创建
      const [tempRows] = await pool.query(
        `SELECT p.*, d.full_path as department_name
         FROM positions p
         JOIN departments d ON p.department_id = d.id
         WHERE p.name = '临时岗位' AND p.status = 1 LIMIT 1`
      );
      if (tempRows.length > 0) {
        posRows = tempRows;
        realPositionId = tempRows[0].id;
      } else {
        // 自动创建临时岗位
        const newTempId = 'temp-position-default';
        try {
          await pool.query(
            `INSERT INTO positions (id, department_id, name, type, pay_type, rate, need_assessment, sort_order, status)
             VALUES (?, NULL, '临时岗位', 'external', 'per_time', 0, 0, 999, 1)`,
            [newTempId]
          );
        } catch (e) {
          // 已存在则忽略
        }
        const [newRows] = await pool.query(
          `SELECT p.*, d.full_path as department_name
           FROM positions p LEFT JOIN departments d ON p.department_id = d.id
           WHERE p.id = ?`,
          [newTempId]
        );
        posRows = newRows;
        realPositionId = newTempId;
      }
    } else {
      [posRows] = await pool.query(`
        SELECT p.*, d.full_path as department_name
        FROM positions p
        JOIN departments d ON p.department_id = d.id
        WHERE p.id = ? AND p.status = 1
      `, [position_id]);
    }

    if (!posRows || posRows.length === 0) {
      return res.status(400).json({ error: '岗位不存在或已禁用' });
    }

    const position = posRows[0];

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
    const checkinTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const id = uuidv4();

    // 检查每日打卡次数限制（按次岗位）
    if (position.pay_type === 'per_time') {
      const dailyLimit = position.daily_limit || 1;
      if (dailyLimit > 0) {
        const [countRows] = await pool.query(`
          SELECT COUNT(*) as cnt FROM checkin_records
          WHERE user_source = 'temp' AND user_id = ?
            AND position_id = ? AND checkin_date = ?
        `, [req.tempUser.id, realPositionId, today]);
        
        if (countRows[0].cnt >= dailyLimit) {
          return res.status(400).json({ error: `今日该岗位已打卡${dailyLimit}次，不能再打卡` });
        }
      }
    }

    await pool.query(`
      INSERT INTO checkin_records
        (id, user_source, user_id, user_name, user_phone,
         position_id, position_name, position_type, department_id, department_name,
         checkin_date, checkin_time, hours, amount, status)
      VALUES (?, 'temp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      id, req.tempUser.id, req.tempUser.name, req.tempUser.phone,
      realPositionId, position.name, position.type, position.department_id, position.department_name,
      today, checkinTime, hours || null, amount
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
      SELECT position_id, position_name, checkin_date, checkin_time, status, hours, amount
      FROM checkin_records
      WHERE user_source = 'temp' AND user_id = ? AND checkin_date = ?
      ORDER BY checkin_time DESC
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
    const { date } = req.query;
    const params = [...req.dataScope.params];
    let dateFilter = '';

    if (date) {
      dateFilter = 'AND cr.checkin_date = ?';
      params.push(date);
    }

    const [rows] = await pool.query(`
      SELECT cr.*, pa.user_id as auditor_id, d.full_path as department_name
      FROM checkin_records cr
      LEFT JOIN position_auditors pa ON cr.position_id = pa.position_id
      LEFT JOIN departments d ON cr.department_id = d.id
      ${req.dataScope.join}
      WHERE cr.status = 'pending' AND ${req.dataScope.sql}
      ${dateFilter}
      ORDER BY cr.checkin_time DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('pending list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 历史未审核统计
router.get('/audit/historical-pending', requireAuth, attachDataScope, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const params = [...req.dataScope.params];

    const [rows] = await pool.query(`
      SELECT 
        cr.checkin_date as date,
        COUNT(*) as count,
        DATEDIFF(CURDATE(), cr.checkin_date) as days_ago
      FROM checkin_records cr
      ${req.dataScope.join}
      WHERE cr.status = 'pending' 
        AND ${req.dataScope.sql}
        AND cr.checkin_date < ?
      GROUP BY cr.checkin_date
      ORDER BY cr.checkin_date DESC
      LIMIT 7
    `, [...params, today]);

    res.json(rows);
  } catch (err) {
    console.error('historical pending error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 打卡记录列表（支持按日期和状态筛选）
router.get('/list', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { date, status } = req.query;
    const params = [...req.dataScope.params];
    let filters = '';

    if (date) {
      filters += ' AND cr.checkin_date = ?';
      params.push(date);
    }

    if (status === 'pending') {
      filters += ` AND cr.status = 'pending'`;
    } else if (status === 'approved') {
      filters += ` AND cr.status = 'approved'`;
    } else if (status === 'rejected') {
      filters += ` AND cr.status = 'rejected'`;
    } else if (status === 'temp_pending') {
      filters += ` AND cr.status = 'pending' AND p.name = '临时岗位'`;
    }

    const [rows] = await pool.query(`
      SELECT cr.*, p.name as position_name, p.pay_type, d.full_path as department_name
      FROM checkin_records cr
      LEFT JOIN positions p ON cr.position_id = p.id
      LEFT JOIN departments d ON cr.department_id = d.id
      ${req.dataScope.join}
      WHERE ${req.dataScope.sql}
      ${filters}
      ORDER BY cr.checkin_time DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('checkin list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 已审核列表
router.get('/approved', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, month, status } = req.query;
    const offset = (page - 1) * pageSize;
    const params = [...req.dataScope.params];

    let filters = '';
    if (status === 'approved') {
      filters = `AND cr.status = 'approved'`;
    } else if (status === 'rejected') {
      filters = `AND cr.status = 'rejected'`;
    } else {
      filters = `AND cr.status IN ('approved', 'rejected')`;
    }
    if (month) {
      filters += ' AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?';
      params.push(month);
    }

    params.push(parseInt(pageSize), offset);

    const [rows] = await pool.query(`
      SELECT cr.*, d.full_path as department_name
      FROM checkin_records cr
      LEFT JOIN departments d ON cr.department_id = d.id
      ${req.dataScope.join}
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
    const { audit_note, adjust_amount, adjust_hours, assign_position_id } = req.body;

    // 验证权限：审核员只能审核自己负责岗位的记录
    const [record] = await pool.query('SELECT * FROM checkin_records WHERE id = ?', [id]);
    if (record.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );
    const isAdmin = adminCheck[0].cnt > 0;

    // 临时岗位打卡记录：任何审核员都能审核，管理员默认能审核
    const [isTempPos] = await pool.query(
      `SELECT COUNT(*) as cnt FROM positions WHERE id = ? AND name = '临时岗位'`,
      [record[0].position_id]
    );
    const isTempPosition = isTempPos[0].cnt > 0;

    if (!isAdmin && !isTempPosition) {
      // 非管理员且非临时岗位：检查数据权限
      const [scopeCheck] = await pool.query(
        `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
        [record[0].position_id, req.user.id]
      );
      if (scopeCheck[0].cnt === 0) {
        return res.status(403).json({ error: '无权审核此岗位的记录' });
      }
    }

    // 如果需要分配岗位，验证审核员有权操作该岗位
    if (assign_position_id) {
      const [assignScopeCheck] = await pool.query(
        `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
        [assign_position_id, req.user.id]
      );
      if (assignScopeCheck[0].cnt === 0 && adminCheck[0].cnt === 0) {
        return res.status(403).json({ error: '无权分配此岗位' });
      }

      const [posRows] = await pool.query(`
        SELECT p.*, d.name as department_name
        FROM positions p
        JOIN departments d ON p.department_id = d.id
        WHERE p.id = ? AND p.status = 1
      `, [assign_position_id]);

      if (posRows.length === 0) {
        return res.status(400).json({ error: '分配的岗位不存在' });
      }

      const position = posRows[0];
      const newHours = adjust_hours !== undefined ? adjust_hours : record[0].hours;

      const newAmount = adjust_amount !== undefined 
        ? adjust_amount 
        : (position.pay_type === 'per_hour' 
            ? parseFloat(position.rate) * parseFloat(newHours || 0) 
            : parseFloat(position.rate));

      await pool.query(`
        UPDATE checkin_records
        SET status = 'approved', audit_by = ?, audit_note = ?, audited_at = NOW(),
            amount = ?, hours = ?,
            position_id = ?, position_name = ?, position_type = ?,
            department_id = ?, department_name = ?
        WHERE id = ?
      `, [req.user.id, audit_note || null, newAmount, newHours,
          assign_position_id, position.name, position.type,
          position.department_id, position.department_name, id]);

      if (record[0].user_source === 'temp') {
        await pool.query(
          `INSERT IGNORE INTO user_positions (id, user_source, user_id, position_id, is_primary, assigned_by)
           VALUES (?, 'temp', ?, ?, 1, ?)`,
          [uuidv4(), record[0].user_id, assign_position_id, req.user.id]
        );
      }
    } else {
      const finalHours = adjust_hours !== undefined ? adjust_hours : record[0].hours;
      const finalAmount = adjust_amount !== undefined ? adjust_amount : record[0].amount;

      await pool.query(`
        UPDATE checkin_records
        SET status = 'approved', audit_by = ?, audit_note = ?, audited_at = NOW(),
            amount = ?, hours = ?
        WHERE id = ?
      `, [req.user.id, audit_note || null, finalAmount, finalHours, id]);
    }

    await logOperation(req.user.id, id, 'temp_checkin', 'approve', { audit_note, adjust_amount, adjust_hours, assign_position_id }, req);

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

    if (scopeCheck[0].cnt === 0 && adminCheck[0].cnt === 0) {
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

router.put('/:id/re-audit', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { adjust_amount, assign_position_id, audit_note } = req.body;

    const [record] = await pool.query('SELECT * FROM checkin_records WHERE id = ?', [id]);
    if (record.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );
    const isAdmin = adminCheck[0].cnt > 0;

    if (!isAdmin) {
      const [scopeCheck] = await pool.query(
        `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
        [record[0].position_id, req.user.id]
      );
      if (scopeCheck[0].cnt === 0) {
        return res.status(403).json({ error: '无权修改此记录' });
      }
    }

    let updateData = { audit_by: req.user.id, audited_at: new Date() };
    if (audit_note) updateData.audit_note = audit_note;

    if (assign_position_id) {
      const [posRows] = await pool.query(`
        SELECT p.*, d.name as department_name
        FROM positions p
        JOIN departments d ON p.department_id = d.id
        WHERE p.id = ? AND p.status = 1
      `, [assign_position_id]);

      if (posRows.length === 0) {
        return res.status(400).json({ error: '岗位不存在' });
      }

      const position = posRows[0];
      const newAmount = adjust_amount !== undefined
        ? adjust_amount
        : (position.pay_type === 'per_hour'
            ? parseFloat(position.rate) * parseFloat(record[0].hours || 0)
            : parseFloat(position.rate));

      updateData.position_id = assign_position_id;
      updateData.position_name = position.name;
      updateData.position_type = position.type;
      updateData.department_id = position.department_id;
      updateData.department_name = position.department_name;
      updateData.amount = newAmount;

      if (record[0].user_source === 'temp') {
        await pool.query(
          `INSERT IGNORE INTO user_positions (id, user_source, user_id, position_id, is_primary, assigned_by)
           VALUES (?, 'temp', ?, ?, 1, ?)`,
          [uuidv4(), record[0].user_id, assign_position_id, req.user.id]
        );
      }
    } else if (adjust_amount !== undefined) {
      updateData.amount = adjust_amount;
    }

    const updateFields = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
    const updateValues = Object.values(updateData);
    updateValues.push(id);

    await pool.query(`UPDATE checkin_records SET ${updateFields} WHERE id = ?`, updateValues);

    await logOperation(req.user.id, id, 'temp_checkin', 're-audit', { adjust_amount, assign_position_id, audit_note }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('re-audit error:', err);
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
      SELECT p.*, d.full_path as department_name
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

    if (scopeCheck[0].cnt === 0 && adminCheck[0].cnt === 0) {
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

    if (scopeCheck[0].cnt === 0 && adminCheck[0].cnt === 0) {
      return res.status(403).json({ error: '无权审核此岗位' });
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

// 审核统计
router.get('/audit/stats', requireAuth, attachDataScope, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN cr.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN cr.status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN cr.checkin_date = ? THEN 1 ELSE 0 END) as today_checkins,
        SUM(CASE WHEN cr.status = 'pending' AND cr.checkin_date < ? THEN 1 ELSE 0 END) as historical_pending,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN cr.status = 'pending' THEN cr.amount ELSE 0 END), 0) as pending_amount
      FROM checkin_records cr
      ${req.dataScope.join}
      WHERE ${req.dataScope.sql}
    `, [today, today, ...req.dataScope.params]);

    res.json(rows[0]);
  } catch (err) {
    console.error('audit stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
