// ================================================
// 仓库采购流程路由
// 复用 wecom.js 导出的企微函数与 purchase-confirmations 的确认/审批/PDF 模式
// 部分接口（confirm-page / confirm-submit / :id/pdf）免登录，其余需 requireAuth
// ================================================
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { requireAuth } = require('../middleware/rbac');
const {
  getWecomConfig,
  sendMarkdownViaWebhook,
  sendTemplateCardToUser,
  updateTemplateCardButton,
  getWecomUserName,
  submitApproval,
  getApprovalDetail,
  uploadMedia,
} = require('./wecom');

// PDF 存储目录（与项目根 uploads/pdfs 对齐）
const PDF_DIR = path.join(__dirname, '..', 'uploads', 'pdfs');
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

// ================================================
// 工具函数
// ================================================

// 安全数值转换（兼容 mysql2 返回的 Decimal 对象）
function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    const str = val.String || val.string || val.val || JSON.stringify(val);
    const n = parseFloat(String(str));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

// 货币格式化
function formatCurrency(val) {
  return '¥' + toNum(val).toFixed(2);
}

// 格式化本地时间（避免 UTC 偏差）
function formatLocalNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 安全解析 JSON 字段
function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return null; }
}

// 查找中文字体（常规）
function findChineseFont() {
  const candidates = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Regular.otf'),
    path.join(__dirname, 'fonts', 'SourceHanSansSC-Regular.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p) && !p.endsWith('.ttc')) return p; } catch (e) {}
  }
  return null;
}

// 查找中文字体（粗体）
function findChineseBoldFont() {
  const candidates = [
    path.join(__dirname, '..', 'fonts', 'SourceHanSansSC-Bold.otf'),
    path.join(__dirname, 'fonts', 'SourceHanSansSC-Bold.otf'),
    '/usr/share/fonts/truetype/wqy/wqy-microhei-bold.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p) && !p.endsWith('.ttc')) return p; } catch (e) {}
  }
  return null;
}

// 解析审批字段映射（兼容字符串/对象）
function parseFieldMapping(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

// 生成采购单号：WH + yyyyMMdd + 3位序号
async function generatePurchaseNo(connection) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const prefix = `WH${dateStr}`;
  const [rows] = await connection.query(
    'SELECT purchase_no FROM warehouse_purchases WHERE purchase_no LIKE ? ORDER BY purchase_no DESC LIMIT 1',
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length > 0 && rows[0].purchase_no) {
    const lastSeq = parseInt(rows[0].purchase_no.substring(prefix.length), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// 规整采购单行（解析 JSON 字段、计算确认进度）
function normalizePurchaseRow(row) {
  if (!row) return row;
  const userDepartments = parseJsonField(row.user_departments) || {};
  const userConfirmations = parseJsonField(row.user_confirmations) || {};
  const totalUsers = Object.keys(userDepartments).length;
  const confirmedUsers = Object.values(userConfirmations).filter(c => c && c.confirmed).length;
  return {
    ...row,
    total_amount: toNum(row.total_amount),
    actual_amount: toNum(row.actual_amount),
    user_departments: userDepartments,
    user_confirmations: userConfirmations,
    total_users: totalUsers,
    confirmed_users: confirmedUsers,
  };
}

// 规整明细行（金额安全转换）
function normalizeItemRow(item) {
  if (!item) return item;
  return {
    ...item,
    requested_quantity: toNum(item.requested_quantity),
    requested_unit_price: toNum(item.requested_unit_price),
    requested_amount: toNum(item.requested_amount),
    received_quantity: toNum(item.received_quantity),
    received_unit_price: toNum(item.received_unit_price),
    received_amount: toNum(item.received_amount),
  };
}

// ================================================
// 企微审批辅助：用 fetch 直接获取模板控件类型
// （getApprovalTemplateDetail 未从 wecom.js 导出，按任务要求直接 fetch）
// ================================================
async function fetchWarehouseTemplateControlTypes(config) {
  const tokenResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`);
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) {
    throw new Error('获取企微 access_token 失败：' + (tokenData.errmsg || ''));
  }
  const accessToken = tokenData.access_token;
  const tplResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: config.warehouse_approval_template_id }),
  });
  const tplData = await tplResp.json();
  if (tplData.errcode !== 0) {
    throw new Error('获取审批模板详情失败：' + (tplData.errmsg || ''));
  }
  const controlTypeMap = {};
  if (tplData.template_content && tplData.template_content.controls) {
    for (const ctrl of tplData.template_content.controls) {
      if (ctrl.property && ctrl.property.id && ctrl.property.control) {
        controlTypeMap[ctrl.property.id] = ctrl.property.control;
      }
    }
  }
  return controlTypeMap;
}

// 构建仓库审批 apply_data（采购审批 / 报销审批复用）
// options: { date, amount, reason, items, useReceived, pdfPath, rowId }
async function buildWarehouseApplyData(config, fieldMapping, controlTypeMap, options) {
  const { date, amount, reason, items, useReceived = false, pdfPath = null } = options;

  function getControlType(fieldKey, fallback) {
    const mappedId = fieldMapping[fieldKey];
    return mappedId ? (controlTypeMap[mappedId] || fallback) : fallback;
  }

  const contents = [];

  // 日期
  if (fieldMapping.date) {
    let d;
    if (date instanceof Date) {
      d = new Date(date);
    } else if (typeof date === 'string') {
      const parts = date.substring(0, 10).split('-');
      if (parts.length === 3) {
        d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        d = new Date(date);
      }
    } else {
      d = new Date(date);
    }
    d.setHours(0, 0, 0, 0);
    const sTimestamp = Math.floor(d.getTime() / 1000);
    contents.push({
      control: getControlType('date', 'Date'),
      id: fieldMapping.date,
      value: { date: { type: 'day', s_timestamp: String(sTimestamp) } },
    });
  }

  // 金额
  if (fieldMapping.amount) {
    contents.push({
      control: getControlType('amount', 'Money'),
      id: fieldMapping.amount,
      value: { new_money: toNum(amount).toFixed(2) },
    });
  }

  // 事由
  if (fieldMapping.reason) {
    contents.push({
      control: getControlType('reason', 'Text'),
      id: fieldMapping.reason,
      value: { text: String(reason) },
    });
  }

  // 涉及部门
  if (fieldMapping.department) {
    const deptNames = Array.from(new Set((items || []).map(i => String(i.department_name || '未分类')))).join('、');
    contents.push({
      control: getControlType('department', 'Text'),
      id: fieldMapping.department,
      value: { text: deptNames },
    });
  }

  // 收款方/银行/账号
  if (fieldMapping.payee_name && config.payee_name) {
    contents.push({ control: getControlType('payee_name', 'Text'), id: fieldMapping.payee_name, value: { text: String(config.payee_name) } });
  }
  if (fieldMapping.bank_name && config.bank_name) {
    contents.push({ control: getControlType('bank_name', 'Text'), id: fieldMapping.bank_name, value: { text: String(config.bank_name) } });
  }
  if (fieldMapping.bank_account && config.bank_account) {
    contents.push({ control: getControlType('bank_account', 'Text'), id: fieldMapping.bank_account, value: { text: String(config.bank_account) } });
  }

  // 付款方式
  let paymentLabel = '转账';
  if (fieldMapping.payment_method && config.default_payment_key) {
    let paymentOptions = {};
    if (config.payment_options) {
      if (typeof config.payment_options === 'string') {
        try { paymentOptions = JSON.parse(config.payment_options); } catch (e) { paymentOptions = {}; }
      } else if (typeof config.payment_options === 'object') {
        paymentOptions = config.payment_options;
      }
    }
    paymentLabel = String(paymentOptions[config.default_payment_key] || config.default_payment_key);
    contents.push({
      control: getControlType('payment_method', 'Selector'),
      id: fieldMapping.payment_method,
      value: {
        selector: {
          type: 'single',
          options: [{ key: String(config.default_payment_key), value: [{ text: paymentLabel, lang: 'zh_CN' }] }],
        },
      },
    });
  }

  // 物资明细
  if (fieldMapping.details) {
    let detailText = '';
    const grouped = {};
    for (const item of (items || [])) {
      const dn = String(item.department_name || '未分类');
      if (!grouped[dn]) grouped[dn] = [];
      grouped[dn].push(item);
    }
    for (const [dn, deptItems] of Object.entries(grouped)) {
      detailText += `【${dn}】\n`;
      for (const item of deptItems) {
        if (useReceived) {
          const price = toNum(item.received_unit_price);
          const qty = toNum(item.received_quantity);
          const amt = toNum(item.received_amount);
          const spec = item.received_spec || item.spec || '';
          const unit = item.received_unit || item.requested_unit || '';
          detailText += `${String(item.item_name)} ${spec} ${price}/${unit} ×${qty} = ¥${amt.toFixed(2)}\n`;
        } else {
          const price = toNum(item.requested_unit_price);
          const qty = toNum(item.requested_quantity);
          const amt = toNum(item.requested_amount);
          const spec = item.spec || '';
          const unit = item.requested_unit || '';
          detailText += `${String(item.item_name)} ${spec} ${price}/${unit} ×${qty} = ¥${amt.toFixed(2)}\n`;
        }
      }
    }
    contents.push({
      control: getControlType('details', 'Textarea'),
      id: fieldMapping.details,
      value: { text: detailText },
    });
  }

  // PDF 附件（自动查找 File 类型控件）
  if (pdfPath) {
    try {
      const fileControlId = fieldMapping.attachment || Object.entries(controlTypeMap).find(([, ctype]) => ctype === 'File')?.[0];
      if (fileControlId && fs.existsSync(pdfPath)) {
        const mediaId = await uploadMedia(config, pdfPath, `仓库采购确认单_${options.rowId || ''}.pdf`);
        contents.push({
          control: controlTypeMap[fileControlId] || 'File',
          id: fileControlId,
          value: { files: [{ file_id: mediaId, filename: `仓库采购确认单_${options.rowId || ''}.pdf` }] },
        });
      }
    } catch (uploadErr) {
      console.error('上传PDF附件失败:', uploadErr.message);
    }
  }

  const applyData = {
    creator_userid: String(config.applicant_userid),
    template_id: String(config.warehouse_approval_template_id),
    use_template_approver: 1,
    apply_data: { contents },
    summary_list: [
      { summary_info: [{ text: `事由：${reason}`, lang: 'zh_CN' }] },
      { summary_info: [{ text: `金额：¥${toNum(amount).toFixed(2)}`, lang: 'zh_CN' }] },
      { summary_info: [{ text: `付款方式：${paymentLabel}`, lang: 'zh_CN' }] },
    ],
  };
  return applyData;
}

// 发起仓库报销审批（全员确认后 / 重新发起 复用）
async function submitWarehouseReimbursement(row, items) {
  const config = await getWecomConfig();
  if (!config || !config.corp_id || !config.app_secret || !config.warehouse_approval_template_id || !config.applicant_userid) {
    throw new Error('请先完成企微仓库审批配置（仓库审批模板ID和申请人用户ID）');
  }
  const fieldMapping = parseFieldMapping(config.warehouse_field_mapping);
  const controlTypeMap = await fetchWarehouseTemplateControlTypes(config);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const reasonTemplate = config.payment_reason_template || '仓库采购报销';
  const reason = reasonTemplate.replace('{date}', dateStr);

  // 确保 PDF 存在
  const pdfPath = path.join(PDF_DIR, `warehouse_${row.id}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    try { await generateWarehousePDF(row.id); } catch (e) { console.error('生成PDF失败:', e.message); }
  }

  const applyData = await buildWarehouseApplyData(config, fieldMapping, controlTypeMap, {
    date: dateStr,
    amount: toNum(row.actual_amount) || toNum(row.total_amount),
    reason,
    items,
    useReceived: true,
    pdfPath,
    rowId: row.id,
  });
  const spNo = await submitApproval(config, applyData);
  return spNo;
}

// ================================================
// generateWarehousePDF —— 仓库采购确认单 PDF
// 标题"仓库采购确认单"，按部门分组，每部门末尾签字区
// 签字数据取自 user_confirmations[userid].signature_data
// ================================================
async function generateWarehousePDF(purchaseId) {
  const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [purchaseId]);
  if (rows.length === 0) throw new Error('采购单不存在');
  const row = rows[0];

  const [itemRows] = await pool.query(
    'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
    [purchaseId]
  );

  const userConfirmations = parseJsonField(row.user_confirmations) || {};

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const pdfPath = path.join(PDF_DIR, `warehouse_${purchaseId}.pdf`);
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);

  const chineseFont = findChineseFont();
  const chineseBoldFont = findChineseBoldFont();
  const hasChineseFont = !!chineseFont;
  if (hasChineseFont) {
    doc.registerFont('Chinese-Regular', chineseFont);
    doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
  }

  // 标题
  doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('仓库采购确认单', { align: 'center' });
  doc.moveDown(0.5);

  // 头部信息
  doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
  const statusLabel = row.status === 'confirmed' ? '已确认'
    : row.status === 'reimbursing' ? '报销中'
    : row.status === 'reimbursed' ? '已报销'
    : row.status;
  const amountLabel = toNum(row.actual_amount) > 0 ? toNum(row.actual_amount) : toNum(row.total_amount);
  doc.text(`采购单号：${row.purchase_no || '-'}    仓库：${row.warehouse_name || '-'}    金额：¥${amountLabel.toFixed(2)}    状态：${statusLabel}`);
  doc.moveDown(0.5);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const tableX = doc.page.margins.left;
  const tableWidth = pageWidth;

  // 按部门分组
  const groupedItems = {};
  for (const item of itemRows) {
    const deptName = item.department_name || '未分类';
    if (!groupedItems[deptName]) groupedItems[deptName] = [];
    groupedItems[deptName].push(item);
  }

  // 表头与列宽（按任务要求）
  const headers = ['物资名称', '规格', '单价/单位', '数量', '单位', '金额'];
  const colWidths = [
    tableWidth * 0.25,
    tableWidth * 0.15,
    tableWidth * 0.18,
    tableWidth * 0.10,
    tableWidth * 0.10,
    tableWidth * 0.22,
  ];
  const fixedRowHeight = 11;
  const signatureHeight = 30;

  function checkPageBreak(y, extraHeight = 0) {
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    if (y + extraHeight > pageBottom) {
      doc.addPage();
      return doc.page.margins.top;
    }
    return y;
  }

  function drawTableRow(y, cells, isHeader = false) {
    const font = isHeader ? 'Chinese-Bold' : 'Chinese-Regular';
    const helveticaFont = isHeader ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(hasChineseFont ? font : helveticaFont).fontSize(isHeader ? 7.5 : 7);
    const lineHeight = doc.currentLineHeight();
    let x = tableX;
    for (let i = 0; i < cells.length; i++) {
      const text = String(cells[i]);
      const align = i === 0 ? 'left' : (i === cells.length - 1 ? 'right' : 'center');
      const textY = y + (fixedRowHeight - lineHeight) / 2;
      doc.text(text, x + 2, textY, { width: colWidths[i] - 4, align });
      x += colWidths[i];
    }
    return fixedRowHeight;
  }

  // 部门签字区：从 user_confirmations 中找到负责该部门的确认人及其签名
  function drawDepartmentSignature(y, deptName) {
    const sigTop = y;
    const sigWidth = tableWidth;
    doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');

    const deptConf = Object.entries(userConfirmations).find(([, conf]) =>
      conf && conf.departments && conf.departments.includes(deptName)
    );
    if (deptConf) {
      const info = deptConf[1];
      const infoText = `确认人：${info.confirmed_by || '-'}    确认时间：${info.confirmed_at || '-'}`;
      doc.text(infoText, tableX + 2, sigTop + 2, { width: sigWidth - 4, align: 'left' });
      if (info.signature_data) {
        try {
          const base64Data = info.signature_data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          doc.image(buffer, tableX + 2, sigTop + 12, {
            width: sigWidth - 4, height: signatureHeight - 14,
            fit: [sigWidth - 4, signatureHeight - 14],
          });
        } catch (e) {
          console.error(`[仓库PDF] 签名图片处理失败，dept=${deptName}:`, e.message);
        }
      }
    } else {
      doc.text('状态：待确认', tableX + 2, sigTop + 8);
    }
    return signatureHeight;
  }

  let currentY = doc.y;
  doc.fontSize(12).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('采购明细', { underline: true });
  doc.moveDown(0.3);
  currentY = doc.y;

  // 表头
  currentY += drawTableRow(currentY, headers, true);
  doc.moveTo(tableX, currentY - 1).lineTo(tableX + tableWidth, currentY - 1).stroke();

  doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
  let grandTotal = 0;

  for (const [deptName, items] of Object.entries(groupedItems)) {
    const deptNeededHeight = fixedRowHeight + items.length * fixedRowHeight + 14 + signatureHeight + 15;
    currentY = checkPageBreak(currentY, deptNeededHeight);

    // 部门标题
    doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`【${deptName}】`, tableX, currentY + 1);
    currentY += fixedRowHeight;

    // 明细行（优先使用实收数据，无则用申请数据）
    doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').fontSize(7);
    let subtotal = 0;
    for (const item of items) {
      const hasReceived = toNum(item.received_amount) > 0 || toNum(item.received_quantity) > 0;
      const price = hasReceived ? toNum(item.received_unit_price) : toNum(item.requested_unit_price);
      const qty = hasReceived ? toNum(item.received_quantity) : toNum(item.requested_quantity);
      const amt = hasReceived ? toNum(item.received_amount) : toNum(item.requested_amount);
      const spec = hasReceived ? (item.received_spec || item.spec || '') : (item.spec || '');
      const unit = hasReceived ? (item.received_unit || item.requested_unit || '') : (item.requested_unit || '');
      const cells = [
        item.item_name,
        spec,
        `${price.toFixed(2)}/${unit}`,
        String(qty),
        unit,
        `¥${amt.toFixed(2)}`,
      ];
      currentY += drawTableRow(currentY, cells);
      subtotal += amt;
    }
    grandTotal += subtotal;

    // 部门小计
    doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold')
      .text(`小计：¥${subtotal.toFixed(2)}`, tableX, currentY, { width: tableWidth, align: 'right' });
    currentY += 10;
    doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

    // 部门签字区
    currentY += drawDepartmentSignature(currentY, deptName);
    currentY += 15;
  }

  if (Object.keys(groupedItems).length === 0) {
    doc.fontSize(10).text('暂无采购明细', { align: 'center' });
  }

  // 合计
  currentY = checkPageBreak(currentY, 30);
  doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();
  doc.fontSize(11).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold')
    .text(`合计金额：¥${grandTotal.toFixed(2)}`, tableX, currentY + 3, { width: tableWidth, align: 'right' });

  doc.moveDown(0.5);
  doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica')
    .text(`生成时间：${new Date().toLocaleString('zh-CN')}`, { align: 'right' });

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(pdfPath));
    writeStream.on('error', reject);
  });

  return pdfPath;
}

// ================================================================
// 路由定义
// 免登录接口（confirm-page / confirm-submit / :id/pdf）需在 /:id 之前注册
// ================================================================

// 1. GET / — 采购单列表
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, warehouse_id, page = 1, page_size = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, parseInt(page_size, 10) || 20);
    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const params = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (warehouse_id) { conditions.push('warehouse_id = ?'); params.push(warehouse_id); }

    const whereSql = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM warehouse_purchases${whereSql}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT * FROM warehouse_purchases${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const data = rows.map(normalizePurchaseRow);
    res.json({ data, total, page: pageNum, page_size: pageSize });
  } catch (err) {
    console.error('获取仓库采购单列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /confirm-page — 确认页数据（免登录），需在 /:id 之前注册
router.get('/confirm-page', async (req, res) => {
  try {
    const { id, user } = req.query;
    if (!id || !user) {
      return res.status(400).json({ error: '缺少参数 id 或 user' });
    }

    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在或已失效' });
    }
    const row = rows[0];

    const userDepartments = parseJsonField(row.user_departments) || {};
    const userConfirmations = parseJsonField(row.user_confirmations) || {};

    const userDeptData = userDepartments[user];
    const myDeptNames = (userDeptData && Array.isArray(userDeptData.departments))
      ? userDeptData.departments
      : (Array.isArray(userDeptData) ? userDeptData : []);

    if (myDeptNames.length === 0) {
      return res.status(403).json({ error: '您不是本采购单的指定确认人' });
    }

    const [itemRows] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    const myItems = itemRows
      .filter(item => myDeptNames.includes(item.department_name))
      .map(normalizeItemRow);

    const myTotal = myItems.reduce((s, i) => {
      const amt = toNum(i.received_amount) > 0 ? toNum(i.received_amount) : toNum(i.requested_amount);
      return s + amt;
    }, 0);

    const myConfirmation = userConfirmations[user] || null;
    const userName = await getWecomUserName(user);

    const allConfirmations = await Promise.all(
      Object.entries(userConfirmations).map(async ([userid, info]) => ({
        userid,
        name: await getWecomUserName(userid),
        confirmed: !!(info && info.confirmed),
        confirmed_at: info && info.confirmed_at,
        confirmed_by: info && info.confirmed_by,
      }))
    );

    const totalUsers = Object.keys(userDepartments).length;
    const confirmedUsers = Object.values(userConfirmations).filter(c => c && c.confirmed).length;

    res.json({
      id: row.id,
      purchase_no: row.purchase_no,
      warehouse_name: row.warehouse_name,
      status: row.status,
      total_amount: toNum(row.total_amount),
      actual_amount: toNum(row.actual_amount),
      user,
      user_name: userName,
      my_departments: myDeptNames,
      my_items: myItems,
      my_total: myTotal,
      my_confirmation: myConfirmation,
      all_confirmations: allConfirmations,
      total_users: totalUsers,
      confirmed_users: confirmedUsers,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('获取仓库采购确认页数据失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /confirm-submit — 确认提交（免登录），需在 /:id 之前注册
router.post('/confirm-submit', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id, user, signature_data } = req.body || {};
    if (!id || !user) {
      return res.status(400).json({ error: '缺少参数 id 或 user' });
    }
    if (!signature_data) {
      return res.status(400).json({ error: '请先手写签名后再确认' });
    }

    await connection.beginTransaction();

    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在或已失效' });
    }
    const row = rows[0];

    const userDepartments = parseJsonField(row.user_departments) || {};
    let userConfirmations = parseJsonField(row.user_confirmations) || {};

    const userDeptData = userDepartments[user];
    const myDeptNames = (userDeptData && Array.isArray(userDeptData.departments))
      ? userDeptData.departments
      : (Array.isArray(userDeptData) ? userDeptData : []);
    const responseCode = (userDeptData && userDeptData.response_code) || null;

    if (myDeptNames.length === 0) {
      await connection.rollback();
      return res.status(403).json({ error: '您不是本采购单的指定确认人' });
    }
    if (userConfirmations[user] && userConfirmations[user].confirmed) {
      await connection.rollback();
      return res.status(400).json({ error: '您已确认过，无需重复确认' });
    }

    const realName = await getWecomUserName(user);
    const now = formatLocalNow();

    userConfirmations[user] = {
      confirmed: true,
      confirmed_at: now,
      confirmed_by: realName,
      departments: myDeptNames,
      signature_data,
    };

    await connection.query(
      'UPDATE warehouse_purchases SET user_confirmations = ? WHERE id = ?',
      [JSON.stringify(userConfirmations), id]
    );

    // 保存用户签名到 user_signatures（不影响主流程）
    try {
      const [sigRows] = await connection.query(
        'SELECT id FROM user_signatures WHERE user_id = ? AND user_source = ?',
        [user, 'wecom']
      );
      if (sigRows.length > 0) {
        await connection.query(
          'UPDATE user_signatures SET signature_data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND user_source = ?',
          [signature_data, user, 'wecom']
        );
      } else {
        await connection.query(
          'INSERT INTO user_signatures (id, user_id, user_source, signature_data) VALUES (?, ?, ?, ?)',
          [uuidv4(), user, 'wecom', signature_data]
        );
      }
    } catch (sigErr) {
      console.error('保存用户签名失败（不影响主流程）:', sigErr.message);
    }

    // 调用企微更新卡片按钮变灰
    let cardUpdated = false;
    let cardError = '';
    try {
      const config = await getWecomConfig();
      if (config && config.corp_id && config.app_secret && config.agent_id) {
        if (!responseCode) {
          cardError = '该用户没有 response_code，跳过更新';
        } else {
          try {
            await updateTemplateCardButton(config, user, responseCode, `已确认 (${now})`);
            cardUpdated = true;
          } catch (updateErr) {
            console.error('更新模板卡片按钮失败:', updateErr.message);
            cardError = updateErr.message;
          }
        }
      }
    } catch (cfgErr) {
      console.error('读取企微配置失败:', cfgErr.message);
      cardError = cfgErr.message;
    }

    const totalUsers = Object.keys(userDepartments).length;
    const confirmedUsers = Object.values(userConfirmations).filter(c => c && c.confirmed).length;
    const allConfirmed = totalUsers > 0 && confirmedUsers === totalUsers;

    if (allConfirmed) {
      // 1. 生成 PDF
      let pdfUrl = row.pdf_url;
      try {
        await generateWarehousePDF(id);
        pdfUrl = `/api/warehouse-purchases/${id}/pdf`;
        await connection.query('UPDATE warehouse_purchases SET pdf_url = ?, status = ? WHERE id = ?', [pdfUrl, 'confirmed', id]);
      } catch (pdfErr) {
        console.error('仓库采购PDF生成失败:', pdfErr.message);
        await connection.query('UPDATE warehouse_purchases SET status = ? WHERE id = ?', ['confirmed', id]);
      }

      // 2. 发起报销审批
      let reimbursementSpNo = null;
      try {
        const [itemRows] = await pool.query(
          'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
          [id]
        );
        const freshRow = { ...row, pdf_url: pdfUrl };
        reimbursementSpNo = await submitWarehouseReimbursement(freshRow, itemRows);
        await connection.query(
          'UPDATE warehouse_purchases SET reimbursement_status = ?, reimbursement_sp_no = ?, status = ? WHERE id = ?',
          ['pending', reimbursementSpNo, 'reimbursing', id]
        );
      } catch (approvalErr) {
        console.error('自动发起仓库报销失败:', approvalErr.message);
      }

      await connection.commit();
      res.json({
        success: true,
        message: '确认成功，已全部确认并发起报销',
        confirmed_at: now,
        confirmed_departments: myDeptNames,
        progress: { confirmed_users: confirmedUsers, total_users: totalUsers, all_confirmed: true },
        card_updated: cardUpdated,
        card_error: cardError,
        reimbursement_sp_no: reimbursementSpNo,
      });
      return;
    }

    await connection.commit();
    res.json({
      success: true,
      message: '确认成功',
      confirmed_at: now,
      confirmed_departments: myDeptNames,
      progress: { confirmed_users: confirmedUsers, total_users: totalUsers, all_confirmed: false },
      card_updated: cardUpdated,
      card_error: cardError,
    });
  } catch (err) {
    await connection.rollback();
    console.error('仓库采购确认提交失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 3. POST / — 新建采购单（草稿）
router.post('/', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { warehouse_id, items = [] } = req.body;

    if (!warehouse_id) {
      await connection.rollback();
      return res.status(400).json({ error: 'warehouse_id 不能为空' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '采购明细不能为空' });
    }

    // 查询仓库名称
    const [whRows] = await connection.query('SELECT id, name FROM warehouses WHERE id = ?', [warehouse_id]);
    if (whRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '仓库不存在' });
    }
    const warehouseName = whRows[0].name;

    const id = uuidv4();
    const purchaseNo = await generatePurchaseNo(connection);

    // 计算申请总金额
    let totalAmount = 0;
    for (const item of items) {
      const qty = toNum(item.requested_quantity);
      const price = toNum(item.requested_unit_price);
      const amount = toNum(item.requested_amount) > 0 ? toNum(item.requested_amount) : (qty * price);
      totalAmount += amount;
    }

    const createdBy = (req.user && req.user.id) || null;
    const createdByName = (req.user && req.user.name) || null;

    await connection.query(
      `INSERT INTO warehouse_purchases
       (id, purchase_no, warehouse_id, warehouse_name, status, total_amount, created_by, created_by_name)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [id, purchaseNo, warehouse_id, warehouseName, totalAmount, createdBy, createdByName]
    );

    // 写入明细
    let sortOrder = 0;
    for (const item of items) {
      const itemId = uuidv4();
      const qty = toNum(item.requested_quantity);
      const price = toNum(item.requested_unit_price);
      const amount = toNum(item.requested_amount) > 0 ? toNum(item.requested_amount) : (qty * price);
      await connection.query(
        `INSERT INTO warehouse_purchase_items
         (id, purchase_id, item_id, item_name, category_name, spec, department_id, department_name,
          requested_quantity, requested_unit, requested_unit_price, requested_amount, reason, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId, id,
          item.item_id || null,
          item.item_name || '',
          item.category_name || null,
          item.spec || null,
          item.department_id || null,
          item.department_name || null,
          qty,
          item.requested_unit || '',
          price,
          amount,
          item.reason || null,
          sortOrder++,
        ]
      );
    }

    await connection.commit();

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    const [freshItems] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    res.json({
      ...normalizePurchaseRow(freshRows[0]),
      items: freshItems.map(normalizeItemRow),
    });
  } catch (err) {
    await connection.rollback();
    console.error('新建仓库采购单失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 2. GET /:id — 采购单详情
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const [itemRows] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    res.json({
      ...normalizePurchaseRow(rows[0]),
      items: itemRows.map(normalizeItemRow),
    });
  } catch (err) {
    console.error('获取仓库采购单详情失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /:id — 编辑草稿
router.put('/:id', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    const { warehouse_id, items = [] } = req.body;

    const [rows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    if (rows[0].status !== 'draft') {
      await connection.rollback();
      return res.status(400).json({ error: '只有草稿状态的采购单可以编辑' });
    }

    let warehouseName = rows[0].warehouse_name;
    if (warehouse_id && warehouse_id !== rows[0].warehouse_id) {
      const [whRows] = await connection.query('SELECT id, name FROM warehouses WHERE id = ?', [warehouse_id]);
      if (whRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: '仓库不存在' });
      }
      warehouseName = whRows[0].name;
    }

    // 先删后插更新明细
    await connection.query('DELETE FROM warehouse_purchase_items WHERE purchase_id = ?', [id]);

    let totalAmount = 0;
    let sortOrder = 0;
    for (const item of items) {
      const itemId = uuidv4();
      const qty = toNum(item.requested_quantity);
      const price = toNum(item.requested_unit_price);
      const amount = toNum(item.requested_amount) > 0 ? toNum(item.requested_amount) : (qty * price);
      totalAmount += amount;
      await connection.query(
        `INSERT INTO warehouse_purchase_items
         (id, purchase_id, item_id, item_name, category_name, spec, department_id, department_name,
          requested_quantity, requested_unit, requested_unit_price, requested_amount, reason, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId, id,
          item.item_id || null,
          item.item_name || '',
          item.category_name || null,
          item.spec || null,
          item.department_id || null,
          item.department_name || null,
          qty,
          item.requested_unit || '',
          price,
          amount,
          item.reason || null,
          sortOrder++,
        ]
      );
    }

    await connection.query(
      'UPDATE warehouse_purchases SET warehouse_id = ?, warehouse_name = ?, total_amount = ? WHERE id = ?',
      [warehouse_id || rows[0].warehouse_id, warehouseName, totalAmount, id]
    );

    await connection.commit();

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    const [freshItems] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    res.json({
      ...normalizePurchaseRow(freshRows[0]),
      items: freshItems.map(normalizeItemRow),
    });
  } catch (err) {
    await connection.rollback();
    console.error('编辑仓库采购单失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 5. POST /:id/submit — 提交企微审批
router.post('/:id/submit', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (row.status !== 'draft') {
      return res.status(400).json({ error: '只有草稿状态的采购单可以提交审批' });
    }

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret || !config.warehouse_approval_template_id || !config.applicant_userid) {
      return res.status(400).json({ error: '请先完成企微仓库审批配置（仓库审批模板ID和申请人用户ID）' });
    }

    const [itemRows] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    const fieldMapping = parseFieldMapping(config.warehouse_field_mapping);
    const controlTypeMap = await fetchWarehouseTemplateControlTypes(config);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const reason = '仓库采购申请';

    const applyData = await buildWarehouseApplyData(config, fieldMapping, controlTypeMap, {
      date: dateStr,
      amount: toNum(row.total_amount),
      reason,
      items: itemRows,
      useReceived: false,
      pdfPath: null,
      rowId: id,
    });

    const spNo = await submitApproval(config, applyData);

    await pool.query(
      'UPDATE warehouse_purchases SET status = ?, approval_sp_no = ?, approval_status = ? WHERE id = ?',
      ['pending_approval', spNo, 'pending', id]
    );

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(freshRows[0]));
  } catch (err) {
    console.error('提交仓库采购审批失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /:id/receive — 录入实际收货
router.post('/:id/receive', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    const { items = [] } = req.body;

    const [rows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    if (rows[0].status !== 'approved') {
      await connection.rollback();
      return res.status(400).json({ error: '只有审批通过的采购单可以录入收货' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '收货明细不能为空' });
    }

    let actualAmount = 0;
    for (const item of items) {
      const qty = toNum(item.received_quantity);
      const price = toNum(item.received_unit_price);
      const amount = qty * price;
      actualAmount += amount;
      await connection.query(
        `UPDATE warehouse_purchase_items
         SET received_quantity = ?, received_unit = ?, received_unit_price = ?, received_amount = ?, received_spec = ?
         WHERE id = ? AND purchase_id = ?`,
        [
          qty,
          item.received_unit || null,
          price,
          amount,
          item.received_spec || null,
          item.id,
          id,
        ]
      );
    }

    await connection.query(
      'UPDATE warehouse_purchases SET actual_amount = ?, status = ? WHERE id = ?',
      [actualAmount, 'received', id]
    );

    await connection.commit();

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    const [freshItems] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    res.json({
      ...normalizePurchaseRow(freshRows[0]),
      items: freshItems.map(normalizeItemRow),
    });
  } catch (err) {
    await connection.rollback();
    console.error('录入仓库采购收货失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 7. POST /:id/send-confirm — 发送确认通知（核心复用逻辑）
router.post('/:id/send-confirm', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;

    const [rows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (row.status !== 'received') {
      await connection.rollback();
      return res.status(400).json({ error: '只有已收货状态的采购单可以发送确认通知' });
    }

    const config = await getWecomConfig();
    if (!config) {
      await connection.rollback();
      return res.status(400).json({ error: '请先完成企业微信配置' });
    }
    const hasWebhook = !!config.webhook_url;
    const hasApiConfig = config.corp_id && config.app_secret && config.agent_id;
    if (!hasWebhook && !hasApiConfig) {
      await connection.rollback();
      return res.status(400).json({ error: '请先完成企业微信群聊或应用配置' });
    }

    const [itemRows] = await connection.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    // 读取各部门确认人
    const [deptRows] = await connection.query('SELECT id, name, confirmer_userid FROM departments');
    const deptConfirmerMap = {};
    const confirmerSet = new Set();
    for (const d of deptRows) {
      if (d.confirmer_userid) {
        deptConfirmerMap[d.id] = d.confirmer_userid;
        deptConfirmerMap[d.name] = d.confirmer_userid;
        confirmerSet.add(d.confirmer_userid);
      }
    }
    const mentionedUsers = Array.from(confirmerSet);

    // 按 items 的 department_id 匹配确认人，构建 userDeptMap
    const userDeptMap = {};
    for (const item of itemRows) {
      const deptId = item.department_id;
      const deptName = item.department_name;
      const confirmer = deptConfirmerMap[deptId] || deptConfirmerMap[deptName];
      if (confirmer) {
        if (!userDeptMap[confirmer]) userDeptMap[confirmer] = { items: [], depts: new Set() };
        userDeptMap[confirmer].items.push(item);
        userDeptMap[confirmer].depts.add(deptName || '未分类');
      }
    }

    if (Object.keys(userDeptMap).length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '未能匹配到任何部门确认人，请先在部门管理中配置确认人' });
    }

    const domain = config.app_domain || (req.headers.origin || (req.protocol + '://' + req.get('host')));
    const purchaseNo = row.purchase_no || '';
    const warehouseName = row.warehouse_name || '';
    const totalAmount = toNum(row.actual_amount) || toNum(row.total_amount);

    // 构建群消息 Markdown（按部门分组明细，@确认人）
    const deptNames = Array.from(new Set(itemRows.map(i => i.department_name || '未分类'))).join('、');
    let mdContent = `**📋 仓库采购确认通知**\n\n`;
    mdContent += `📦 **采购单号**：${purchaseNo}\n`;
    mdContent += `🏢 **仓库**：${warehouseName}\n`;
    mdContent += `🏢 **涉及部门**：${deptNames}\n`;
    mdContent += `💰 **总金额**：¥${totalAmount.toFixed(2)}\n\n`;
    mdContent += `---\n\n`;

    const groupedItems = {};
    for (const item of itemRows) {
      const dn = item.department_name || '未分类';
      if (!groupedItems[dn]) groupedItems[dn] = [];
      groupedItems[dn].push(item);
    }
    for (const [deptName, deptItems] of Object.entries(groupedItems)) {
      mdContent += `**【${deptName}】**\n`;
      const confirmer = deptConfirmerMap[deptItems[0] && deptItems[0].department_id] || deptConfirmerMap[deptName] || '';
      if (confirmer) mdContent += `> 确认人：${confirmer}\n`;
      for (const item of deptItems) {
        const hasReceived = toNum(item.received_amount) > 0 || toNum(item.received_quantity) > 0;
        const price = hasReceived ? toNum(item.received_unit_price) : toNum(item.requested_unit_price);
        const qty = hasReceived ? toNum(item.received_quantity) : toNum(item.requested_quantity);
        const amt = hasReceived ? toNum(item.received_amount) : toNum(item.requested_amount);
        const unit = hasReceived ? (item.received_unit || item.requested_unit) : item.requested_unit;
        mdContent += `> ${item.item_name}  ${price.toFixed(2)}/${unit} ×${qty}${unit} = ¥${amt.toFixed(2)}\n`;
      }
      const subtotal = deptItems.reduce((s, i) => {
        const hasReceived = toNum(i.received_amount) > 0 || toNum(i.received_quantity) > 0;
        return s + (hasReceived ? toNum(i.received_amount) : toNum(i.requested_amount));
      }, 0);
      mdContent += `> *小计：¥${subtotal.toFixed(2)}*\n\n`;
    }

    mdContent += `---\n\n`;
    if (mentionedUsers.length > 0) {
      mdContent += `📢 **请相关人员核对清单并确认入库**：`;
      for (const userid of mentionedUsers) {
        mdContent += ` @${userid}`;
      }
      mdContent += `\n\n`;
    }

    // 发送群消息
    let wecomMsgId = null;
    try {
      if (hasWebhook) {
        await sendMarkdownViaWebhook(config.webhook_url, mdContent);
        wecomMsgId = 'webhook';
      }
    } catch (sendErr) {
      console.error('群消息发送失败:', sendErr.message);
    }

    // 对每个确认人发送模板卡片
    const sentToUsers = [];
    const failedUsers = [];
    const sentResponseCodes = [];
    if (hasApiConfig) {
      for (const [userid, data] of Object.entries(userDeptMap)) {
        try {
          const userDeptNames = Array.from(data.depts);
          const userItems = data.items;
          const userTotal = userItems.reduce((s, i) => {
            const hasReceived = toNum(i.received_amount) > 0 || toNum(i.received_quantity) > 0;
            return s + (hasReceived ? toNum(i.received_amount) : toNum(i.requested_amount));
          }, 0);

          // 用户负责部门的内容摘要
          const subTitle = `采购单号：${purchaseNo}\n您负责的部门：${userDeptNames.join('、')}`;

          const horizontalContentList = [
            { keyname: '采购单号', value: String(purchaseNo || '-') },
            { keyname: '涉及部门', value: userDeptNames.join('、') },
            { keyname: '物资项数', value: `${userItems.length}项` },
          ];

          const userTaskId = `${id}_${userid}`;
          const confirmUrl = `${domain}/warehouse-confirm?id=${id}&user=${userid}`;

          const sendResult = await sendTemplateCardToUser(config, userid, {
            card_type: 'button_interaction',
            main_title: { title: '📋 仓库采购确认通知', desc: warehouseName },
            source: { desc: '仓库采购管理系统' },
            sub_title_text: subTitle,
            emphasis_content: { title: formatCurrency(userTotal), desc: '负责金额' },
            horizontal_content_list: horizontalContentList,
            button_list: [
              { text: '去确认', style: 1, type: 1, key: `go_confirm_${id}_${userid}`, url: confirmUrl },
            ],
            task_id: userTaskId,
            card_action: { type: 1, url: confirmUrl },
          });

          sentResponseCodes.push({ userid, responseCode: sendResult.response_code });
          sentToUsers.push({ userid, departments: userDeptNames.join('、'), total: userTotal });
        } catch (sendErr) {
          console.error(`发送个人模板卡片消息失败 ${userid}:`, sendErr.message);
          failedUsers.push({ userid, error: sendErr.message });
        }
      }
    }

    // 构建 user_departments 存库
    const userDepartmentsMap = {};
    for (const [userid, data] of Object.entries(userDeptMap)) {
      const sentItem = sentResponseCodes.find(s => s.userid === userid);
      userDepartmentsMap[userid] = {
        departments: Array.from(data.depts),
        response_code: sentItem ? sentItem.responseCode : null,
      };
    }

    await connection.query(
      'UPDATE warehouse_purchases SET wecom_msg_id = ?, user_departments = ?, user_confirmations = ?, status = ? WHERE id = ?',
      [wecomMsgId, JSON.stringify(userDepartmentsMap), JSON.stringify({}), 'confirming', id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: '确认通知已发送',
      wecom_msg_id: wecomMsgId,
      sent_to_users: sentToUsers,
      failed_users: failedUsers,
      user_departments: userDepartmentsMap,
    });
  } catch (err) {
    await connection.rollback();
    console.error('发送仓库采购确认通知失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 10. POST /:id/generate-pdf — 生成PDF
router.post('/:id/generate-pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    await generateWarehousePDF(id);
    const pdfUrl = `/api/warehouse-purchases/${id}/pdf`;
    await pool.query('UPDATE warehouse_purchases SET pdf_url = ? WHERE id = ?', [pdfUrl, id]);
    res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('仓库采购PDF生成失败:', err);
    res.status(500).json({ error: err.message || 'PDF生成失败' });
  }
});

// 11. GET /:id/pdf — 下载PDF（免登录，不存在则自动生成）
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const pdfPath = path.join(PDF_DIR, `warehouse_${id}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      // 自动生成
      const [rows] = await pool.query('SELECT id FROM warehouse_purchases WHERE id = ?', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: '采购单不存在' });
      }
      await generateWarehousePDF(id);
      try {
        await pool.query('UPDATE warehouse_purchases SET pdf_url = ? WHERE id = ?', [`/api/warehouse-purchases/${id}/pdf`, id]);
      } catch (e) { /* 忽略 */ }
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF文件不存在' });
    }
    res.download(pdfPath, `仓库采购确认单_${id}.pdf`);
  } catch (err) {
    console.error('下载仓库采购PDF失败:', err);
    res.status(500).json({ error: err.message || '下载失败' });
  }
});

// 12. POST /:id/refresh-status — 刷新报销审批状态
router.post('/:id/refresh-status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];

    if (!row.reimbursement_sp_no) {
      return res.status(400).json({ error: '该采购单尚未发起报销审批' });
    }

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }

    let detail = null;
    let spStatus = null;
    let spRecord = [];
    try {
      detail = await getApprovalDetail(config, row.reimbursement_sp_no);
      const info = detail.info || {};
      spStatus = info.sp_status;
      spRecord = info.sp_record || [];
    } catch (detailErr) {
      console.error('查询审批详情失败:', detailErr.message);
      return res.status(500).json({ error: `查询审批状态失败：${detailErr.message}` });
    }

    let newReimburseStatus = row.reimbursement_status;
    let newStatus = row.status;
    if (spStatus === 2) {
      newReimburseStatus = 'approved';
      newStatus = 'reimbursed';
    } else if (spStatus === 1) {
      newReimburseStatus = 'processing';
    } else if (spStatus === 3) {
      newReimburseStatus = 'rejected';
    }

    let latestApprover = null;
    if (spRecord.length > 0) {
      const lastRecord = spRecord[spRecord.length - 1];
      if (lastRecord.approver && lastRecord.approver.length > 0) {
        latestApprover = lastRecord.approver[0].name || lastRecord.approver[0].userid;
      }
    }

    await pool.query(
      'UPDATE warehouse_purchases SET reimbursement_status = ?, status = ? WHERE id = ?',
      [newReimburseStatus, newStatus, id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json({
      ...normalizePurchaseRow(updatedRows[0]),
      sp_status: spStatus,
      latest_approver: latestApprover,
    });
  } catch (err) {
    console.error('刷新仓库采购报销状态失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 13. POST /:id/resubmit — 重新发起报销
router.post('/:id/resubmit', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (row.reimbursement_status !== 'rejected') {
      return res.status(400).json({ error: '只有报销被拒绝的采购单可以重新发起' });
    }

    const [itemRows] = await pool.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    // 重新生成 PDF（确保最新）
    try { await generateWarehousePDF(id); } catch (e) { console.error('重新生成PDF失败:', e.message); }

    const spNo = await submitWarehouseReimbursement(row, itemRows);

    await pool.query(
      'UPDATE warehouse_purchases SET reimbursement_status = ?, reimbursement_sp_no = ?, status = ? WHERE id = ?',
      ['pending', spNo, 'reimbursing', id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(updatedRows[0]));
  } catch (err) {
    console.error('重新发起仓库报销失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. DELETE /:id — 删除采购单
router.delete('/:id', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    const [rows] = await connection.query('SELECT id, status FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    if (rows[0].status !== 'draft' && rows[0].status !== 'cancelled') {
      await connection.rollback();
      return res.status(400).json({ error: '只有草稿或已取消的采购单可以删除' });
    }

    await connection.query('DELETE FROM warehouse_purchase_items WHERE purchase_id = ?', [id]);
    await connection.query('DELETE FROM warehouse_purchases WHERE id = ?', [id]);

    await connection.commit();
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error('删除仓库采购单失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
