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

// 子部门 → 父部门 名称映射（子部门费用归并到父部门）
const DEPT_MERGE_MAP = {
  '小卖部': '房务',
  '员工餐': '厨房',
  '早餐': '厨房',
  '礼品': '院办',
};

// 将子部门名称替换为父部门名称
function mergeDeptName(name) {
  return DEPT_MERGE_MAP[name] || name;
}

/** 构建二维表数据（按分类×部门矩阵）
 *  @param rawRows [{ category_id, category, category_parent_id, category_parent, dept_id, dept_name, amount }]
 *  @param deptIdsSorted   部门ID排序（可传空则按出现顺序）
 *  @param deptNameMap     部门ID->名称映射（用于补齐无数据的部门名称）
 *  @param allCategories   所有分类列表 [{ l1Id, l1Name, l2Id, l2Name }]，用于显示无数据的分类行
 */
function buildMatrix(rawRows, deptIdsSorted = null, deptNameMap = null, allCategories = null) {
  // 0. 部门归并：将子部门名称替换为父部门名称
  const mergedRows = rawRows.map(r => ({
    ...r,
    dept_name: mergeDeptName(r.dept_name || '未命名部门'),
  }));

  // 1. 构建归并后的部门映射（按名称去重，子部门已归并到父部门）
  const deptNameToId = new Map(); // deptName -> deptId（取第一个出现的ID）
  const deptMap = new Map(); // deptId -> {id, name}
  for (const r of mergedRows) {
    if (!r.dept_id) continue;
    const name = r.dept_name;
    if (!deptNameToId.has(name)) {
      deptNameToId.set(name, r.dept_id);
      deptMap.set(r.dept_id, { id: r.dept_id, name });
    }
  }

  // 2. 构建部门列表（过滤掉子部门，只保留父部门）
  let depts;
  if (deptIdsSorted && deptIdsSorted.length > 0) {
    const seenNames = new Set();
    depts = [];
    for (const id of deptIdsSorted) {
      const rawName = (deptNameMap && deptNameMap[id]) || (deptMap.has(id) ? deptMap.get(id).name : null);
      if (!rawName) continue;
      const mergedName = mergeDeptName(rawName);
      if (seenNames.has(mergedName)) continue;
      seenNames.add(mergedName);
      depts.push({ id, name: mergedName });
    }
    for (const [, d] of deptMap.entries()) {
      if (!seenNames.has(d.name)) {
        seenNames.add(d.name);
        depts.push(d);
      }
    }
  } else {
    depts = Array.from(deptMap.values());
  }
  const deptIdx = {};
  depts.forEach((d, i) => { deptIdx[d.name] = i; });
  const deptNames = depts.map(d => d.name);
  const emptyValues = () => new Array(depts.length).fill(0);

  // 3. 整理分类（如果传入了 allCategories，先用它们初始化）
  const l1Map = {};
  if (allCategories && allCategories.length > 0) {
    for (const cat of allCategories) {
      if (!l1Map[cat.l1Id]) {
        l1Map[cat.l1Id] = { l1Id: cat.l1Id, name: cat.l1Name, children: new Map() };
      }
      if (!l1Map[cat.l1Id].children.has(cat.l2Id)) {
        l1Map[cat.l1Id].children.set(cat.l2Id, {
          l2Id: cat.l2Id, name: cat.l2Name, values: emptyValues()
        });
      }
    }
  }

  // 4. 填充数据（使用归并后的行，按部门名称匹配索引）
  for (const r of mergedRows) {
    const l1Id = r.category_parent_id || '__no_parent__';
    const l1Name = r.category_parent || '未分类';
    const l2Id = r.category_id;
    const l2Name = r.category || '未命名';
    if (!l1Map[l1Id]) {
      l1Map[l1Id] = { l1Id, name: l1Name, children: new Map() };
    }
    if (!l1Map[l1Id].children.has(l2Id)) {
      l1Map[l1Id].children.set(l2Id, { l2Id, name: l2Name, values: emptyValues() });
    }
    const node = l1Map[l1Id].children.get(l2Id);
    const idx = deptIdx[r.dept_name];
    if (idx !== undefined) {
      node.values[idx] = (node.values[idx] || 0) + toNum(r.amount);
    }
  }

  // 4. 扁平化 rows
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
        category: node.name,
        values: vals,
        total: formatMoney(rowTotal),
      });
    }
  }

  // 5. 合计行
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
router.get('/fixed-assets', async (req, res) => {
  try {
    // 先查出所有部门，作为列顺序（确保无数据的部门列也显示）
    const [deptRows] = await pool.query(
      `SELECT id, name FROM departments ORDER BY created_at ASC`
    );
    const deptIdsSorted = deptRows.map(d => d.id);
    const deptNameMap = {};
    for (const d of deptRows) deptNameMap[d.id] = d.name;

    // 查询固定资产 L1/L2 分类（确保无数据的分类也显示）
    const [catRows] = await pool.query(`
      SELECT wc.id as l2Id, wc.name as l2Name,
             wc.parent_id as l1Id, wc_p.name as l1Name
      FROM warehouse_categories wc
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE wc.parent_id IS NOT NULL
        AND wc_p.name = '固定资产'
      ORDER BY wc_p.sort_order ASC, wc.sort_order ASC, wc.id ASC
    `);
    const allCategories = catRows.map(c => ({
      l1Id: c.l1Id, l1Name: c.l1Name,
      l2Id: c.l2Id, l2Name: c.l2Name
    }));

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
        AND wc_p.name = '固定资产'
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
    `);

    const matrix = buildMatrix(rows, deptIdsSorted, deptNameMap, allCategories);

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
          AND wc_p.name = '固定资产'
          AND DATE(i.updated_at) < ?
        GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
      `, [firstOfMonthStr]);
      const lastMatrix = buildMatrix(lastRows, deptIdsSorted, deptNameMap, allCategories);
      lastMonth = { grandTotal: lastMatrix.grandTotal, totals: lastMatrix.totals };
    } catch (e) { /* 环比失败不影响主数据 */ }

    res.json({ ...matrix, lastMonth });
  } catch (err) {
    console.error('[fixed-assets] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** ============== 2. 原材料当月消耗 ============== */
router.get('/material-consumption', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '参数 month 格式错误，需要 YYYY-MM' });
    }

    const [deptRows] = await pool.query(
      `SELECT id, name FROM departments ORDER BY created_at ASC`
    );
    const deptIdsSorted = deptRows.map(d => d.id);
    const deptNameMap = {};
    for (const d of deptRows) deptNameMap[d.id] = d.name;

    // 查询原材料 L1/L2 分类（确保无数据的分类也显示）
    const [catRows] = await pool.query(`
      SELECT wc.id as l2Id, wc.name as l2Name,
             wc.parent_id as l1Id, wc_p.name as l1Name
      FROM warehouse_categories wc
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE wc.parent_id IS NOT NULL
        AND wc_p.name = '原材料'
      ORDER BY wc_p.sort_order ASC, wc.sort_order ASC, wc.id ASC
    `);
    const allCategories = catRows.map(c => ({
      l1Id: c.l1Id, l1Name: c.l1Name,
      l2Id: c.l2Id, l2Name: c.l2Name
    }));

    // 扫码领料入库到部门仓 = 部门消耗（movement_type='inbound'）
    // 即买即用消耗（movement_type='expense'）
    const [rows] = await pool.query(`
      SELECT wc.id as category_id, wc.name as category,
             wc.parent_id as category_parent_id, wc_p.name as category_parent,
             w.department_id as dept_id, d.name as dept_name,
             SUM(IFNULL(sm.total_amount, 0)) as amount
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE ((sm.movement_type = 'inbound' AND sm.related_type = 'scan')
             OR sm.movement_type = 'expense')
        AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
        AND wc_p.name = '原材料'
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
    `, [month]);

    const matrix = buildMatrix(rows, deptIdsSorted, deptNameMap, allCategories);

    // 上月环比
    let lastMonth = null;
    try {
      const [y, m] = month.split('-').map(Number);
      const lastDate = new Date(y, m - 2, 1);
      const lastYM = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;
      const [lastRows] = await pool.query(`
        SELECT wc.id as category_id, wc.name as category,
               wc.parent_id as category_parent_id, wc_p.name as category_parent,
               w.department_id as dept_id, d.name as dept_name,
               SUM(IFNULL(sm.total_amount, 0)) as amount
        FROM stock_movements sm
        JOIN warehouse_items wi ON sm.item_id = wi.id
        JOIN warehouse_categories wc ON wi.category_id = wc.id
        LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
        LEFT JOIN warehouses w ON sm.warehouse_id = w.id
        LEFT JOIN departments d ON w.department_id = d.id
        WHERE ((sm.movement_type = 'inbound' AND sm.related_type = 'scan')
               OR sm.movement_type = 'expense')
          AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
          AND wc_p.name = '原材料'
        GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
      `, [lastYM]);
      const lastMatrix = buildMatrix(lastRows, deptIdsSorted, deptNameMap, allCategories);
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
router.get('/fixed-assets/detail', async (req, res) => {
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
router.get('/material-consumption/detail', async (req, res) => {
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
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      WHERE ((sm.movement_type = 'inbound' AND sm.related_type = 'scan')
             OR sm.movement_type = 'expense')
        AND wi.category_id = ?
        AND w.department_id = ?
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

router.get('/pdf/fixed-assets', async (req, res) => {
  try {
    const [deptRows] = await pool.query(`SELECT id, name FROM departments ORDER BY created_at ASC`);
    const deptIdsSorted = deptRows.map(d => d.id);
    const deptNameMap = {};
    for (const d of deptRows) deptNameMap[d.id] = d.name;

    const [catRows] = await pool.query(`
      SELECT wc.id as l2Id, wc.name as l2Name,
             wc.parent_id as l1Id, wc_p.name as l1Name
      FROM warehouse_categories wc
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE wc.parent_id IS NOT NULL
        AND wc_p.name = '固定资产'
      ORDER BY wc_p.sort_order ASC, wc.sort_order ASC, wc.id ASC
    `);
    const allCategories = catRows.map(c => ({
      l1Id: c.l1Id, l1Name: c.l1Name,
      l2Id: c.l2Id, l2Name: c.l2Name
    }));

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
        AND wc_p.name = '固定资产'
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
    `);
    const matrix = buildMatrix(rows, deptIdsSorted, deptNameMap, allCategories);
    const todayStr = new Date().toLocaleDateString('zh-CN');
    const buf = await generateReportPDF({
      title: '固定资产库存价值表',
      subtitle: `统计时间：${todayStr}    合计：¥${toNum(matrix.grandTotal).toFixed(2)}`,
      matrix,
    });
    res.setHeader('Content-Type', 'application/pdf');
    const safeName1 = encodeURIComponent(`固定资产库存价值_${todayStr}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename="report.pdf"; filename*=UTF-8''${safeName1}`);
    res.send(buf);
  } catch (err) {
    console.error('[pdf fixed-assets] error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/pdf/material-consumption', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '参数 month 格式错误' });
    }
    const [deptRows] = await pool.query(`SELECT id, name FROM departments ORDER BY created_at ASC`);
    const deptIdsSorted = deptRows.map(d => d.id);
    const deptNameMap = {};
    for (const d of deptRows) deptNameMap[d.id] = d.name;

    const [catRows] = await pool.query(`
      SELECT wc.id as l2Id, wc.name as l2Name,
             wc.parent_id as l1Id, wc_p.name as l1Name
      FROM warehouse_categories wc
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE wc.parent_id IS NOT NULL
        AND wc_p.name = '原材料'
      ORDER BY wc_p.sort_order ASC, wc.sort_order ASC, wc.id ASC
    `);
    const allCategories = catRows.map(c => ({
      l1Id: c.l1Id, l1Name: c.l1Name,
      l2Id: c.l2Id, l2Name: c.l2Name
    }));

    const [rows] = await pool.query(`
      SELECT wc.id as category_id, wc.name as category,
             wc.parent_id as category_parent_id, wc_p.name as category_parent,
             w.department_id as dept_id, d.name as dept_name,
             SUM(IFNULL(sm.total_amount, 0)) as amount
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      WHERE ((sm.movement_type = 'inbound' AND sm.related_type = 'scan')
             OR sm.movement_type = 'expense')
        AND DATE_FORMAT(sm.created_at, '%Y-%m') = ?
        AND wc_p.name = '原材料'
      GROUP BY wc.id, wc.name, wc.parent_id, wc_p.name, w.department_id, d.name
    `, [month]);
    const matrix = buildMatrix(rows, deptIdsSorted, deptNameMap, allCategories);
    const [y, m] = month.split('-');
    const subtitle = `统计月份：${y}年${parseInt(m)}月    合计消耗：¥${toNum(matrix.grandTotal).toFixed(2)}`;
    const buf = await generateReportPDF({
      title: '原材料部门消耗表',
      subtitle,
      matrix,
    });
    res.setHeader('Content-Type', 'application/pdf');
    const safeName2 = encodeURIComponent(`原材料消耗_${month}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename="report.pdf"; filename*=UTF-8''${safeName2}`);
    res.send(buf);
  } catch (err) {
    console.error('[pdf material-consumption] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** ============== 5. 部门费用明细 ============== */
/** 列表查询（带筛选+分页） */
router.get('/expense-detail', async (req, res) => {
  try {
    const {
      month,
      department_id,
      category_id,
      category_parent_id,
      keyword,
      page = 1,
      page_size = 50,
    } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '参数 month 格式错误' });
    }

    const where = [
      `((sm.movement_type = 'inbound' AND sm.related_type = 'scan') OR sm.movement_type = 'expense')`,
      `DATE_FORMAT(sm.created_at, '%Y-%m') = ?`,
    ];
    const params = [month];

    if (department_id) {
      where.push(`w.department_id = ?`);
      params.push(department_id);
    }
    if (category_parent_id) {
      where.push(`wc.parent_id = ?`);
      params.push(category_parent_id);
    } else if (category_id) {
      where.push(`wi.category_id = ?`);
      params.push(category_id);
    }
    if (keyword) {
      where.push(`(wi.name LIKE ? OR wi.sku LIKE ?)`);
      const kw = `%${keyword}%`;
      params.push(kw, kw);
    }

    const whereSql = where.join(' AND ');

    // 汇总
    const [summaryRow] = await pool.query(`
      SELECT COUNT(*) as total_count,
             SUM(IFNULL(sm.total_amount, 0)) as total_amount
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      WHERE ${whereSql}
    `, params);

    const count = toNum(summaryRow[0].total_count);
    const totalAmount = toNum(summaryRow[0].total_amount);

    // 分页
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(page_size) || 50));
    const offset = (pageNum - 1) * pageSize;

    const [rows] = await pool.query(`
      SELECT sm.id, wi.name as item_name, wi.sku,
             wc.id as category_id, wc.name as category_name,
             wc_p.id as category_parent_id, wc_p.name as category_parent_name,
             w.department_id, d.name as department_name,
             ABS(sm.quantity) as quantity, sm.unit,
             IFNULL(sm.unit_price, 0) as unit_price,
             IFNULL(sm.total_amount, 0) as total_amount,
             sm.movement_type, sm.operator_name, sm.reason,
             DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i') as created_at
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE ${whereSql}
      ORDER BY sm.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);

    res.json({
      page: pageNum,
      page_size: pageSize,
      total_count: count,
      total_amount: totalAmount,
      list: rows.map(r => ({
        ...r,
        quantity: toNum(r.quantity),
        unit_price: toNum(r.unit_price),
        total_amount: toNum(r.total_amount),
      })),
    });
  } catch (err) {
    console.error('[expense-detail] error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** 部门费用明细 PDF 导出 */
router.get('/pdf/expense-detail', async (req, res) => {
  try {
    const {
      month,
      department_id,
      category_id,
      category_parent_id,
      keyword,
    } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: '参数 month 格式错误' });
    }

    const where = [
      `((sm.movement_type = 'inbound' AND sm.related_type = 'scan') OR sm.movement_type = 'expense')`,
      `DATE_FORMAT(sm.created_at, '%Y-%m') = ?`,
    ];
    const params = [month];

    if (department_id) {
      where.push(`w.department_id = ?`);
      params.push(department_id);
    }
    if (category_parent_id) {
      where.push(`wc.parent_id = ?`);
      params.push(category_parent_id);
    } else if (category_id) {
      where.push(`wi.category_id = ?`);
      params.push(category_id);
    }
    if (keyword) {
      where.push(`(wi.name LIKE ? OR wi.sku LIKE ?)`);
      const kw = `%${keyword}%`;
      params.push(kw, kw);
    }

    const whereSql = where.join(' AND ');

    const [rows] = await pool.query(`
      SELECT sm.id, wi.name as item_name, wi.sku,
             wc.name as category_name, wc_p.name as category_parent_name,
             d.name as department_name,
             ABS(sm.quantity) as quantity, sm.unit,
             IFNULL(sm.unit_price, 0) as unit_price,
             IFNULL(sm.total_amount, 0) as total_amount,
             sm.movement_type, sm.operator_name,
             DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i') as created_at
      FROM stock_movements sm
      JOIN warehouse_items wi ON sm.item_id = wi.id
      LEFT JOIN warehouses w ON sm.warehouse_id = w.id
      LEFT JOIN departments d ON w.department_id = d.id
      LEFT JOIN warehouse_categories wc ON wi.category_id = wc.id
      LEFT JOIN warehouse_categories wc_p ON wc.parent_id = wc_p.id
      WHERE ${whereSql}
      ORDER BY sm.created_at DESC
    `, params);

    const doc = new PDFDocument({ size: 'A4', margin: 30 });
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

    const [y, m] = month.split('-');
    const deptName = department_id ? '指定部门' : '全部部门';
    const totalAmt = rows.reduce((s, r) => s + toNum(r.total_amount), 0);

    doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold')
       .text('部门费用明细表', marginLeft, 30, { width: pageW, align: 'center' });
    doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica')
       .text(`${y}年${parseInt(m)}月    ${deptName}    合计：${rows.length}笔 / ¥${toNum(totalAmt).toFixed(2)}`,
             marginLeft, 55, { width: pageW, align: 'center' });

    const headers = ['物资名称', '分类', '部门', '数量', '单价', '金额', '方式', '操作人', '时间'];
    const colW = [
      pageW * 0.18, // 物资名称
      pageW * 0.14, // 分类
      pageW * 0.10, // 部门
      pageW * 0.07, // 数量
      pageW * 0.08, // 单价
      pageW * 0.09, // 金额
      pageW * 0.08, // 方式
      pageW * 0.08, // 操作人
      pageW * 0.18, // 时间
    ];
    const rowH = 16;
    let yPos = 85;

    function checkPage(newY) {
      const pageBottom = doc.page.height - 50;
      if (newY > pageBottom) {
        doc.addPage({ size: 'A4', margin: 30 });
        return 50;
      }
      return newY;
    }

    function drawCell(x, cellY, text, w, opts = {}) {
      const font = opts.bold ? 'Chinese-Bold' : 'Chinese-Regular';
      const hFont = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(hasChineseFont ? font : hFont).fontSize(opts.header ? 9 : 8);
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
      doc.rect(marginLeft, yPos, pageW, rowH).fill('#f3f4f6').stroke('#d1d5db');
      doc.restore();
      for (let i = 0; i < headers.length; i++) {
        const align = i === 0 || i === 1 || i === 2 || i === 6 || i === 7 || i === 8 ? 'left' : 'right';
        drawCell(x, yPos, headers[i], colW[i], { header: true, bold: true, align });
        x += colW[i];
      }
      yPos += rowH;
    }

    // 数据行
    for (const r of rows) {
      yPos = checkPage(yPos);
      const way = r.movement_type === 'expense' ? '即买即用' : '扫码入库';
      const values = [
        r.item_name || '-',
        r.category_parent_name && r.category_name ? `${r.category_parent_name}/${r.category_name}` : (r.category_name || '-'),
        r.department_name || '-',
        toNum(r.quantity),
        toNum(r.unit_price).toFixed(2),
        toNum(r.total_amount).toFixed(2),
        way,
        r.operator_name || '-',
        r.created_at || '-',
      ];
      let x = marginLeft;
      for (let i = 0; i < values.length; i++) {
        const align = i === 0 || i === 1 || i === 2 || i === 6 || i === 7 || i === 8 ? 'left' : 'right';
        drawCell(x, yPos, values[i], colW[i], { align });
        x += colW[i];
      }
      yPos += rowH;
    }

    // 合计行
    yPos = checkPage(yPos);
    {
      let x = marginLeft;
      doc.save();
      doc.rect(marginLeft, yPos, pageW, rowH).fill('#e5e7eb').stroke('#d1d5db');
      doc.restore();
      drawCell(marginLeft, yPos, '合计', colW[0], { bold: true });
      let rest = colW[0];
      for (let i = 1; i < 4; i++) rest += colW[i];
      // 清空中间列
      drawCell(marginLeft + colW[0], yPos, '', pageW - colW[0] - colW[5] - colW[6] - colW[7] - colW[8], { bold: true });
      drawCell(marginLeft + pageW - colW[5] - colW[6] - colW[7] - colW[8], yPos, `${rows.length}笔`, colW[5], { bold: true, align: 'right' });
      drawCell(marginLeft + pageW - colW[6] - colW[7] - colW[8], yPos, '', colW[6], { bold: true });
      drawCell(marginLeft + pageW - colW[7] - colW[8], yPos, '', colW[7], { bold: true });
      drawCell(marginLeft + pageW - colW[8], yPos, '', colW[8], { bold: true });
      // 重新写金额到第5列（金额列）
      const amtColStart = headers.slice(0, 5).reduce((s, _, i) => s + colW[i], 0);
      drawCell(marginLeft + amtColStart - colW[5], yPos, `¥${toNum(totalAmt).toFixed(2)}`, colW[5], { bold: true, align: 'right' });
      yPos += rowH;
    }

    yPos += 10;
    doc.fontSize(8).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      marginLeft, yPos, { width: pageW, align: 'right' }
    );

    doc.end();
    const buf = await new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    res.setHeader('Content-Type', 'application/pdf');
    const safeName3 = encodeURIComponent(`部门费用明细_${month}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename="report.pdf"; filename*=UTF-8''${safeName3}`);
    res.send(buf);
  } catch (err) {
    console.error('[pdf expense-detail] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
