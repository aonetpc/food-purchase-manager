const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');

// PDF存储目录
const PDF_DIR = '/opt/food-purchase/backend/uploads/pdfs';

// 确保PDF目录存在
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

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

// 安全数值转换（兼容mysql2 decimal对象）
function toNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'object') {
    const str = val.String || val.string || val.val || JSON.stringify(val);
    return parseFloat(str) || 0;
  }
  if (typeof val === 'string') return parseFloat(val) || 0;
  return Number(val) || 0;
}

// 生成食材采购确认单PDF
async function generateConfirmationPDF(confirmationId) {
  const [rows] = await pool.query('SELECT * FROM purchase_confirmations WHERE id = ?', [confirmationId]);
  if (rows.length === 0) throw new Error('确认单不存在');

  const row = rows[0];
  const departments = typeof row.departments === 'string' ? JSON.parse(row.departments) : row.departments;
  const purchaseItems = typeof row.purchase_items === 'string' ? JSON.parse(row.purchase_items) : row.purchase_items;
  const signatures = typeof row.confirmed_signatures === 'string' ? JSON.parse(row.confirmed_signatures || '{}') : (row.confirmed_signatures || {});
  const userConfirmations = typeof row.user_confirmations === 'string' ? JSON.parse(row.user_confirmations || '{}') : (row.user_confirmations || {});

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const pdfPath = path.join(PDF_DIR, `${confirmationId}.pdf`);
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);

  const chineseFont = findChineseFont();
  const chineseBoldFont = findChineseBoldFont();
  const hasChineseFont = !!chineseFont;
  if (hasChineseFont) {
    doc.registerFont('Chinese-Regular', chineseFont);
    doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
  }

  doc.fontSize(18).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text('食材采购确认单', { align: 'center' });
  doc.moveDown(0.5);

  doc.fontSize(10).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');
  let purchaseDateStr = '';
  if (row.purchase_date instanceof Date) {
    const d = row.purchase_date;
    purchaseDateStr = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  } else if (typeof row.purchase_date === 'string') {
    purchaseDateStr = row.purchase_date.substring(0, 10);
  } else {
    purchaseDateStr = String(row.purchase_date).substring(0, 10);
  }
  const statusLabel = row.status === 'confirmed' ? '已确认' : row.status === 'completed' ? '已完成' : row.status;
  doc.text(`采购日期：${purchaseDateStr}    总金额：¥${toNum(row.total_amount).toFixed(2)}    状态：${statusLabel}`);
  doc.moveDown(0.5);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const tableX = doc.page.margins.left;
  const tableWidth = pageWidth;

  // 按部门分组
  const groupedItems = {};
  for (const item of purchaseItems) {
    const deptName = item.department_name || '未分类';
    if (!groupedItems[deptName]) groupedItems[deptName] = [];
    groupedItems[deptName].push(item);
  }

  const headers = ['食材名称', '单价/单位', '数量', '单位', '金额'];
  const colWidths = [tableWidth * 0.32, tableWidth * 0.20, tableWidth * 0.12, tableWidth * 0.10, tableWidth * 0.26];
  const fixedRowHeight = 11;
  const signatureHeight = 28;

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

  function drawDepartmentSignature(y, deptName) {
    const sigTop = y;
    const sigWidth = tableWidth;

    doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');

    // 新流程：从 user_confirmations 中查找负责该部门且已确认的用户
    const confirmedUser = Object.entries(userConfirmations).find(([, conf]) =>
      conf && conf.confirmed && Array.isArray(conf.departments) && conf.departments.includes(deptName)
    );

    if (confirmedUser) {
      const conf = confirmedUser[1];
      const infoText = `确认人：${conf.confirmed_by || '-'}    确认时间：${conf.confirmed_at || '-'}`;
      doc.text(infoText, tableX + 2, sigTop + 2, { width: sigWidth - 4, align: 'left' });

      if (conf.signature_data) {
        try {
          const base64Data = conf.signature_data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          doc.image(buffer, tableX + 2, sigTop + 12, { width: sigWidth - 4, height: signatureHeight - 14, fit: [sigWidth - 4, signatureHeight - 14] });
        } catch (e) {}
      }
      return signatureHeight;
    }

    // 兼容旧流程：从 departments 数组和 confirmed_signatures 中读取
    const dept = Array.isArray(departments) && departments.find(d => d && d.name === deptName);
    if (dept && dept.confirmed) {
      const infoText = `确认人：${dept.confirmed_by || '-'}    确认时间：${dept.confirmed_at || '-'}`;
      doc.text(infoText, tableX + 2, sigTop + 2, { width: sigWidth - 4, align: 'left' });

      const sigData = signatures[String(dept.id)] || signatures[dept.id];
      if (sigData && sigData.data) {
        try {
          const base64Data = sigData.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          doc.image(buffer, tableX + 2, sigTop + 12, { width: sigWidth - 4, height: signatureHeight - 14, fit: [sigWidth - 4, signatureHeight - 14] });
        } catch (e) {}
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
    // 估算当前部门所需高度（标题行 + 物品行 + 小计行 + 签字区 + 间距）
    const deptNeededHeight = fixedRowHeight + items.length * fixedRowHeight + 14 + signatureHeight + 15;
    currentY = checkPageBreak(currentY, deptNeededHeight);

    // 部门标题
    doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`【${deptName}】`, tableX, currentY + 1);
    currentY += fixedRowHeight;

    // 部门物品明细
    doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').fontSize(7);
    let subtotal = 0;
    for (const item of items) {
      const cells = [
        item.ingredient_name,
        `${toNum(item.purchase_unit_price).toFixed(2)}/${item.purchase_unit}`,
        String(item.purchase_quantity),
        item.purchase_unit,
        `¥${toNum(item.amount).toFixed(2)}`
      ];
      currentY += drawTableRow(currentY, cells);
      subtotal += toNum(item.amount);
    }
    grandTotal += subtotal;

    // 部门小计
    doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`小计：¥${subtotal.toFixed(2)}`, tableX, currentY, { width: tableWidth, align: 'right' });
    currentY += 10;

    // 部门签字区
    doc.save();
    doc.rect(tableX, currentY, tableWidth, signatureHeight).stroke('#cccccc');
    doc.restore();
    currentY += drawDepartmentSignature(currentY, deptName);

    // 部门之间分隔
    currentY += 15;
  }

  // 总计
  currentY = checkPageBreak(currentY, 30);
  doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();
  doc.fontSize(9).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`总计：¥${grandTotal.toFixed(2)}`, tableX, currentY + 3, { width: tableWidth, align: 'right' });

  doc.moveDown(0.5);
  doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').text(`生成时间：${new Date().toLocaleString('zh-CN')}`, { align: 'right' });

  doc.end();

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(pdfPath));
    writeStream.on('error', reject);
  });
}

// 确保上传目录存在
function ensureUploadDir() {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }
}

module.exports = {
  generateConfirmationPDF,
  findChineseFont,
  findChineseBoldFont,
  toNum,
  PDF_DIR,
  ensureUploadDir
};
