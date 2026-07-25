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
const { getTodayStr, getCurrentMonthStr } = require('../utils/date');
const { requireAuth } = require('../middleware/rbac');
const { attachDataScope } = require('../middleware/tempDataScope');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function findChineseFont() {
  const paths = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Regular.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontpkg', 'source-han-sans-sc', 'SourceHanSansSC-Regular.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.ttf'
  ];
  for (const p of paths) {
    if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  }
  return null;
}

function findChineseBoldFont() {
  const paths = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Bold.otf'),
    path.join(__dirname, '..', 'node_modules', '@fontpkg', 'source-han-sans-sc', 'SourceHanSansSC-Bold.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Bold.ttf'
  ];
  for (const p of paths) {
    if (fs.existsSync(p) && !p.endsWith('.ttc')) return p;
  }
  return null;
}

// 统计总览
router.get('/overview', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || getCurrentMonthStr();
    
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      return res.status(400).json({ error: '月份格式不正确，应为 YYYY-MM' });
    }
    
    const params = [targetMonth, ...req.dataScope.params];

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

    const today = getTodayStr();
    const todayParams = [today, ...req.dataScope.params];

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
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

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
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

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
    const targetMonth = month || getCurrentMonthStr();
    const params = [targetMonth, ...req.dataScope.params];

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
    const today = getTodayStr();
    const params = [today, ...req.dataScope.params];

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
    const targetMonth = month || getCurrentMonthStr();
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

router.get('/export-salary', requireAuth, attachDataScope, async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || getCurrentMonthStr();

    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      return res.status(400).json({ error: '月份格式不正确，应为 YYYY-MM' });
    }

    const params = [targetMonth, ...req.dataScope.params];

    const [rows] = await pool.query(`
      SELECT
        u.name as worker_name,
        u.phone as worker_phone,
        cr.department_name as worker_department,
        COUNT(*) as checkin_count,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as approved_amount,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'discounted'
                         THEN cr.amount * cr.assessment_discount
                    WHEN cr.status = 'approved' THEN cr.amount ELSE 0 END), 0) as final_amount,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'discounted' THEN 1 ELSE 0 END), 0) as discounted_count,
        COALESCE(SUM(CASE WHEN cr.status = 'approved' AND cr.assessment_status = 'normal' THEN 1 ELSE 0 END), 0) as normal_count
      FROM checkin_records cr
      JOIN temp_worker_users u ON cr.user_id = u.id
      ${req.dataScope.join}
      WHERE DATE_FORMAT(cr.checkin_date, "%Y-%m") = ?
        AND cr.status = 'approved'
        AND ${req.dataScope.sql}
      GROUP BY cr.user_id, u.name, u.phone, cr.department_name
      ORDER BY cr.department_name ASC, u.name ASC
    `, params);

    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`工资表_${targetMonth}.pdf`)}`);

    doc.pipe(res);

    const chineseFont = findChineseFont();
    const chineseBoldFont = findChineseBoldFont();
    const hasChineseFont = !!chineseFont;
    if (hasChineseFont) {
      doc.registerFont('Chinese-Regular', chineseFont);
      doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
    }

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;

    doc.fontSize(16).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('外请人员工资表', { align: 'center' });
    doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(`${targetMonth}月份`, { align: 'center' });
    doc.moveDown(1);

    const colWidths = [60, 90, 70, 50, 50, 50, 70];
    const headers = ['姓名', '电话', '部门', '打卡次数', '正常考核', '折扣考核', '最终金额'];
    
    let y = doc.y;
    
    doc.fontSize(8).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
    let x = startX;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: colWidths[index], align: 'center' });
      x += colWidths[index];
    });
    y += 12;
    
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 4;

    let totalApproved = 0;
    let totalFinal = 0;
    let currentDepartment = '';
    let deptTotalApproved = 0;
    let deptTotalFinal = 0;

    doc.fontSize(8).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
    rows.forEach((row, index) => {
      const approved = parseFloat(row.approved_amount);
      const final = parseFloat(row.final_amount);
      const department = row.worker_department || '未分配';

      if (department !== currentDepartment) {
        if (currentDepartment !== '') {
          y += 4;
          doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke({ dash: [2, 2] });
          y += 6;
          doc.fontSize(8).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
          x = startX;
          doc.text(`${currentDepartment}小计`, x, y, { width: colWidths[0] + colWidths[1] + colWidths[2] });
          x += colWidths[0] + colWidths[1] + colWidths[2];
          doc.text('', x, y, { width: colWidths[3] });
          x += colWidths[3];
          doc.text('', x, y, { width: colWidths[4] });
          x += colWidths[4];
          doc.text('', x, y, { width: colWidths[5] });
          x += colWidths[5];
          doc.text('¥' + deptTotalFinal.toFixed(2), x, y, { width: colWidths[6], align: 'right' });
          y += 12;
          deptTotalApproved = 0;
          deptTotalFinal = 0;
        }
        currentDepartment = department;
        y += 4;
        doc.fontSize(8).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
        doc.text(`【${department}】`, startX, y);
        y += 10;
        doc.fontSize(8).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
      }

      x = startX;
      doc.text(row.worker_name, x, y, { width: colWidths[0], align: 'center' });
      x += colWidths[0];
      doc.text(row.worker_phone || '-', x, y, { width: colWidths[1], align: 'center' });
      x += colWidths[1];
      doc.text(department, x, y, { width: colWidths[2], align: 'center' });
      x += colWidths[2];
      doc.text(row.checkin_count.toString(), x, y, { width: colWidths[3], align: 'center' });
      x += colWidths[3];
      doc.text(row.normal_count.toString(), x, y, { width: colWidths[4], align: 'center' });
      x += colWidths[4];
      doc.text(row.discounted_count.toString(), x, y, { width: colWidths[5], align: 'center' });
      x += colWidths[5];
      doc.text('¥' + final.toFixed(2), x, y, { width: colWidths[6], align: 'right' });

      y += 14;

      if (index < rows.length - 1) {
        doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke({ color: '#eee' });
        y += 2;
      }

      totalApproved += approved;
      totalFinal += final;
      deptTotalApproved += approved;
      deptTotalFinal += final;
    });

    if (currentDepartment !== '') {
      y += 4;
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke({ dash: [2, 2] });
      y += 6;
      doc.fontSize(8).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
      x = startX;
      doc.text(`${currentDepartment}小计`, x, y, { width: colWidths[0] + colWidths[1] + colWidths[2] });
      x += colWidths[0] + colWidths[1] + colWidths[2];
      doc.text('', x, y, { width: colWidths[3] });
      x += colWidths[3];
      doc.text('', x, y, { width: colWidths[4] });
      x += colWidths[4];
      doc.text('', x, y, { width: colWidths[5] });
      x += colWidths[5];
      doc.text('¥' + deptTotalFinal.toFixed(2), x, y, { width: colWidths[6], align: 'right' });
      y += 12;
    }

    y += 8;
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 4;

    doc.fontSize(9).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold');
    x = startX;
    doc.text('合计', x, y, { width: colWidths[0] + colWidths[1] + colWidths[2] });
    x += colWidths[0] + colWidths[1] + colWidths[2];
    doc.text(rows.length.toString(), x, y, { width: colWidths[3], align: 'center' });
    x += colWidths[3];
    doc.text('', x, y, { width: colWidths[4] });
    x += colWidths[4];
    doc.text('', x, y, { width: colWidths[5] });
    x += colWidths[5];
    doc.text('¥' + totalFinal.toFixed(2), x, y, { width: colWidths[6], align: 'right' });

    y += 20;
    doc.fontSize(8).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
    doc.text('导出时间: ' + new Date().toLocaleString('zh-CN'), startX, y);

    doc.end();
  } catch (err) {
    console.error('export salary error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
