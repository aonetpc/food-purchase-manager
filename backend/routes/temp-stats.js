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
    const params = [...req.dataScope.params, targetMonth];

    const [rows] = await pool.query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COALESCE(SUM(CASE WHEN position_type = 'external' AND status = 'approved' THEN amount ELSE 0 END), 0) as external_amount,
        COALESCE(SUM(CASE WHEN position_type = 'internal' AND status = 'approved' THEN amount ELSE 0 END), 0) as internal_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' AND assessment_status = 'discounted'
                         THEN amount * assessment_discount
                    WHEN status = 'approved' THEN amount ELSE 0 END), 0) as final_amount,
        COUNT(DISTINCT user_id) as worker_count
      FROM checkin_records
      WHERE DATE_FORMAT(checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
    `, params);

    const overview = rows[0];
    overview.external_rate = (overview.external_amount + overview.internal_amount) > 0
      ? (overview.external_amount / (overview.external_amount + overview.internal_amount) * 100).toFixed(1)
      : 0;

    res.json(overview);
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
      WHERE DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND ${req.dataScope.sql}
      GROUP BY cr.department_id, d.name, d.full_path, dp.name
      ORDER BY external_amount + internal_amount DESC
    `, params);

    // 计算外请率
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

// 今日打卡概览（董事长看板）
router.get('/today', requireAuth, attachDataScope, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const params = [...req.dataScope.params, today];

    const [rows] = await pool.query(`
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
        COUNT(DISTINCT user_id) as worker_count,
        COUNT(DISTINCT position_id) as position_count
      FROM checkin_records
      WHERE checkin_date = ?
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
