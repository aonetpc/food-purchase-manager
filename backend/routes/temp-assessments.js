/**
 * 外请人员打卡模块 - 考核路由
 *
 * 接口列表：
 *   GET    /api/temp/assessments/pending    待考核列表（企微端）
 *   GET    /api/temp/assessments/done       已考核列表（企微端）
 *   POST   /api/temp/assessments/:id/submit  提交考核结果
 *   POST   /api/temp/assessments/:id/correct 修正考核结果
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getCurrentMonthStr } = require('../utils/date');
const { requireAuth } = require('../middleware/rbac');
const { attachDataScope } = require('../middleware/tempDataScope');
const { logOperation } = require('../middleware/logger');

// 待考核列表（按岗位分组）
router.get('/pending', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

    const [rows] = await pool.query(`
      SELECT
        cr.position_id,
        cr.position_name,
        cr.user_id,
        cr.user_name,
        cr.user_phone,
        p.need_assessment,
        COUNT(*) as total_count,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN cr.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as total_amount,
        MAX(cr.assessment_status) as assessment_status,
        MAX(cr.assessment_discount) as assessment_discount
      FROM checkin_records cr
      JOIN positions p ON cr.position_id = p.id
      ${req.dataScope.join}
      WHERE p.need_assessment = 1
        AND cr.status = 'approved'
        AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      GROUP BY cr.position_id, cr.user_id, cr.user_name, cr.user_phone, cr.position_name
      ORDER BY cr.position_name ASC, cr.user_name ASC
    `, params);

    // 按岗位分组
    const grouped = {};
    rows.forEach(row => {
      if (!grouped[row.position_id]) {
        grouped[row.position_id] = {
          position_id: row.position_id,
          position_name: row.position_name,
          workers: [],
        };
      }
      grouped[row.position_id].workers.push({
        user_id: row.user_id,
        user_name: row.user_name,
        user_phone: row.user_phone,
        total_count: row.total_count,
        approved_count: row.approved_count,
        rejected_count: row.rejected_count,
        total_amount: row.total_amount,
        assessment_status: row.assessment_status || 'pending',
        assessment_discount: parseFloat(row.assessment_discount) || 1.00,
        final_amount: row.assessment_status === 'discounted'
          ? parseFloat(row.total_amount) * parseFloat(row.assessment_discount)
          : parseFloat(row.total_amount),
      });
    });

    res.json(Object.values(grouped));
  } catch (err) {
    console.error('assessments pending error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 已考核列表
router.get('/done', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

    const [rows] = await pool.query(`
      SELECT
        cr.position_id, cr.position_name,
        cr.user_id, cr.user_name, cr.user_phone,
        COUNT(*) as total_count,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as total_amount,
        MAX(cr.assessment_status) as assessment_status,
        MAX(cr.assessment_discount) as assessment_discount,
        MAX(cr.assessed_at) as assessed_at,
        MAX(cr.assessed_by) as assessed_by
      FROM checkin_records cr
      JOIN positions p ON cr.position_id = p.id
      ${req.dataScope.join}
      WHERE p.need_assessment = 1
        AND cr.status = 'approved'
        AND cr.assessment_status != 'pending'
        AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      GROUP BY cr.position_id, cr.position_name, cr.user_id, cr.user_name, cr.user_phone
      ORDER BY cr.position_name ASC, cr.user_name ASC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('assessments done error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 提交考核结果
router.post('/:id/submit', requireAuth, async (req, res) => {
  try {
    // 这里 :id 是 user_id + position_id + month 的组合标识
    // 前端传：{ user_id, position_id, month, assessment_status, assessment_discount }
    const { user_id, position_id, month, assessment_status, assessment_discount = 1.00 } = req.body;

    if (!user_id || !position_id || !month) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    if (!['passed', 'discounted'].includes(assessment_status)) {
      return res.status(400).json({ error: '考核状态无效' });
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
      return res.status(403).json({ error: '无权考核此岗位' });
    }

    // 批量更新该用户该岗位当月所有已审核记录的考核状态
    await pool.query(`
      UPDATE checkin_records
      SET assessment_status = ?,
          assessment_discount = ?,
          assessed_by = ?,
          assessed_at = NOW()
      WHERE user_id = ? AND position_id = ?
        AND status = 'approved'
        AND DATE_FORMAT(checkin_date, "%Y-%m") = ?
    `, [assessment_status, assessment_discount, req.user.id, user_id, position_id, month]);

    await logOperation(req.user.id, user_id, 'temp_assessment', 'submit', {
      position_id, month, assessment_status, assessment_discount
    }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('assessment submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 修正考核结果（重新考核）
router.post('/:id/correct', requireAuth, async (req, res) => {
  try {
    const { user_id, position_id, month, assessment_status, assessment_discount = 1.00 } = req.body;

    if (!user_id || !position_id || !month) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 验证权限
    const [scopeCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
      [position_id, req.user.id]
    );

    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );

    if (scopeCheck.cnt === 0 && adminCheck.cnt === 0) {
      return res.status(403).json({ error: '无权修正此岗位考核' });
    }

    await pool.query(`
      UPDATE checkin_records
      SET assessment_status = ?,
          assessment_discount = ?,
          assessed_by = ?,
          assessed_at = NOW()
      WHERE user_id = ? AND position_id = ?
        AND status = 'approved'
        AND DATE_FORMAT(checkin_date, "%Y-%m") = ?
    `, [assessment_status, assessment_discount, req.user.id, user_id, position_id, month]);

    await logOperation(req.user.id, user_id, 'temp_assessment', 'correct', {
      position_id, month, assessment_status, assessment_discount
    }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('assessment correct error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 手机端兼容：单条考核记录列表
router.get('/', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

    const [rows] = await pool.query(`
      SELECT cr.*, p.need_assessment
      FROM checkin_records cr
      JOIN positions p ON cr.position_id = p.id
      ${req.dataScope.join}
      WHERE p.need_assessment = 1
        AND cr.status = 'approved'
        AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      ORDER BY cr.checkin_date DESC, cr.created_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('assessments list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 手机端兼容：按记录ID提交考核（实际会批量更新该用户当月该岗位）
router.post('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { discount } = req.body;

    // 根据记录ID查询对应的用户、岗位、月份
    const [records] = await pool.query(
      'SELECT user_id, position_id, checkin_date FROM checkin_records WHERE id = ?',
      [id]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const { user_id, position_id, checkin_date } = records[0];
    const month = String(checkin_date).substring(0, 7);
    const assessment_status = parseFloat(discount) === 1.0 ? 'passed' : 'discounted';
    const assessment_discount = parseFloat(discount) || 1.00;

    // 验证权限
    const [scopeCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM position_auditors WHERE position_id = ? AND user_id = ?`,
      [position_id, req.user.id]
    );
    const [adminCheck] = await pool.query(
      `SELECT COUNT(*) as cnt FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND r.code = 'admin'`,
      [req.user.id]
    );
    if (scopeCheck[0].cnt === 0 && adminCheck[0].cnt === 0) {
      return res.status(403).json({ error: '无权考核此岗位' });
    }

    // 批量更新
    await pool.query(`
      UPDATE checkin_records
      SET assessment_status = ?,
          assessment_discount = ?,
          assessed_by = ?,
          assessed_at = NOW()
      WHERE user_id = ? AND position_id = ?
        AND status = 'approved'
        AND DATE_FORMAT(checkin_date, "%Y-%m") = ?
    `, [assessment_status, assessment_discount, req.user.id, user_id, position_id, month]);

    await logOperation(req.user.id, user_id, 'temp_assessment', 'submit', {
      position_id, month, assessment_status, assessment_discount
    }, req);

    res.json({ success: true });
  } catch (err) {
    console.error('assessment post by id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 考核统计
router.get('/stats', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

    const [rows] = await pool.query(`
      SELECT
        COUNT(DISTINCT cr.user_id) as total,
        COUNT(DISTINCT CASE WHEN cr.assessment_status = 'pending' THEN cr.user_id END) as pending,
        COUNT(DISTINCT CASE WHEN cr.assessment_status = 'passed' THEN cr.user_id END) as passed,
        COUNT(DISTINCT CASE WHEN cr.assessment_status = 'discounted' THEN cr.user_id END) as discounted,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'discounted'
                         THEN cr.amount * cr.assessment_discount
                    WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as final_amount
      FROM checkin_records cr
      JOIN positions p ON cr.position_id = p.id
      ${req.dataScope.join}
      WHERE p.need_assessment = 1
        AND cr.status = 'approved'
        AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
    `, params);

    res.json(rows[0]);
  } catch (err) {
    console.error('assessment stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
