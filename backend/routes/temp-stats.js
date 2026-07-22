/**
 * 外请人员打卡模块 - 统计路由
 *
 * 接口列表：
 *   GET  /api/temp/stats/overview     统计总览（董事长/管理员）
 *   GET  /api/temp/stats/department   部门分析
 *   GET  /api/temp/stats/today        今日打卡概览
 *   GET  /api/temp/stats/auditor      审核员所辖岗位统计
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/rbac');
const { attachDataScope } = require('../middleware/tempDataScope');

// 统计总览
router.get('/overview', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().substring(0, 7);
    
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      return res.status(400).json({ error: '月份格式不正确，应为 YYYY-MM' });
    }
    
    const params = [...req.dataScope.params, targetMonth];

    const [checkinRows] = await pool.query(`
      SELECT
        COUNT(*) as month_checkins,
        SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END) as month_approved_amount,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'discounted'
                         THEN cr.amount * cr.assessment_discount
                    WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as month_final_amount,
        COUNT(DISTINCT cr.user_id) as active_workers
      FROM checkin_records cr
      ${req.dataScope.join}
      WHERE DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
    `, params);

    const today = new Date().toISOString().split('T')[0];
    const todayParams = [...req.dataScope.params, today];

    const [todayRows] = await pool.query(`
      SELECT COUNT(*) as today_checkins
      FROM checkin_records cr
      ${req.dataScope.join}
      WHERE cr.checkin_date = ?
        AND ${req.dataScope.sql}
    `, todayParams);

    const [userRows] = await pool.query(`
      SELECT COUNT(*) as total_workers
      FROM temp_worker_users
      WHERE status = 1
    `);

    res.json({
      total_workers: userRows[0].total_workers,
      active_workers: checkinRows[0].active_workers,
      today_checkins: todayRows[0].today_checkins,
      month_checkins: checkinRows[0].month_checkins,
      month_approved_amount: checkinRows[0].month_approved_amount,
      month_final_amount: checkinRows[0].month_final_amount,
    });
  } catch (err) {
    console.error('stats overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 部门分析
router.get('/department', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().substring(0, 7);
    const params = [...req.dataScope.params, targetMonth];

    const [rows] = await pool.query(`
      SELECT
        cr.department_id,
        d.name as department_name,
        d.full_path as department_path,
        dp.name as parent_dept_name,
        COUNT(*) as total_count,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        COALESCE(SUM(CASE WHEN cr.position_type = 'external' AND cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as external_amount,
        COALESCE(SUM(CASE WHEN cr.position_type = 'internal' AND cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as internal_amount,
        COUNT(DISTINCT cr.user_id) as worker_count
      FROM checkin_records cr
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN departments dp ON d.parent_id = dp.id
      ${req.dataScope.join}
      WHERE DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      GROUP BY cr.department_id, d.name, d.full_path, dp.name
      ORDER BY external_amount + internal_amount DESC
    `, params);

    rows.forEach(row => {
      const total = parseFloat(row.external_amount) + parseFloat(row.internal_amount);
      row.external_rate = total > 0
        ? (parseFloat(row.external_amount) / total * 100).toFixed(1)
        : 0;
    });

    res.json(rows);
  } catch (err) {
    console.error('stats department error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().substring(0, 7);
    const params = [...req.dataScope.params, targetMonth];

    const [rows] = await pool.query(`
      SELECT
        cr.department_id,
        d.name as department_name,
        COUNT(*) as total_checkins,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved_checkins,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'discounted'
                         THEN cr.amount * cr.assessment_discount
                    WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as final_amount,
        COUNT(DISTINCT cr.position_id) as position_count
      FROM checkin_records cr
      LEFT JOIN departments d ON cr.department_id = d.id
      ${req.dataScope.join}
      WHERE DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      GROUP BY cr.department_id, d.name
      ORDER BY approved_amount DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('stats departments error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/positions', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().substring(0, 7);
    const params = [...req.dataScope.params, targetMonth];

    const [rows] = await pool.query(`
      SELECT
        cr.position_id,
        cr.position_name,
        d.name as department_name,
        cr.position_type as type,
        COUNT(*) as total_checkins,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'discounted'
                         THEN cr.amount * cr.assessment_discount
                    WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as final_amount
      FROM checkin_records cr
      LEFT JOIN departments d ON cr.department_id = d.id
      ${req.dataScope.join}
      WHERE DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      GROUP BY cr.position_id, cr.position_name, d.name, cr.position_type
      ORDER BY approved_amount DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('stats positions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 今日打卡概览（董事长看板）
router.get('/today', requireAuth, attachDataScope, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const params = [...req.dataScope.params, today];

    const [rows] = await pool.query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN cr.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN cr.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COUNT(DISTINCT cr.user_id) as worker_count,
        COUNT(DISTINCT cr.position_id) as position_count
      FROM checkin_records cr
      ${req.dataScope.join}
      WHERE cr.checkin_date = ?
        AND ${req.dataScope.sql}
    `, params);

    // 按部门分布
    const [deptRows] = await pool.query(`
      SELECT
        d.name as department_name,
        COUNT(*) as count,
        SUM(CASE WHEN cr.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved
      FROM checkin_records cr
      JOIN departments d ON cr.department_id = d.id
      ${req.dataScope.join}
      WHERE cr.checkin_date = ?
        AND ${req.dataScope.sql}
      GROUP BY d.name
      ORDER BY count DESC
    `, params);

    res.json({
      summary: rows[0],
      departments: deptRows,
    });
  } catch (err) {
    console.error('stats today error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 审核员所辖岗位统计
router.get('/auditor', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().substring(0, 7);
    const userId = req.user.id;

    const [rows] = await pool.query(`
      SELECT
        p.id as position_id,
        p.name as position_name,
        p.type as position_type,
        d.name as department_name,
        COUNT(cr.id) as total_count,
        SUM(CASE WHEN cr.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN cr.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as approved_amount
      FROM position_auditors pa
      JOIN positions p ON pa.position_id = p.id
      JOIN departments d ON p.department_id = d.id
      LEFT JOIN checkin_records cr ON p.id = cr.position_id
        AND DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
      WHERE pa.user_id = ?
      GROUP BY p.id, p.name, p.type, d.name
      ORDER BY p.sort_order ASC
    `, [targetMonth, userId]);

    res.json(rows);
  } catch (err) {
    console.error('stats auditor error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
