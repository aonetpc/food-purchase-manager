const express = require('express');
const router = express.Router();
const pool = require('../db');
const PDFDocument = require('pdfkit');
const { findChineseFont, findChineseBoldFont, toNum } = require('../utils/pdf');
const { requireAuth } = require('../middleware/rbac');

function formatMoney(n) {
  const v = toNum(n);
  return v === 0 ? 0 : v;
}

/** 构建二维表数据（按分类×部门矩阵）
 *  @param rawRows [{ category_id, category, category_parent_id, category_parent, dept_id, dept_name, amount }]
 *  @param deptIdsSorted   部门ID排序（可传空则按出现顺序）
 */
function buildMatrix(rawRows, deptIdsSorted = null) {
  // 1. 整理部门顺序
  const deptMap = new Map(); // deptId -> {id, name}
  for (const r of rawRows) {
    if (!r.dept_id) continue;
    if (!deptMap.has(r.dept_id)) {
      deptMap.set(r.dept_id, { id: r.dept_id, name: r.dept_name || '未命名部门' });
    }
  }
  let depts;
  if (deptIdsSorted && deptIdsSorted.length > 0) {
    depts = deptIdsSorted.filter(id => deptMap.has(id)).map(id => deptMap.get(id));
    // 追加未出现在sorted里的
    for (const [id, d] of deptMap.entries()) {
      if (!deptIdsSorted.includes(id)) depts.push(d);
    }
  } else {
    depts = Array.from(deptMap.values());
  }
  const deptIdx = {};
  depts.forEach((d, i) => { deptIdx[d.id] = i; });
  const deptNames = depts.map(d => d.name);

  // 2. 整理分类（L1+L2结构，扁平化为行，保留L1/L2层级信息用于前端渲染可选分组）
  const l1Map = {}; // l1Id -> { l1Id, name, sort: 0, children: Map<l2Id, {l2Id, name, values:number[]}> }
  for (const r of rawRows) {
    const l1Id = r.category_parent_id || '__no_parent__';
    const l1Name = r.category_parent || '未分类';
    const l2Id = r.category_id;
    const l2Name = r.category || '未命名';
    if (!l1Map[l1Id]) {
      l1Map[l1Id] = { l1Id, name: l1Name, children: new Map() };
    }
    if (!l1Map[l1Id].children.has(l2Id)) {
      const values = new Array(depts.length).fill(0);
      l1Map[l1Id].children.set(l2Id, { l2Id, name: l2Name, values });
    }
    const node = l1Map[l1Id].children.get(l2Id);
    const idx = deptIdx[r.dept_id];
    if (idx !== undefined) {
      node.values[idx] = (node.values[idx] || 0) + toNum(r.amount);
    }
  }

  // 3. 扁平化 rows
  const rows = [];
  for (const l1 of Object.values(l1Map)) {
    for (const node of l1.children.values()) {
      const vals = node.values.map(formatMoney);
      const rowTotal = vals.reduce((s, v) => s + toNum(v), 0);
      rows.push({
        l1Id: l1.l1Id,
        l1Name: l1.name,
        l2Id: node.l2Id,
        l2Name: node.name,
        category: node.name,        // 兼容字段
        values: vals,
        total: formatMoney(rowTotal),
      });
    }
  }

  // 4. 合计行
  const totals = new Array(depts.length).fill(0);
  for (const row of rows) {
    row.values.forEach((v, i) => { totals[i] = (totals[i] || 0) + toNum(v); });
  }
  const grandTotal = totals.reduce((s, v) => s + toNum(v), 0);

  return {
    departments: deptNames,
    departmentIds: depts.map(d => d.id),
    rows,
    totals: totals.map(formatMoney),
    grandTotal: formatMoney(grandTotal),
  };
}

/** ============== 1. 固定资产库存 ============== */
router.get('/fixed-assets', requireAuth, async (req, res) => {
  try {
    // 先查出所有部门，作为列顺序（确保无数据的部门列也显示）
    const [deptRows] = await pool.query(
      `SELECT id, name FROM departments WHERE status = 1 ORDER BY sort_order ASC, created_at ASC`
    );
    const deptIdsSorted = deptRows.map(d => d.id);

    const [rows] = await pool.query(`
      SELECT wc.id as category_id, wc.name as category,
             wc.parent_id as category_parent_id, wc_p.name as category_parent,
             w.department_id as dept_id, d.name as dept_name,
             SUM(i.quantity * IFNULL(wi.reference_price, 0)) as amount
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      JOIN warehouses w ON i.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.type = 'dept'
        AND i.quantity > 0
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
    `);

    const matrix = buildMatrix(rows, deptIdsSorted);

    // 环比（上月末 → 当前）
    let lastMonth = null;
    try {
      const today = new Date();
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const firstOfMonthStr = firstOfMonth.toISOString().slice(0, 10);
      const [lastRows] = await pool.query(`
        SELECT wc.id as category_id, wc.name as category,
               wc.parent_id as category_parent_id, wc_p.name as category_parent,
               w.department_id as dept_id, d.name as dept_name,
               SUM(i.quantity * IFNULL(wi.reference_price, 0)) as amount
        FROM inventory i
        JOIN warehouse_items wi ON i.item_id = wi.id
        JOIN warehouse_categories wc ON wi.category_id = wc.id
        LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
        JOIN warehouses w ON i.warehouse_id = w.id
        LEFT JOIN departments d ON w.department_id = d.id
        WHERE w.type = 'dept'
          AND i.quantity > 0
          AND DATE(i.updated_at) < ?
        GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
      `, [firstOfMonthStr]);
      const lastMatrix = buildMatrix(lastRows, deptIdsSorted);
      lastMonth = { grandTotal: lastMatrix.grandTotal, totals: lastMatrix.totals };
    } catch (e) { /* 环比失败不影响主数据 */ }

    res.json({ ...matrix, lastMonth });
  } catch (err) {
    console.error('[fixed-assets] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** ============== 2. 原材料当月消耗 ============== */
router.get('/material-consumption', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '参数 month 格式错误，需要 YYYY-MM' });
    }

    const [deptRows] = await pool.query(
      `SELECT id, name FROM departments WHERE status = 1 ORDER BY sort_order ASC, created_at ASC`
    );
    const deptIdsSorted = deptRows.map(d => d.id);

    // 扫码领料入库到部门仓 = 部门消耗（movement_type='inbound'）
    // 即买即用消耗（movement_type='expense'）
    const [rows] = await pool.query(`
      SELECT wc.id as category_id, wc.name as category,
             wc.parent_id as category_parent_id, wc_p.name as category_parent,
             sm.department_id as dept_id, sm.department_name as dept_name,
             SUM(IFNULL(sm.total_amount, 0)) as amount
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE sm.movement_type IN ('inbound', 'expense')
        AND sm.related_type = 'scan'
        AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, sm.department_id, sm.department_name
    `, [month]);

    const matrix = buildMatrix(rows, deptIdsSorted);

    // 上月环比
    let lastMonth = null;
    try {
      const [y, m] = month.split('-').map(Number);
      const lastDate = new Date(y, m - 2, 1);
      const lastYM = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;
      const [lastRows] = await pool.query(`
        SELECT wc.id as category_id, wc.name as category,
               wc.parent_id as category_parent_id, wc_p.name as category_parent,
               sm.department_id as dept_id, sm.department_name as dept_name,
               SUM(IFNULL(sm.total_amount, 0)) as amount
        FROM stock_movements sm
        JOIN warehouse_items wi ON sm.item_id = wi.id
        JOIN warehouse_categories wc ON wi.category_id = wc.id
        LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
        WHERE sm.movement_type IN ('inbound', 'expense')
          AND sm.related_type = 'scan'
          AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
        GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, sm.department_id, sm.department_name
      `, [lastYM]);
      const lastMatrix = buildMatrix(lastRows, deptIdsSorted);
      lastMonth = { grandTotal: lastMatrix.grandTotal, totals: lastMatrix.totals, month: lastYM };
    } catch (e) { /* ignore */ }

    res.json({ ...matrix, lastMonth, month });
  } catch (err) {
    console.error('[material-consumption] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** ============== 3. 单元格明细（点击弹窗） ============== */
/** 固定资产明细 */
router.get('/fixed-assets/detail', requireAuth, async (req, res) => {
  try {
    const { category_id, department_id } = req.query;
    if (!category_id || !department_id) {
      return res.status(400).json({ error: '缺少参数 category_id 或 department_id' });
    }
    const [rows] = await pool.query(`
      SELECT wi.id, wi.name as item_name, wi.sku, i.quantity, i.unit,
             IFNULL(wi.reference_price, 0) as unit_price,
             ROUND(i.quantity * IFNULL(wi.reference_price, 0), 2) as total_amount
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      JOIN warehouses w ON i.warehouse_id = w.id
      WHERE wi.category_id = ?
        AND w.department_id = ?
        AND w.type = 'dept'
        AND i.quantity > 0
      ORDER BY total_amount DESC, i.quantity DESC
    `, [category_id, department_id]);
    res.json(rows.map(r => ({ ...r, quantity: toNum(r.quantity), unit_price: toNum(r.unit_price), total_amount: toNum(r.total_amount) })));
  } catch (err) {
    console.error('[fixed-assets detail] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** 原材料消耗明细 */
router.get('/material-consumption/detail', requireAuth, async (req, res) => {
  try {
    const { category_id, department_id, month } = req.query;
    if (!category_id || !department_id || !month) {
      return res.status(400).json({ error: '缺少参数' });
    }
    const [rows] = await pool.query(`
      SELECT sm.id, wi.name as item_name, sm.quantity, sm.unit,
             IFNULL(sm.unit_price, 0) as unit_price,
             IFNULL(sm.total_amount, 0) as total_amount,
             sm.movement_type, sm.operator_name, sm.reason,
             DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i') as created_at
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      WHERE sm.movement_type IN ('inbound', 'expense')
        AND sm.related_type = 'scan'
        AND wi.category_id = ?
        AND sm.department_id = ?
        AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
      ORDER BY sm.created_at DESC
    `, [category_id, department_id, month]);
    res.json(rows.map(r => ({
      ...r,
      quantity: toNum(r.quantity),
      unit_price: toNum(r.unit_price),
      total_amount: toNum(r.total_amount),
    })));
  } catch (err) {
    console.error('[material-consumption detail] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** ============== 4. 导出PDF（二维表） ============== */
async function generateReportPDF({ title, subtitle, matrix }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const chineseFont = findChineseFont();
  const chineseBoldFont = findChineseBoldFont();
  const hasChineseFont = !!chineseFont;
  if (hasChineseFont) {
    doc.registerFont('Chinese-Regular', chineseFont);
    doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
  }

  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const pageW = doc.page.width - 60;
  const marginLeft = 30;

  // 标题
  doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(title, marginLeft, 30, { width: pageW, align: 'center' });
  doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(subtitle, marginLeft, 55, { width: pageW, align: 'center' });

  // 计算列宽：首列=18%，其余部门列平分，合计列=12%
  const headers = ['分类', ...matrix.departments, '合计'];
  const colCount = headers.length;
  const firstColW = pageW * 0.18;
  const totalColW = pageW * 0.12;
  const midCols = colCount - 2;
  const midColW = midCols > 0 ? (pageW - firstColW - totalColW) / midCols : 0;
  const colWidths = [firstColW, ...new Array(midCols).fill(midColW), totalColW];
  const rowH = 16;

  let y = 85;

  function checkPage(newY) {
    const pageBottom = doc.page.height - 40;
    if (newY > pageBottom) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
      return 50;
    }
    return newY;
  }

  function drawCell(x, cellY, text, w, opts = {}) {
    const font = opts.bold ? 'Chinese-Bold' : 'Chinese-Regular';
    const hFont = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(hasChineseFont ? font : hFont).fontSize(opts.header ? 9 : 8.5);
    const lineH = doc.currentLineHeight();
    const tY = cellY + (rowH - lineH) / 2;
    doc.save();
    doc.rect(x, cellY, w, rowH).stroke('#d1d5db');
    doc.restore();
    doc.text(String(text), x + 3, tY, {
      width: w - 6,
      align: opts.align || 'left',
      ellipsis: true,
    });
  }

  // 表头
  {
    let x = marginLeft;
    doc.save();
    doc.rect(marginLeft, y, pageW, rowH).fill('#f3f4f6').stroke('#d1d5db');
    doc.restore();
    for (let i = 0; i < headers.length; i++) {
      const align = i === 0 ? 'left' : 'right';
      drawCell(x, y, headers[i], colWidths[i], { header: true, bold: true, align });
      x += colWidths[i];
    }
    y += rowH;
  }

  // 行
  for (const row of matrix.rows) {
    y = checkPage(y);
    let x = marginLeft;
    drawCell(x, y, row.l2Name, colWidths[0], { align: 'left' });
    x += colWidths[0];
    for (let i = 0; i < matrix.departments.length; i++) {
      const v = row.values[i];
      const text = v === 0 || v === null || v === undefined ? '-' : `¥${toNum(v).toFixed(2)}`;
      drawCell(x, y, text, colWidths[i + 1], { align: 'right' });
      x += colWidths[i + 1];
    }
    drawCell(x, y, `¥${toNum(row.total).toFixed(2)}`, colWidths[colWidths.length - 1], { bold: true, align: 'right' });
    y += rowH;
  }

  // 合计行
  y = checkPage(y);
  {
    let x = marginLeft;
    doc.save();
    doc.rect(marginLeft, y, pageW, rowH).fill('#e5e7eb').stroke('#d1d5db');
    doc.restore();
    drawCell(x, y, '合计', colWidths[0], { bold: true });
    x += colWidths[0];
    for (let i = 0; i < matrix.departments.length; i++) {
      const v = matrix.totals[i];
      const text = v === 0 ? '-' : `¥${toNum(v).toFixed(2)}`;
      drawCell(x, y, text, colWidths[i + 1], { bold: true, align: 'right' });
      x += colWidths[i + 1];
    }
    drawCell(x, y, `¥${toNum(matrix.grandTotal).toFixed(2)}`, colWidths[colWidths.length - 1], { bold: true, align: 'right' });
    y += rowH;
  }

  // 生成时间
  y += 10;
  doc.fontSize(8).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    marginLeft, y, { width: pageW, align: 'right' }
  );

  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

router.get('/pdf/fixed-assets', requireAuth, async (req, res) => {
  try {
    const [deptRows] = await pool.query(`SELECT id, name FROM departments WHERE status = 1 ORDER BY sort_order ASC, created_at ASC`);
    const deptIdsSorted = deptRows.map(d => d.id);
    const [rows] = await pool.query(`
      SELECT wc.id as category_id, wc.name as category,
             wc.parent_id as category_parent_id, wc_p.name as category_parent,
             w.department_id as dept_id, d.name as dept_name,
             SUM(i.quantity * IFNULL(wi.reference_price, 0)) as amount
      FROM inventory i
      JOIN warehouse_items wi ON i.item_id = wi.id
      JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      JOIN warehouses w ON i.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE w.type = 'dept' AND i.quantity > 0
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
    `);
    const matrix = buildMatrix(rows, deptIdsSorted);
    const todayStr = new Date().toLocaleDateString('zh-CN');
    const buf = await generateReportPDF({
      title: '固定资产库存价值表',
      subtitle: `统计时间：${todayStr}    合计：¥${toNum(matrix.grandTotal).toFixed(2)}`,
      matrix,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="固定资产库存价值_${todayStr}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[pdf fixed-assets] error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/pdf/material-consumption', requireAuth, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '参数 month 格式错误' });
    }
    const [deptRows] = await pool.query(`SELECT id, name FROM departments WHERE status = 1 ORDER BY sort_order ASC, created_at ASC`);
    const deptIdsSorted = deptRows.map(d => d.id);
    const [rows] = await pool.query(`
      SELECT wc.id as category_id, wc.name as category,
             wc.parent_id as category_parent_id, wc_p.name as category_parent,
             sm.department_id as dept_id, sm.department_name as dept_name,
             SUM(IFNULL(sm.total_amount, 0)) as amount
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE sm.movement_type IN ('inbound', 'expense')
        AND sm.related_type = 'scan'
        AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, sm.department_id, sm.department_name
    `, [month]);
    const matrix = buildMatrix(rows, deptIdsSorted);
    const [y, m] = month.split('-');
    const subtitle = `统计月份：${y}年${parseInt(m)}月    合计消耗：¥${toNum(matrix.grandTotal).toFixed(2)}`;
    const buf = await generateReportPDF({
      title: '原材料部门消耗表',
      subtitle,
      matrix,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="原材料消耗_${month}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[pdf material-consumption] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
