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
const { requireRole } = require('../middleware/roleAuth');
const {
  getWecomConfig,
  sendMarkdownViaWebhook,
  sendWecomMessage,
  sendTextViaWebhook,
  sendTemplateCardToUser,
  updateTemplateCardButton,
  getWecomUserName,
  submitApproval,
  getApprovalDetail,
  uploadMedia,
} = require('./wecom');
const {
  mapPurchaseApproval,
  mapReimbursement,
  mapPrepayApproval,
  isApplied,
  applyFields,
  writeAlertLog,
} = require('../utils/wecom-approval-status');
const { computeNetAmount } = require('../utils/purchase-net-amount');

// 带超时的 fetch 包装函数
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// access_token 缓存
let _accessTokenCache = { token: '', expireTime: 0 };
const ACCESS_TOKEN_TTL = 7000 * 1000;

async function getAccessToken(config) {
  const now = Date.now();
  if (_accessTokenCache.token && (now - _accessTokenCache.expireTime) < ACCESS_TOKEN_TTL) {
    return _accessTokenCache.token;
  }
  const res = await fetchWithTimeout(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corp_id}&corpsecret=${config.app_secret}`,
    {},
    10000
  );
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(data.errmsg || '获取access_token失败');
  _accessTokenCache = { token: data.access_token, expireTime: now };
  return data.access_token;
}

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

// 解析确认人 userid 字段（支持逗号或竖线分隔的多人配置）
// 返回去重后的 userid 数组
function parseConfirmerUserids(raw) {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  // 同时支持英文逗号、中文逗号、竖线、空格分隔
  const parts = str.split(/[,，|\s]+/).map(s => s.trim()).filter(Boolean);
  return Array.from(new Set(parts));
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

// 规整采购单行（解析 JSON 字段、计算确认进度、计算PDF URL）
function normalizePurchaseRow(row) {
  if (!row) return row;
  const userDepartments = parseJsonField(row.user_departments) || {};
  const userConfirmations = parseJsonField(row.user_confirmations) || {};
  const totalUsers = Object.keys(userDepartments).length;
  const confirmedUsers = Object.values(userConfirmations).filter(c => c && c.confirmed).length;
  const id = row.id;
  let pdfUrl = row.pdf_url;
  let applyPdfUrl = row.apply_pdf_url;
  const confirmPdfPath = path.join(PDF_DIR, `warehouse_${id}.pdf`);
  const applyPdfPath = row.apply_pdf_path || path.join(PDF_DIR, `warehouse_apply_${id}.pdf`);
  // 确认单 PDF 与申请单 PDF 走独立 URL（带 type 参数区分）
  if (fs.existsSync(confirmPdfPath)) {
    pdfUrl = `/api/warehouse-purchases/${id}/pdf?type=confirm`;
  }
  if (fs.existsSync(applyPdfPath)) {
    applyPdfUrl = `/api/warehouse-purchases/${id}/pdf?type=apply`;
  }
  return {
    ...row,
    total_amount: toNum(row.total_amount),
    actual_amount: toNum(row.actual_amount),
    returned_amount: toNum(row.returned_amount),
    net_amount: computeNetAmount(row),
    prepay_amount: toNum(row.prepay_amount),
    writeoff_amount: toNum(row.writeoff_amount),
    user_departments: userDepartments,
    user_confirmations: userConfirmations,
    total_users: totalUsers,
    confirmed_users: confirmedUsers,
    pdf_url: pdfUrl,
    apply_pdf_url: applyPdfUrl,
    prepay_attachments: parseJsonField(row.prepay_attachments) || null,
  };
}

// 规整明细行（金额安全转换 + 字段名映射）
function normalizeItemRow(item) {
  if (!item) return item;
  return {
    ...item,
    // 映射到前端友好的字段名
    quantity: toNum(item.requested_quantity),
    unit_price: toNum(item.requested_unit_price),
    amount: toNum(item.requested_amount),
    unit: item.requested_unit || '',
    // 保留原始字段（兼容其他调用方）
    requested_quantity: toNum(item.requested_quantity),
    requested_unit_price: toNum(item.requested_unit_price),
    requested_amount: toNum(item.requested_amount),
    requested_unit: item.requested_unit || '',
    received_quantity: toNum(item.received_quantity),
    received_unit_price: toNum(item.received_unit_price),
    received_amount: toNum(item.received_amount),
    returned_quantity: toNum(item.returned_quantity),
    // 采购人申报的当前库存（NULL = 未填报）
    stock_at_purchase: item.stock_at_purchase != null ? toNum(item.stock_at_purchase) : null,
  };
}

// ================================================
// 企微审批辅助：获取模板控件类型
// ================================================
async function fetchWarehouseTemplateControlTypes(config, isPrepay = false, templateIdOverride = null) {
  const accessToken = await getAccessToken(config);
  // 优先使用显式指定的模板ID，其次按 isPrepay 选择预付款模板
  // 预付款回退顺序：prepay_approval_template_id → approval_template_id（费用报销模板）→ warehouse_approval_template_id
  const tplId = templateIdOverride
    || (isPrepay ? (config.prepay_approval_template_id || config.approval_template_id || config.warehouse_approval_template_id) : config.warehouse_approval_template_id);
  console.log(`[企微] 获取审批模板详情... template_id=${tplId}`);
  const tplResp = await fetchWithTimeout(
    `https://qyapi.weixin.qq.com/cgi-bin/oa/gettemplatedetail?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: tplId }),
    },
    10000
  );
  const tplData = await tplResp.json();
  if (tplData.errcode !== 0) {
    throw new Error('获取审批模板详情失败：' + (tplData.errmsg || ''));
  }
  const controlTypeMap = {};
  const selectorOptionsMap = {};
  const requiredControls = new Set();
  const controlTitles = {};
  const contactModes = {}; // Contact 控件的 mode 配置：{ ctrlId: { mode: 'user'|'department', type: 'single'|'multi' } }
  if (tplData.template_content && tplData.template_content.controls) {
    for (const ctrl of tplData.template_content.controls) {
      if (ctrl.property && ctrl.property.id && ctrl.property.control) {
        const ctrlId = ctrl.property.id;
        const ctrlType = ctrl.property.control;
        controlTypeMap[ctrlId] = ctrlType;

        // 解析控件标题（企微API实际返回 property.title，兼容 placeholder / name）
        const pickFirstText = (arr) => (Array.isArray(arr) && arr.length > 0 ? (arr[0]?.text || '') : '');
        const title = pickFirstText(ctrl.property.title)
          || pickFirstText(ctrl.property.placeholder)
          || pickFirstText(ctrl.property.name)
          || '';
        if (title) controlTitles[ctrlId] = title;

        // 解析 required 标记
        if (ctrl.require === 1 || ctrl.require === '1' || ctrl.required === 1 || ctrl.required === '1') {
          requiredControls.add(ctrlId);
        }
        // 从 config 中解析 require
        const ctrlConfig = ctrl.config || {};
        if (ctrlConfig.require === 1 || ctrlConfig.require === '1'
          || ctrlConfig.required === 1 || ctrlConfig.required === '1'
          || ctrlConfig.not_null === 1 || ctrlConfig.not_null === '1') {
          requiredControls.add(ctrlId);
        }
        if ((ctrl.property.require === 1) || (ctrl.property.require === '1')
          || (ctrl.property.required === 1) || (ctrl.property.required === '1')) {
          requiredControls.add(ctrlId);
        }

        // 解析 Contact 控件的 mode（user-成员 / department-部门）和 type（single/multi）
        if (ctrlType === 'Contact') {
          const contactConfig = ctrlConfig.contact || {};
          const mode = contactConfig.mode || ''; // user / department
          const cType = contactConfig.type || ''; // single / multi
          contactModes[ctrlId] = { mode, type: cType };
          console.log(`[企微] Contact控件配置: id=${ctrlId}, title=${title || '(无标题)'}, mode=${mode || '(未配置)'}, type=${cType || '(未配置)'}, config=${JSON.stringify(ctrlConfig)}`);
        }

        if (ctrlType === 'MultiSelector' || ctrlType === 'Selector') {
          const options = [];
          const selector = ctrlConfig.selector || ctrl.value?.selector;
          if (selector && selector.options) {
            for (const opt of selector.options) {
              const text = opt.value?.find((t) => t.lang === 'zh_CN')?.text
                || opt.value?.find((t) => t.text)?.text
                || opt.key;
              options.push({ key: opt.key, text: String(text) });
            }
          }
          selectorOptionsMap[ctrlId] = options;
        }
      }
    }
  }
  console.log(`[企微] 模板控件类型获取成功: controls=${JSON.stringify(controlTypeMap)}, required=[${Array.from(requiredControls).join(',')}], titles=${JSON.stringify(controlTitles)}, contactModes=${JSON.stringify(contactModes)}`);
  return { controlTypeMap, selectorOptionsMap, accessToken, requiredControls, controlTitles, contactModes };
}

// 缓存企微部门列表（避免重复调用API）
let _wecomDeptCache = null;
let _wecomDeptCacheTime = 0;
const WECOM_DEPT_CACHE_TTL = 5 * 60 * 1000; // 5分钟

async function fetchWecomDepartments(accessToken) {
  const now = Date.now();
  if (_wecomDeptCache && (now - _wecomDeptCacheTime) < WECOM_DEPT_CACHE_TTL) {
    console.log('[企微] 使用缓存的部门列表');
    return _wecomDeptCache;
  }
  console.log('[企微] 获取部门列表...');
  const allDepts = [];
  const visitedIds = new Set();
  
  const fetchDept = async (parentId, depth = 0) => {
    // 深度限制：最多5层，防止无限递归
    if (depth > 5) {
      console.log('[企微] 部门递归深度超限，停止');
      return;
    }
    if (visitedIds.has(parentId)) return;
    visitedIds.add(parentId);
    
    try {
      const resp = await fetchWithTimeout(
        `https://qyapi.weixin.qq.com/cgi-bin/department/list?access_token=${accessToken}&id=${parentId}`,
        {},
        8000
      );
      const data = await resp.json();
      if (data.errcode === 0 && data.department) {
        for (const d of data.department) {
          allDepts.push({ id: d.id, name: d.name, parentid: d.parentid });
          await fetchDept(d.id, depth + 1);
        }
      }
    } catch (e) {
      console.error(`[企微] 获取部门失败 id=${parentId}:`, e.message);
    }
  };
  
  try {
    await fetchDept(1); // 从根部门开始
  } catch (e) {
    console.error('[企微] 获取部门列表异常:', e.message);
  }
  
  _wecomDeptCache = allDepts;
  _wecomDeptCacheTime = now;
  console.log(`[企微] 部门列表获取成功，共${allDepts.length}个部门`);
  return allDepts;
}

// 构建仓库审批 apply_data（采购审批 / 报销审批复用）
// options: { date, amount, reason, items, useReceived, pdfPath, rowId, creatorUserid, payeeName, relatedApprovalSpNo, requiredControls, controlTitles, contactModes, templateIdOverride, attachments, remarkTextOverride }
async function buildWarehouseApplyData(config, fieldMapping, controlTypeMap, selectorOptionsMap, options) {
  const { date, amount, reason, items, useReceived = false, pdfPath = null, rowId, creatorUserid, payeeName, relatedApprovalSpNo = null, requiredControls, controlTitles, contactModes, templateIdOverride, pdfType = 'confirm', attachments = [], remarkTextOverride = null } = options;

  // ================= 控件ID自动发现（兜底） =================
  // 1) 校验 fieldMapping.department 对应的ID在 controlTypeMap中存在且类型是Contact
  //    如果不匹配，自动从controlTypeMap找第一个Contact控件（标题含"部门"/"申购"优先）
  const allContactIds = Object.entries(controlTypeMap || {})
    .filter(([, type]) => type === 'Contact')
    .map(([id]) => id);
  console.log(`[审批构建] 所有Contact控件: ${allContactIds.join(',')}`);

  function findDeptContactId() {
    if (allContactIds.length === 0) return null;
    // 优先：标题含"部门"
    let hit = allContactIds.find(id => {
      const t = String(controlTitles?.[id] || '');
      return t.includes('部门') || t.includes('申购部门') || t.includes('采购部门');
    });
    if (hit) return hit;
    // 其次：fieldMapping.department在contact列表里
    if (fieldMapping.department && allContactIds.includes(fieldMapping.department)) {
      return fieldMapping.department;
    }
    // 兜底：第一个Contact
    return allContactIds[0];
  }

  const effectiveDeptId = findDeptContactId();
  if (effectiveDeptId && effectiveDeptId !== fieldMapping.department) {
    console.log(`[审批构建] department控件自动修正: fieldMapping=${fieldMapping.department || '空'} -> ${effectiveDeptId} (title=${controlTitles?.[effectiveDeptId] || ''})`);
    fieldMapping = { ...fieldMapping, department: effectiveDeptId };
  }

  // 记住部门Contact的selected数组（必填兜底复用）
  let selectedBeforeFallback = [];

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

  // 事由（已包含完整信息，不再追加部门）
  const deptNames = Array.from(new Set(
    (items || []).map(i => String(i.department_name || '').trim()).filter(Boolean)
  ));
  const fullDeptList = deptNames.length > 0 ? deptNames.join('、') : '未分类';
  if (fieldMapping.reason) {
    contents.push({
      control: getControlType('reason', 'Text'),
      id: fieldMapping.reason,
      value: { text: reason },
    });
  }

  // 涉及部门（根据控件类型分别处理）
  if (fieldMapping.department) {
    const deptControlType = getControlType('department', 'MultiSelector');

    // 优先使用部门表中的 wecom_dept_id（手动配置，零API调用）
    const itemsWithWecomId = (items || []).filter(i => i.wecom_dept_id);
    const directDeptIds = Array.from(new Set(
      itemsWithWecomId.map(i => String(i.wecom_dept_id)).filter(Boolean)
    ));
    console.log(`[企微-部门] 控件类型=${deptControlType}, deptNames=${deptNames.join(',')}, directDeptIds=${directDeptIds.join(',')}, 明细带wecom_dept_id=${itemsWithWecomId.length}/${(items||[]).length}`);

    if (deptControlType === 'Contact') {
      // Contact 类型：根据模板 config.contact.mode 决定是部门还是成员
      // mode=user（成员模式）：value 用 members [{userid, name}]
      // mode=department（部门模式）：value 用 departments [{openapi_id, name}]
      const creatorUserid = options.creatorUserid || '';
      if (!options.creatorUserid) {
        console.warn('[企微-Contact] creatorUserid 为空，请确保接口层已校验当前用户绑定企微账号');
      }
      const deptContactMode = contactModes?.[fieldMapping.department]?.mode || '';
      console.log(`[企微-Contact] 控件id=${fieldMapping.department}, 模板mode=${deptContactMode || '(未配置,默认department)'}`);

      // 构建 wecom_dept_id -> department_name 映射
      const deptIdNameMap = {};
      for (const item of (items || [])) {
        if (item.wecom_dept_id && item.department_name) {
          deptIdNameMap[String(item.wecom_dept_id)] = item.department_name;
        }
      }

      let selected = [];
      if (directDeptIds.length > 0) {
        // 直接使用手动配置的企微部门ID + 对应名称
        selected = directDeptIds.map(id => ({
          id: id,
          name: deptIdNameMap[id] || deptNames.find(n => n) || id,
        }));
        console.log(`[企微] Contact控件: 直接使用wecom_dept_id, selected=`, JSON.stringify(selected));
      } else {
        // 兜底：调用API匹配
        let wecomDeptList = [];
        try {
          const token = await getAccessToken(config);
          wecomDeptList = await fetchWecomDepartments(token);
        } catch (e) { /* ignore */ }

        const matchedDeptIds = new Set();
        for (const deptName of deptNames) {
          let matched = wecomDeptList.find(d => d.name === deptName);
          if (!matched) {
            matched = wecomDeptList.find(d => d.name.includes(deptName) || deptName.includes(d.name));
          }
          if (matched && !matchedDeptIds.has(String(matched.id))) {
            selected.push({ id: String(matched.id), name: matched.name });
            matchedDeptIds.add(String(matched.id));
          }
        }
        console.log(`[企微] Contact控件: API匹配, selected=`, JSON.stringify(selected));
      }

      // 根据 mode 决定 value 格式
      // mode=user：成员模式，传 members（用申请人userid）
      // mode=department 或未配置：部门模式，传 departments
      const isUserMode = deptContactMode === 'user';

      if (isUserMode) {
        // 成员模式：传申请人userid
        if (creatorUserid) {
          contents.push({
            control: 'Contact',
            id: fieldMapping.department,
            value: {
              members: [{ userid: String(creatorUserid), name: '申请人' }],
            },
          });
          console.log(`[企微] 填充Contact(id=${fieldMapping.department}, mode=user): members=[{userid=${creatorUserid}}]`);
        } else {
          console.warn(`[企微] Contact控件mode=user但无creatorUserid，跳过`);
        }
      } else {
        // 部门模式：传 departments
        if (selected.length > 0) {
          contents.push({
            control: 'Contact',
            id: fieldMapping.department,
            value: {
              departments: selected.map(s => ({ openapi_id: String(s.id), name: s.name })),
            },
          });
          console.log(`[企微] 填充部门Contact(id=${fieldMapping.department}, mode=${deptContactMode || 'department'}): departments=${JSON.stringify(selected.map(s => ({ openapi_id: s.id, name: s.name })))}`);
        } else if (creatorUserid) {
          // 兜底：无部门匹配时用申请人userid
          contents.push({
            control: 'Contact',
            id: fieldMapping.department,
            value: {
              members: [{ userid: String(creatorUserid), name: '申请人' }],
            },
          });
          console.log(`[企微] 部门Contact无匹配，兜底用申请人: userid=${creatorUserid}`);
        }
      }
      // 记住这个selected，供必填兜底复用
      if (deptControlType === 'Contact') {
        selectedBeforeFallback = selected.slice();
      }
    } else {
      // MultiSelector / Selector：按名称匹配企微选项key
      let deptOptions = [];
      const cachedOptions = parseJsonField(config.warehouse_dept_options);
      if (Array.isArray(cachedOptions) && cachedOptions.length > 0) {
        deptOptions = cachedOptions;
      } else if (selectorOptionsMap[fieldMapping.department]) {
        deptOptions = selectorOptionsMap[fieldMapping.department];
      }

      const matchedOptions = [];
      const matchedDeptNames = new Set();
      for (const deptName of deptNames) {
        let opt = deptOptions.find(o => o.text === deptName);
        if (!opt) {
          opt = deptOptions.find(o => o.text.includes(deptName) || deptName.includes(o.text));
        }
        if (opt && !matchedDeptNames.has(opt.key)) {
          matchedOptions.push({ key: opt.key, value: [{ text: opt.text, lang: 'zh_CN' }] });
          matchedDeptNames.add(opt.key);
        }
      }

      console.log(`[企微] ${deptControlType}控件值: matched=${matchedOptions.length}, deptNames=${deptNames.join(',')}`);

      if (deptControlType === 'MultiSelector') {
        contents.push({
          control: 'MultiSelector',
          id: fieldMapping.department,
          value: { options: matchedOptions },
        });
      } else if (deptControlType === 'Selector') {
        const singleOpt = matchedOptions[0]
          || (deptOptions[0] ? { key: deptOptions[0].key, value: [{ text: deptOptions[0].text, lang: 'zh_CN' }] } : null);
        if (singleOpt) {
          contents.push({
            control: 'Selector',
            id: fieldMapping.department,
            value: { selector: { type: 'single', options: [singleOpt] } },
          });
        }
      } else {
        // Text 兜底
        contents.push({
          control: deptControlType || 'Text',
          id: fieldMapping.department,
          value: { text: fullDeptList },
        });
      }
    }
  }

  // 收款方/银行/账号（仅报销时传递）
  // 收款人优先使用传入的 payeeName（如申请人自己），否则回退到 config.payee_name
  let paymentLabel = '转账';
  const effectivePayeeName = payeeName || config.payee_name;
  if (useReceived) {
    if (fieldMapping.payee_name && effectivePayeeName) {
      contents.push({ control: getControlType('payee_name', 'Text'), id: fieldMapping.payee_name, value: { text: String(effectivePayeeName) } });
    }
    if (fieldMapping.bank_name && config.bank_name) {
      contents.push({ control: getControlType('bank_name', 'Text'), id: fieldMapping.bank_name, value: { text: String(config.bank_name) } });
    }
    if (fieldMapping.bank_account && config.bank_account) {
      contents.push({ control: getControlType('bank_account', 'Text'), id: fieldMapping.bank_account, value: { text: String(config.bank_account) } });
    }

    // 付款方式
    if (fieldMapping.payment_method && config.default_payment_key) {
      let paymentOptions = {};
      if (config.payment_options) {
        if (typeof config.payment_options === 'string') {
          try { paymentOptions = JSON.parse(config.payment_options); } catch (e) { paymentOptions = {}; }
        } else if (typeof config.payment_options === 'object') {
          paymentOptions = config.payment_options;
        }
      }
      paymentLabel = String(paymentOptions[config.default_payment_key] || '转账');
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

  // 文件附件（PDF + 手动上传附件，统一填充到 File 控件）
  const fileControlId = fieldMapping.attachment || Object.entries(controlTypeMap).find(([, ctype]) => ctype === 'File')?.[0];
  const filesToAttach = [];

  // PDF 附件
  if (pdfPath && fileControlId && fs.existsSync(pdfPath)) {
    try {
      const pdfLabel = pdfType === 'apply' ? '仓库采购申请单' : '仓库采购确认单';
      const pdfFilename = `${pdfLabel}_${rowId || ''}.pdf`;
      const mediaId = await uploadMedia(config, pdfPath, pdfFilename);
      filesToAttach.push({ file_id: mediaId, filename: pdfFilename });
    } catch (uploadErr) {
      console.error('上传PDF附件失败:', uploadErr.message);
    }
  }

  // 手动上传的附件（mediaId 已在接口层上传获取）
  if (attachments && attachments.length > 0 && fileControlId) {
    for (const att of attachments) {
      if (att.mediaId) {
        filesToAttach.push({ file_id: att.mediaId, filename: att.filename || '附件' });
      }
    }
  }

  if (filesToAttach.length > 0 && fileControlId) {
    contents.push({
      control: controlTypeMap[fileControlId] || 'File',
      id: fileControlId,
      value: { files: filesToAttach },
    });
    console.log(`[审批构建] 填充File控件(id=${fileControlId}): ${filesToAttach.length}个文件`);
  }

  // ================= 报销模式：备注说明（涉及部门 / 自定义） =================
  // 备注说明内容优先级：remarkTextOverride > 自动计算"涉及部门：xxx"
  // 控件发现优先级：fieldMapping.remark > 模板中标题含"备注"或"说明"的 Text/Textarea 控件
  if (useReceived) {
    let remarkText = '';
    if (remarkTextOverride) {
      remarkText = String(remarkTextOverride);
    } else {
      const deptNames = Array.from(new Set(
        (items || []).map(i => String(i.department_name || '').trim()).filter(Boolean)
      ));
      remarkText = deptNames.length > 0 ? `涉及部门：${deptNames.join('、')}` : '';
    }
    if (remarkText) {
      // filledIds 去重：该控件已被其他逻辑（如原字段映射）push 过则跳过
      const existingFilledIds = new Set(contents.map(c => c.id));
      let remarkControlId = null;
      if (fieldMapping.remark && !existingFilledIds.has(fieldMapping.remark)) {
        remarkControlId = fieldMapping.remark;
      }
      // 只有 fieldMapping.remark 未配置时才尝试自动发现
      if (!remarkControlId && !fieldMapping.remark && controlTitles) {
        const remarkEntry = Object.entries(controlTitles).find(([id, title]) => {
          if (existingFilledIds.has(id)) return false;
          const t = String(title || '');
          return (t.includes('备注') || t.includes('说明')) && (controlTypeMap[id] === 'Text' || controlTypeMap[id] === 'Textarea');
        });
        if (remarkEntry) remarkControlId = remarkEntry[0];
      }
      if (remarkControlId && !existingFilledIds.has(remarkControlId)) {
        contents.push({
          control: controlTypeMap[remarkControlId] || 'Text',
          id: remarkControlId,
          value: { text: remarkText },
        });
        console.log(`[审批构建] 填充备注说明(id=${remarkControlId}): ${remarkText}`);
      }
    }
  }

  // ================= 报销模式：关联审批单（RelatedApproval 控件） =================
  // 引用之前填写的采购申请单（approval_sp_no）
  // 企微官方格式：{ related_approval: [{ sp_no, sp_name, template_id }] }
  // 控件发现优先级：fieldMapping.related_approval > 模板中第一个 RelatedApproval 控件
  if (useReceived && relatedApprovalSpNo) {
    let relatedControlId = fieldMapping.related_approval || null;
    if (!relatedControlId && controlTypeMap) {
      // 自动发现：第一个 RelatedApproval 类型控件
      const relatedEntry = Object.entries(controlTypeMap).find(([, ctype]) => ctype === 'RelatedApproval');
      if (relatedEntry) relatedControlId = relatedEntry[0];
    }
    if (relatedControlId) {
      // 查询采购审批单详情获取 sp_name 和 template_id
      let relatedItems = [{ sp_no: String(relatedApprovalSpNo), sp_name: '仓库采购申请', template_id: '' }];
      try {
        const approvalDetail = await getApprovalDetail(config, String(relatedApprovalSpNo));
        if (approvalDetail) {
          relatedItems = [{
            sp_no: String(approvalDetail.sp_no || relatedApprovalSpNo),
            sp_name: approvalDetail.sp_name || '仓库采购申请',
            template_id: approvalDetail.template_id || '',
          }];
          console.log(`[审批构建] 关联审批单详情: sp_name=${relatedItems[0].sp_name}, template_id=${relatedItems[0].template_id}`);
        }
      } catch (detailErr) {
        console.warn(`[审批构建] 获取采购审批单详情失败: ${detailErr.message}，使用默认值`);
      }
      contents.push({
        control: 'RelatedApproval',
        id: relatedControlId,
        value: { related_approval: relatedItems },
      });
      console.log(`[审批构建] 填充关联审批单(id=${relatedControlId}): sp_no=${relatedApprovalSpNo}`);
    } else {
      console.warn('[审批构建] 未找到关联审批单控件，跳过填充。请在企微配置页配置 related_approval 控件ID');
    }
  }

  // 构建摘要列表（审批卡片上显示的摘要）
  // 采购审批：事由 + 申购部门
  // 报销审批：付款事由 + 付款金额 + 付款方式（与食材采购费用报销对齐）
  const summaryList = [];
  if (useReceived) {
    // 报销模式：对齐食材采购费用报销格式
    summaryList.push({ summary_info: [{ text: `付款事由：${reason}`, lang: 'zh_CN' }] });
    summaryList.push({ summary_info: [{ text: `付款金额：¥${toNum(amount).toFixed(2)}`, lang: 'zh_CN' }] });
    summaryList.push({ summary_info: [{ text: `付款方式：${paymentLabel}`, lang: 'zh_CN' }] });
  } else {
    // 采购审批模式
    summaryList.push({ summary_info: [{ text: reason, lang: 'zh_CN' }] });
    if (fullDeptList) {
      summaryList.push({ summary_info: [{ text: `申购部门：${fullDeptList}`, lang: 'zh_CN' }] });
    }
  }

  // ================= 必填控件兜底填充 =================
  // 检查模板中所有 requiredControls 是否已出现在 contents 中
  // 若缺失则根据控件类型填充一个默认值
  const filledIds = new Set(contents.map(c => c.id));
  // creatorUserid 必须使用当前登录用户的企微ID，不再回退到配置的 applicant_userid
  // 接口层已校验，此处仅做非空保护
  const effectiveCreatorUserid = String(creatorUserid || '');
  if (!effectiveCreatorUserid) {
    console.warn('[审批构建] creatorUserid 为空，请确保接口层已校验当前用户绑定企微账号');
  }

  if (requiredControls && requiredControls.size > 0) {
    for (const ctrlId of requiredControls) {
      if (filledIds.has(ctrlId)) continue;
      const ctrlType = controlTypeMap?.[ctrlId];
      const ctrlTitle = controlTitles?.[ctrlId] || '';
      console.log(`[审批构建] 自动填充缺失必填控件: id=${ctrlId}, type=${ctrlType}, title=${ctrlTitle}`);

      switch (ctrlType) {
        case 'Text':
          contents.push({ control: 'Text', id: ctrlId, value: { text: '' } });
          break;
        case 'Textarea':
          contents.push({ control: 'Textarea', id: ctrlId, value: { text: '' } });
          break;
        case 'Money':
          contents.push({ control: 'Money', id: ctrlId, value: { new_money: '0.00' } });
          break;
        case 'Date':
        case 'DateRange':
          contents.push({ control: ctrlType, id: ctrlId, value: { date: new Date().getTime(), type: ctrlType === 'DateRange' ? 'duration' : 'day' } });
          break;
        case 'Number':
          contents.push({ control: 'Number', id: ctrlId, value: { new_number: '0' } });
          break;
        case 'Contact': {
          // 兜底：所有必填Contact控件都填充
          const isDeptCtrl = effectiveDeptId && ctrlId === effectiveDeptId;
          const fbMode = contactModes?.[ctrlId]?.mode || '';
          const fbIsUserMode = fbMode === 'user';
          if (!fbIsUserMode && isDeptCtrl && selectedBeforeFallback && selectedBeforeFallback.length > 0) {
            // 部门控件：用 departments 格式
            contents.push({
              control: 'Contact',
              id: ctrlId,
              value: {
                departments: selectedBeforeFallback.map(s => ({ openapi_id: String(s.id), name: s.name })),
              },
            });
            console.log(`[审批构建] 兜底必填department Contact(id=${ctrlId}, mode=${fbMode || 'department'}): departments=${JSON.stringify(selectedBeforeFallback)}`);
          } else {
            // 成员模式或无部门数据：用 members 格式（申请人userid）
            contents.push({
              control: 'Contact',
              id: ctrlId,
              value: {
                members: effectiveCreatorUserid
                  ? [{ userid: effectiveCreatorUserid, name: '申请人' }]
                  : [],
              },
            });
            console.log(`[审批构建] 兜底必填Contact(id=${ctrlId}, mode=${fbMode || 'user'}, title=${ctrlTitle}): 申请人=${effectiveCreatorUserid || '空'}`);
          }
          break;
        }
        case 'Selector': {
          const opts = selectorOptionsMap?.[ctrlId] || [];
          if (opts.length > 0) {
            contents.push({
              control: 'Selector',
              id: ctrlId,
              value: { selector: { type: 'single', options: [{ key: opts[0].key, value: [{ text: opts[0].text, lang: 'zh_CN' }] }] } },
            });
          }
          break;
        }
        case 'MultiSelector': {
          const opts = selectorOptionsMap?.[ctrlId] || [];
          if (opts.length > 0) {
            contents.push({
              control: 'MultiSelector',
              id: ctrlId,
              value: {
                options: opts.slice(0, 1).map(o => ({ key: o.key, value: [{ text: o.text, lang: 'zh_CN' }] })),
              },
            });
          }
          break;
        }
        case 'File':
          contents.push({ control: 'File', id: ctrlId, value: { files: [] } });
          break;
        case 'Table':
          contents.push({ control: 'Table', id: ctrlId, value: { children: [] } });
          break;
        case 'Tips':
          break;
        default:
          console.warn(`[审批构建] 未知必填控件类型 type=${ctrlType}, id=${ctrlId}`);
      }
      filledIds.add(ctrlId);
    }
  }

  // ================= 提交前诊断日志 =================
  const contentsDiag = contents.map(c => ({ id: c.id, control: c.control, valueKeys: Object.keys(c.value || {}) }));
  const missingReq = [];
  if (requiredControls) {
    for (const rid of requiredControls) {
      if (!contents.find(c => c.id === rid)) {
        missingReq.push(rid);
      }
    }
  }
  console.log(`[审批构建-诊断] 最终contents=${JSON.stringify(contentsDiag)}`);
  console.log(`[审批构建-诊断] 必填控件=[${Array.from(requiredControls || []).join(',')}], 缺失=[${missingReq.join(',')}]`);
  if (effectiveDeptId) {
    const deptInContents = contents.find(c => c.id === effectiveDeptId);
    console.log(`[审批构建-诊断] 部门Contact(id=${effectiveDeptId}, title=${controlTitles?.[effectiveDeptId] || ''}) 是否已存在: ${!!deptInContents}`, deptInContents ? JSON.stringify(deptInContents.value) : '');
  }

  const applyData = {
    creator_userid: effectiveCreatorUserid,
    // 模板ID优先级：显式传入 templateIdOverride > prepayMode 的 template_id_override > 仓库审批模板
    template_id: templateIdOverride
      || (options.prepayMode && options.template_id_override)
      || String(config.warehouse_approval_template_id),
    use_template_approver: 1,
    apply_data: { contents },
    summary_list: summaryList,
  };
  
  console.log(`[企微] 构建审批数据完成: useReceived=${useReceived}, contents=${contents.length}, summary=${summaryList.length}`);
  return applyData;
}

// 发起仓库报销审批（全员确认后 / 重新发起 复用）
// 与食材采购报销不同：
//   - 申请人 = 当前登录用户（creatorUserid），而非配置中的固定 applicant_userid
//   - 收款人 = 申请人自己（取企微真实姓名），而非配置中的固定 payee_name
//   - 模板使用费用报销模板（approval_template_id）+ 字段映射（approval_field_mapping）
async function submitWarehouseReimbursement(row, items, creatorUserid) {
  const config = await getWecomConfig();
  // 报销走费用报销模板，校验 approval_template_id（不再要求 warehouse_approval_template_id 和 applicant_userid）
  if (!config || !config.corp_id || !config.app_secret || !config.approval_template_id) {
    throw new Error('请先完成企微费用报销配置（费用报销模板ID approval_template_id）');
  }
  if (!creatorUserid) {
    throw new Error('未获取到当前登录用户的企微userid，无法发起报销');
  }
  const approvalTemplateId = String(config.approval_template_id);
  const fieldMapping = parseFieldMapping(config.approval_field_mapping);
  const { controlTypeMap, selectorOptionsMap, requiredControls, controlTitles, contactModes } = await fetchWarehouseTemplateControlTypes(config, false, approvalTemplateId);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // 付款事由：对齐采购申请事由格式，如"8月2日仓库采购单，实际入库¥414.41"
  // 日期使用采购单创建时间，而非报销提交时间
  const orderDate = new Date(row.created_at || row.apply_time || now);
  const fullAmount = computeNetAmount(row);
  const monthDayStr = `${orderDate.getMonth() + 1}月${orderDate.getDate()}日`;
  // 预付款少付尾款报销：仅报销差额（实际 - 预付）
  const isPrepayTail = row.purchase_type === 'prepay' && row.writeoff_status === 'manual';
  const reimburseAmount = isPrepayTail
    ? Math.max(0, fullAmount - toNum(row.prepay_amount))
    : fullAmount;
  const reason = isPrepayTail
    ? `${monthDayStr}仓库采购预付尾款，实际入库¥${fullAmount.toFixed(2)}，已预付¥${toNum(row.prepay_amount).toFixed(2)}，尾款¥${reimburseAmount.toFixed(2)}`
    : `${monthDayStr}仓库采购单，实际入库¥${reimburseAmount.toFixed(2)}`;

  // 收款人 = 申请人自己，取企微真实姓名
  let payeeName = creatorUserid;
  try {
    const realName = await getWecomUserName(creatorUserid);
    if (realName) payeeName = realName;
  } catch (e) {
    console.warn('[仓库报销] 获取申请人姓名失败，回退使用userid作为收款人:', e.message);
  }

  // 确保 PDF 存在（确认单 PDF）
  const pdfPath = path.join(PDF_DIR, `warehouse_${row.id}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    try { await generateWarehousePDF(row.id); } catch (e) { console.error('生成PDF失败:', e.message); }
  }

  const applyData = await buildWarehouseApplyData(config, fieldMapping, controlTypeMap, selectorOptionsMap, {
    date: dateStr,
    amount: reimburseAmount,
    reason,
    items,
    useReceived: true,
    pdfPath,
    rowId: row.id,
    creatorUserid,
    payeeName,
    relatedApprovalSpNo: row.approval_sp_no || null, // 关联采购审批单号
    requiredControls,
    controlTitles,
    contactModes,
    templateIdOverride: approvalTemplateId,
  });
  const spNo = await submitApproval(config, applyData);
  return spNo;
}

// ================================================
// generatePurchaseApplyPDF —— 仓库采购申请单 PDF
// 提交审批时生成，格式参考食材采购确认单
// 每个物资行下方显示采购理由（如有）
// ================================================
async function generatePurchaseApplyPDF(purchaseId) {
  const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [purchaseId]);
  if (rows.length === 0) throw new Error('采购单不存在');
  const row = rows[0];

  const [itemRows] = await pool.query(
    'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
    [purchaseId]
  );

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const pdfPath = path.join(PDF_DIR, `warehouse_apply_${purchaseId}.pdf`);
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);

  const chineseFont = findChineseFont();
  const chineseBoldFont = findChineseBoldFont();
  const hasChineseFont = !!chineseFont;
  if (hasChineseFont) {
    doc.registerFont('Chinese-Regular', chineseFont);
    doc.registerFont('Chinese-Bold', chineseBoldFont || chineseFont);
  }

  const regFont = hasChineseFont ? 'Chinese-Regular' : 'Helvetica';
  const boldFont = hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold';

  // 标题（参考食材采购：18号字，居中加粗）
  doc.fontSize(18).font(boldFont).text('仓库采购申请单', { align: 'center' });
  doc.moveDown(0.5);

  // 头部信息（9号字）
  doc.fontSize(9).font(regFont);
  const amountLabel = toNum(row.total_amount);
  const whNames = Array.from(new Set(itemRows.map(i => i.warehouse_name).filter(Boolean)));
  const statusText = row.status === 'pending_approval' ? '审批中'
    : row.status === 'rejected' ? '已驳回'
    : row.status === 'approved' ? '审批通过'
    : row.status;
  doc.text(`采购单号：${row.purchase_no || '-'}    仓库：${whNames.join('、') || '-'}    供应商：${row.supplier_name || '-'}`);
  doc.moveDown(0.3);
  doc.text(`申请金额：¥${amountLabel.toFixed(2)}    状态：${statusText}`);
  doc.moveDown(0.5);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const tableX = doc.page.margins.left;
  const tableWidth = pageWidth;

  // 按仓库分组
  const groupedItems = {};
  for (const item of itemRows) {
    const whName = item.warehouse_name || '未指定仓库';
    if (!groupedItems[whName]) groupedItems[whName] = [];
    groupedItems[whName].push(item);
  }

  // 表头与列宽（物资名称/单价单位/数量/单位/当前库存/金额/理由）
  const headers = ['物资名称', '单价/单位', '数量', '单位', '当前库存', '金额', '理由'];
  const colWidths = [
    tableWidth * 0.26,
    tableWidth * 0.12,
    tableWidth * 0.06,
    tableWidth * 0.06,
    tableWidth * 0.09,
    tableWidth * 0.13,
    tableWidth * 0.25,
  ];
  const rowHeight = 18;

  function checkPageBreak(y, extraHeight = 0) {
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    if (y + extraHeight > pageBottom) {
      doc.addPage();
      return doc.page.margins.top;
    }
    return y;
  }

  // 截断文本以适应列宽，防止溢出重叠
  function truncateText(text, maxWidth, fontSize) {
    doc.fontSize(fontSize);
    const str = String(text ?? '');
    if (doc.widthOfString(str) <= maxWidth) return str;
    // 逐步截断直到能放下（含省略号）
    let lo = 0, hi = str.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (doc.widthOfString(str.substring(0, mid) + '…') <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return str.substring(0, lo) + '…';
  }

  function drawTableRow(y, cells, isHeader = false) {
    const fontSize = isHeader ? 9 : 8;
    doc.font(isHeader ? boldFont : regFont).fontSize(fontSize);
    let x = tableX;
    for (let i = 0; i < cells.length; i++) {
      const text = truncateText(cells[i], colWidths[i] - 6, fontSize);
      const align = i === 0 ? 'left' : (i === cells.length - 1 ? 'right' : 'center');
      doc.text(text, x + 2, y + 2, { width: colWidths[i] - 4, align, lineBreak: false });
      x += colWidths[i];
    }
    return rowHeight;
  }

  // 标题"采购明细"
  let currentY = doc.y;
  currentY = checkPageBreak(currentY, rowHeight + 10);
  doc.fontSize(11).font(boldFont).text('采购明细', tableX, currentY, { lineBreak: false });
  currentY += rowHeight + 4;

  // 表头
  currentY = checkPageBreak(currentY, rowHeight);
  currentY += drawTableRow(currentY, headers, true);
  doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

  let grandTotal = 0;

  for (const [whName, items] of Object.entries(groupedItems)) {
    // 预估高度：仓库标题 + 每行高度
    let groupHeight = rowHeight;
    for (const item of items) {
      groupHeight += rowHeight;
    }
    groupHeight += 12 + 10; // 小计 + 间距
    currentY = checkPageBreak(currentY, groupHeight);

    // 仓库标题
    doc.fontSize(9).font(boldFont).text(`【${whName}】`, tableX, currentY + 1, { lineBreak: false });
    currentY += rowHeight;

    // 明细行
    let subtotal = 0;
    for (const item of items) {
      const price = toNum(item.requested_unit_price);
      const qty = toNum(item.requested_quantity);
      const amt = toNum(item.requested_amount);
      const unit = item.requested_unit || '';
      const reason = item.reason || '';
      const stockText = item.stock_at_purchase != null ? String(toNum(item.stock_at_purchase)) : '-';
      const cells = [
        item.item_name,
        `${price.toFixed(2)}/${unit}`,
        String(qty),
        unit,
        stockText,
        `¥${amt.toFixed(2)}`,
        reason,
      ];

      // 检查是否需要换页
      currentY = checkPageBreak(currentY, rowHeight);

      currentY += drawTableRow(currentY, cells);
      subtotal += amt;
    }
    grandTotal += subtotal;

    // 仓库小计
    currentY = checkPageBreak(currentY, 20);
    doc.fontSize(9).font(boldFont)
      .text(`小计：¥${subtotal.toFixed(2)}`, tableX, currentY + 2, { width: tableWidth, align: 'right', lineBreak: false });
    currentY += 12;
    doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();
    currentY += 8;
  }

  if (Object.keys(groupedItems).length === 0) {
    doc.fontSize(9).font(regFont).text('暂无采购明细', { align: 'center' });
  }

  // 合计
  currentY = checkPageBreak(currentY, 30);
  doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();
  doc.fontSize(11).font(boldFont)
    .text(`合计金额：¥${grandTotal.toFixed(2)}`, tableX, currentY + 5, { width: tableWidth, align: 'right', lineBreak: false });
  currentY += 25;

  // 生成时间
  currentY = checkPageBreak(currentY, 15);
  doc.fontSize(7).font(regFont)
    .text(`生成时间：${new Date().toLocaleString('zh-CN')}`, tableX, currentY, { width: tableWidth, align: 'right', lineBreak: false });

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(pdfPath));
    writeStream.on('error', reject);
  });

  console.log(`[采购申请PDF] 生成成功: ${pdfPath}`);
  return pdfPath;
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

  // 入库时间：从 stock_movements 派生（最近一次收货入库的最早时间），与订单详情、出入库记录页同源
  // 必须限定 movement_type='inbound'：即采即用物资收货时同表还会写入一条 expense（自动出库）流水
  const [receivedRows] = await pool.query(
    `SELECT MIN(created_at) AS received_at FROM stock_movements
     WHERE related_type = 'purchase' AND related_id = ? AND movement_type = 'inbound'`,
    [purchaseId]
  );
  const receivedAt = receivedRows[0]?.received_at || null;
  const receivedAtText = receivedAt
    ? (() => {
        const d = new Date(receivedAt);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })()
    : '-';

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
  const amountLabel = computeNetAmount(row);
  // 汇总涉及仓库
  const pdfWarehouseNames = Array.from(new Set(itemRows.map(i => i.warehouse_name).filter(Boolean)));
  doc.text(`采购单号：${row.purchase_no || '-'}    仓库：${pdfWarehouseNames.join('、') || '-'}    供应商：${row.supplier_name || '-'}`);
  doc.moveDown(0.3);
  doc.text(`金额：¥${amountLabel.toFixed(2)}    状态：${statusLabel}    入库时间：${receivedAtText}`);
  doc.moveDown(0.5);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const tableX = doc.page.margins.left;
  const tableWidth = pageWidth;

  // 按仓库分组
  const groupedItems = {};
  for (const item of itemRows) {
    const whName = item.warehouse_name || '未指定仓库';
    if (!groupedItems[whName]) groupedItems[whName] = [];
    groupedItems[whName].push(item);
  }

  // 表头与列宽（按任务要求）
  const headers = ['物资名称', '单价/单位', '数量', '单位', '金额'];
  const colWidths = [
    tableWidth * 0.32,
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

  // 部门签字区：支持新结构（按仓库维度）和旧结构（按部门维度）
  function drawDepartmentSignature(y, whName) {
    const sigTop = y;
    const sigWidth = tableWidth;
    doc.fontSize(7).font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica');

    // 获取 user_departments（按仓库维度的结构）
    const userDepartments = parseJsonField(row.user_departments) || {};

    // 1. 从新结构找确认人（按仓库维度）
    let whConfirmedInfo = null;
    
    // 先尝试通过 whKey（仓库id或名称）匹配
    for (const [whKey, task] of Object.entries(userDepartments)) {
      if (!task || !Array.isArray(task.confirmers)) continue;
      // 匹配仓库名称或ID
      const whId = task.wh_id;
      if (task.wh_name === whName || whKey === whName || 
          (itemRows.some(i => i.warehouse_name === whName && i.warehouse_id === whKey))) {
        // 找到该仓库的确认人列表
        if (task.confirmed && task.confirmed_by) {
          // 已确认，获取确认人的签字
          const confInfo = userConfirmations[task.confirmed_by];
          if (confInfo) {
            whConfirmedInfo = {
              confirmed_by: task.confirmed_by_name || confInfo.confirmed_by,
              confirmed_at: task.confirmed_at || confInfo.confirmed_at,
              signature_data: confInfo.signature_data,
            };
          } else {
            whConfirmedInfo = {
              confirmed_by: task.confirmed_by_name || task.confirmed_by,
              confirmed_at: task.confirmed_at,
              signature_data: null,
            };
          }
        } else if (task.confirmers.length > 0) {
          // 未确认，但有确认人 - 显示确认人列表
          const confNames = [];
          for (const uid of task.confirmers) {
            const conf = userConfirmations[uid];
            if (conf) {
              confNames.push(conf.confirmed_by || uid);
            } else {
              confNames.push(uid);
            }
          }
          whConfirmedInfo = {
            confirmed_by: confNames.join('、'),
            confirmed_at: '待确认',
            signature_data: null,
            pending: true,
          };
        }
        break;
      }
    }

    // 2. 回退：尝试旧结构（按部门维度）
    if (!whConfirmedInfo) {
      const whItems = groupedItems[whName] || [];
      const deptNames = Array.from(new Set(whItems.map(i => i.department_name).filter(Boolean)));
      for (const dn of deptNames) {
        const deptConf = Object.entries(userConfirmations).find(([, conf]) =>
          conf && conf.departments && conf.departments.includes(dn)
        );
        if (deptConf) {
          const info = deptConf[1];
          whConfirmedInfo = {
            confirmed_by: info.confirmed_by || '-',
            confirmed_at: info.confirmed_at || '-',
            signature_data: info.signature_data,
          };
          break;
        }
      }
    }

    if (whConfirmedInfo) {
      const statusText = whConfirmedInfo.pending ? `待确认` : '';
      const infoText = `确认人：${whConfirmedInfo.confirmed_by || '-'}${statusText ? '    ' + statusText : '    确认时间：' + (whConfirmedInfo.confirmed_at || '-')}`;
      doc.text(infoText, tableX + 2, sigTop + 2, { width: sigWidth - 4, align: 'left' });
      if (whConfirmedInfo.signature_data) {
        try {
          const base64Data = whConfirmedInfo.signature_data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          doc.image(buffer, tableX + 2, sigTop + 12, {
            width: sigWidth - 4, height: signatureHeight - 14,
            fit: [sigWidth - 4, signatureHeight - 14],
          });
        } catch (e) {
          console.error(`[仓库PDF] 签名图片处理失败，wh=${whName}:`, e.message);
        }
      }
    } else {
      // 无确认人配置
      doc.text('该仓库暂无确认人配置', tableX + 2, sigTop + 8);
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

  for (const [whName, items] of Object.entries(groupedItems)) {
    const deptNeededHeight = fixedRowHeight + items.length * fixedRowHeight + 14 + signatureHeight + 15;
    currentY = checkPageBreak(currentY, deptNeededHeight);

    // 仓库标题
    doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold').text(`【${whName}】`, tableX, currentY + 1);
    currentY += fixedRowHeight;

    // 明细行（优先使用实收数据，无则用申请数据）
    doc.font(hasChineseFont ? 'Chinese-Regular' : 'Helvetica').fontSize(7);
    let subtotal = 0;
    for (const item of items) {
      const notArrived = item.not_arrived ? Number(item.not_arrived) === 1 : false;
      const hasReceived = toNum(item.received_amount) > 0 || toNum(item.received_quantity) > 0;
      const price = hasReceived ? toNum(item.received_unit_price) : toNum(item.requested_unit_price);
      const qty = hasReceived ? toNum(item.received_quantity) : toNum(item.requested_quantity);
      const amt = hasReceived ? toNum(item.received_amount) : toNum(item.requested_amount);
      const unit = hasReceived ? (item.received_unit || item.requested_unit || '') : (item.requested_unit || '');
      const itemName = notArrived ? `${item.item_name}（未到货）` : item.item_name;
      const qtyDisplay = notArrived ? '0' : String(qty);
      const amtDisplay = notArrived ? '¥0.00' : `¥${amt.toFixed(2)}`;
      const cells = [
        itemName,
        `${price.toFixed(2)}/${unit}`,
        qtyDisplay,
        unit,
        amtDisplay,
      ];
      currentY += drawTableRow(currentY, cells);
      if (!notArrived) subtotal += amt;
    }
    grandTotal += subtotal;

    // 部门小计
    doc.fontSize(7.5).font(hasChineseFont ? 'Chinese-Bold' : 'Helvetica-Bold')
      .text(`小计：¥${subtotal.toFixed(2)}`, tableX, currentY, { width: tableWidth, align: 'right' });
    currentY += 10;
    doc.moveTo(tableX, currentY).lineTo(tableX + tableWidth, currentY).stroke();

    // 仓库签字区
    currentY += drawDepartmentSignature(currentY, whName);
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
    const { status, warehouse_id, created_by, page = 1, page_size = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, parseInt(page_size, 10) || 20);
    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const params = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (warehouse_id) { conditions.push('warehouse_id = ?'); params.push(warehouse_id); }
    // 角色判断使用 roles 数组（支持多角色用户）
    const isAdmin = Array.isArray(req.user?.roles) && req.user.roles.includes('admin');
    if (isAdmin) {
      // 管理员可按采购员筛选；未传 created_by 则返回全部
      if (created_by) { conditions.push('created_by = ?'); params.push(created_by); }
    } else {
      // 非管理员强制只能看自己的单，忽略前端传来的 created_by（防越权）
      conditions.push('created_by = ?');
      params.push(req.user.id);
    }

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

// 1.5 GET /purchasers — 采购员筛选列表（实际创建过采购单的用户），需在 /:id 之前注册
router.get('/purchasers', requireAuth, async (req, res) => {
  try {
    const isAdmin = Array.isArray(req.user?.roles) && req.user.roles.includes('admin');
    if (!isAdmin) {
      return res.status(403).json({ error: '无权限访问' });
    }
    // 只返回实际创建过采购单的用户（含历史离职人员，保证能按人筛选历史订单）
    const [rows] = await pool.query(`
      SELECT wp.created_by AS id,
             COALESCE(MAX(NULLIF(u.name, '')), MAX(NULLIF(wp.created_by_name, '')), wp.created_by) AS name
      FROM warehouse_purchases wp
      LEFT JOIN users u ON u.id = wp.created_by
      WHERE wp.created_by IS NOT NULL AND wp.created_by != ''
      GROUP BY wp.created_by
      ORDER BY name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('获取采购员筛选列表失败:', err);
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

    // 判断是否为新结构（按仓库维度）
    const isNewStructure = Object.values(userDepartments).some(v => v && Array.isArray(v.confirmers));

    let myWarehouseNames = [];
    let myItems = [];
    let totalTasks = 0;
    let confirmedTasks = 0;
    const allConfirmations = [];

    if (isNewStructure) {
      // 新结构：找出当前用户负责的仓库任务
      const myTasks = [];
      for (const [whKey, task] of Object.entries(userDepartments)) {
        if (task && Array.isArray(task.confirmers)) {
          totalTasks++;
          if (task.confirmed) confirmedTasks++;
          if (task.confirmers.includes(user)) {
            myTasks.push({ whKey, task });
            if (task.wh_name) myWarehouseNames.push(task.wh_name);
          }
          allConfirmations.push({
            userid: whKey,
            name: task.wh_name,
            confirmed: !!task.confirmed,
            confirmed_at: task.confirmed_at,
          });
        }
      }
      if (myTasks.length === 0) {
        return res.status(403).json({ error: '您不是本采购单的指定确认人' });
      }
      // 该用户负责的仓库下的物资
      const myWhIds = myTasks.map(t => t.task.wh_id).filter(Boolean);
      const myWhNames = myTasks.map(t => t.task.wh_name).filter(Boolean);
      const [itemRows] = await pool.query(
        'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
        [id]
      );
      myItems = itemRows
        .filter(item => (item.warehouse_id && myWhIds.includes(item.warehouse_id)) || myWhNames.includes(item.warehouse_name))
        .map(normalizeItemRow);
    } else {
      // 兼容旧结构
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
      myItems = itemRows
        .filter(item => myDeptNames.includes(item.department_name))
        .map(normalizeItemRow);
      const allConfPromises = Object.entries(userConfirmations).map(async ([userid, info]) => ({
        userid,
        name: await getWecomUserName(userid),
        confirmed: !!(info && info.confirmed),
        confirmed_at: info && info.confirmed_at,
        confirmed_by: info && info.confirmed_by,
      }));
      allConfirmations.push(...await Promise.all(allConfPromises));
      totalTasks = Object.keys(userDepartments).length;
      confirmedTasks = Object.values(userConfirmations).filter(c => c && c.confirmed).length;
    }

    const myTotal = myItems.reduce((s, i) => {
      if (i.not_arrived) return s; // 未到货物材不计入总金额
      const amt = toNum(i.received_amount) > 0 ? toNum(i.received_amount) : toNum(i.requested_amount);
      return s + amt;
    }, 0);

    const myConfirmation = userConfirmations[user] || null;
    const userName = await getWecomUserName(user);

    res.json({
      id: row.id,
      purchase_no: row.purchase_no,
      warehouse_name: row.warehouse_name,
      status: row.status,
      total_amount: toNum(row.total_amount),
      actual_amount: toNum(row.actual_amount),
      user,
      user_name: userName,
      my_departments: myWarehouseNames,
      my_items: myItems,
      my_total: myTotal,
      my_confirmation: myConfirmation,
      all_confirmations: allConfirmations,
      total_users: totalTasks,
      confirmed_users: confirmedTasks,
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

    const userDepartments = parseJsonField(row.user_departments) || {}; // 按仓库维度组织
    let userConfirmations = parseJsonField(row.user_confirmations) || {}; // userid -> { confirmed, ... }

    // 新结构：user_departments = { whKey: { wh_id, wh_name, confirmers: [userid...], response_codes: {userid: code}, confirmed, confirmed_by, confirmed_at } }
    // 兼容旧结构：user_departments = { userid: { departments: [...], response_code } }

    // 判断是否为新结构（按仓库维度）
    const isNewStructure = Object.values(userDepartments).some(v => v && Array.isArray(v.confirmers));
    // 找出当前用户负责的仓库任务（新结构）
    let myWarehouseTasks = [];
    let responseCode = null;
    if (isNewStructure) {
      for (const [whKey, task] of Object.entries(userDepartments)) {
        if (task && Array.isArray(task.confirmers) && task.confirmers.includes(user) && !task.confirmed) {
          myWarehouseTasks.push({ whKey, task });
          if (!responseCode && task.response_codes && task.response_codes[user]) {
            responseCode = task.response_codes[user];
          }
        }
      }
      if (myWarehouseTasks.length === 0) {
        await connection.rollback();
        return res.status(403).json({ error: '您不是本采购单的指定确认人，或您负责的仓库已确认' });
      }
    } else {
      // 兼容旧结构
      const userDeptData = userDepartments[user];
      responseCode = (userDeptData && userDeptData.response_code) || null;
      if (!userDeptData) {
        await connection.rollback();
        return res.status(403).json({ error: '您不是本采购单的指定确认人' });
      }
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
      signature_data,
    };

    // 新结构：标记该用户负责的所有未确认仓库为已确认（任一人确认即算完成）
    if (isNewStructure) {
      for (const { whKey, task } of myWarehouseTasks) {
        if (!task.confirmed) {
          task.confirmed = true;
          task.confirmed_by = user;
          task.confirmed_by_name = realName;
          task.confirmed_at = now;
          userDepartments[whKey] = task;
        }
      }
      await connection.query(
        'UPDATE warehouse_purchases SET user_confirmations = ?, user_departments = ? WHERE id = ?',
        [JSON.stringify(userConfirmations), JSON.stringify(userDepartments), id]
      );
    } else {
      await connection.query(
        'UPDATE warehouse_purchases SET user_confirmations = ? WHERE id = ?',
        [JSON.stringify(userConfirmations), id]
      );
    }

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

    // 判断是否全部确认完成
    let allConfirmed = false;
    let totalTasks = 0;
    let confirmedTasks = 0;
    if (isNewStructure) {
      const allTasks = Object.values(userDepartments).filter(v => v && Array.isArray(v.confirmers));
      totalTasks = allTasks.length;
      confirmedTasks = allTasks.filter(t => t.confirmed).length;
      allConfirmed = totalTasks > 0 && confirmedTasks === totalTasks;
    } else {
      const totalUsers = Object.keys(userDepartments).length;
      const confirmedUsers = Object.values(userConfirmations).filter(c => c && c.confirmed).length;
      totalTasks = totalUsers;
      confirmedTasks = confirmedUsers;
      allConfirmed = totalUsers > 0 && confirmedUsers === totalUsers;
    }

    // 计算已确认的部门/仓库名称（用于前端显示）
    let confirmedDeptNames = [];
    if (isNewStructure) {
      confirmedDeptNames = myWarehouseTasks.map(t => t.task.wh_name).filter(Boolean);
    } else {
      const userDeptData = userDepartments[user];
      if (userDeptData && Array.isArray(userDeptData.departments)) {
        confirmedDeptNames = userDeptData.departments;
      }
    }

    if (allConfirmed) {
      // 1. 生成 PDF（确认单）+ 设置 confirmed_at 确认完成时间
      let pdfUrl = row.pdf_url;
      try {
        await generateWarehousePDF(id);
        pdfUrl = `/api/warehouse-purchases/${id}/pdf?type=confirm`;
        await connection.query('UPDATE warehouse_purchases SET pdf_url = ?, status = ?, confirmed_at = NOW() WHERE id = ?', [pdfUrl, 'confirmed', id]);
      } catch (pdfErr) {
        console.error('仓库采购PDF生成失败:', pdfErr.message);
        await connection.query('UPDATE warehouse_purchases SET status = ?, confirmed_at = NOW() WHERE id = ?', ['confirmed', id]);
      }

      // 2. 根据 purchase_type 分流
      if (row.purchase_type === 'monthly') {
        // 月结采购：不发起报销，标记待月结付款（confirmed_at 已在上一步设置）
        await connection.query(
          'UPDATE warehouse_purchases SET monthly_pending = 1 WHERE id = ?',
          [id]
        );
        await connection.commit();
        res.json({
          success: true,
          message: '确认成功，月结采购单已入账待付款',
          confirmed_at: now,
          confirmed_departments: confirmedDeptNames,
          progress: { confirmed_users: confirmedTasks, total_users: totalTasks, all_confirmed: true },
          card_updated: cardUpdated,
          card_error: cardError,
        });
        return;
      }

      if (row.purchase_type === 'prepay') {
        // 预付款采购：确认后若已回填凭证（prepay_status='paid'），自动核销；否则等待回填凭证后核销
        // 预付款流程：确认 → 核销 → 尾款报销
        const writeoffDone = await autoWriteoffPrepayIfReady(row, connection);
        await connection.commit();
        res.json({
          success: true,
          message: writeoffDone ? '确认成功，预付款已自动核销完成' : '确认成功，预付款采购单待核销处理',
          confirmed_at: now,
          confirmed_departments: confirmedDeptNames,
          progress: { confirmed_users: confirmedTasks, total_users: totalTasks, all_confirmed: true },
          card_updated: cardUpdated,
          card_error: cardError,
        });
        return;
      }

      // 现购采购：发起报销审批
      let reimbursementSpNo = null;
      try {
        const [itemRows] = await pool.query(
          `SELECT wpi.*, d.name as department_name
           FROM warehouse_purchase_items wpi
           LEFT JOIN warehouses w ON wpi.warehouse_id = w.id
           LEFT JOIN departments d ON w.department_id = d.id
           WHERE wpi.purchase_id = ? ORDER BY wpi.sort_order ASC, wpi.id ASC`,
          [id]
        );
        const freshRow = { ...row, pdf_url: pdfUrl };
        reimbursementSpNo = await submitWarehouseReimbursement(freshRow, itemRows, req.user?.wecom_userid);
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
        confirmed_departments: confirmedDeptNames,
        progress: { confirmed_users: confirmedTasks, total_users: totalTasks, all_confirmed: true },
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
      confirmed_departments: confirmedDeptNames,
      progress: { confirmed_users: confirmedTasks, total_users: totalTasks, all_confirmed: false },
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
    const { items = [] } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '采购明细不能为空' });
    }

    // 校验每行必须有仓库
    for (let i = 0; i < items.length; i++) {
      if (!items[i].warehouse_id) {
        await connection.rollback();
        return res.status(400).json({ error: `第 ${i + 1} 行：请选择入库仓库` });
      }
    }

    // 批量查询仓库名称
    const whIds = Array.from(new Set(items.map(i => i.warehouse_id).filter(Boolean)));
    const [whRows] = await connection.query('SELECT id, name FROM warehouses WHERE id IN (?)', [whIds]);
    const whMap = {};
    for (const w of whRows) whMap[w.id] = w.name;

    const id = uuidv4();
    const purchaseNo = await generatePurchaseNo(connection);

    // 计算申请总金额（兼容 quantity/requested_quantity 两种字段名）
    let totalAmount = 0;
    for (const item of items) {
      const qty = toNum(item.quantity ?? item.requested_quantity);
      const price = toNum(item.unit_price ?? item.requested_unit_price);
      const amount = toNum(item.amount ?? item.requested_amount) > 0 ? toNum(item.amount ?? item.requested_amount) : (qty * price);
      totalAmount += amount;
    }

    const createdBy = (req.user && req.user.id) || null;
    const createdByName = (req.user && req.user.name) || null;

    const { purchase_type = 'normal', supplier_id = null, supplier_name = null, prepay_amount = 0 } = req.body;

    // 表头 warehouse_id 可空（兼容旧数据），取第一行的仓库作为表头冗余
    const headerWhId = items[0].warehouse_id || null;
    const headerWhName = whMap[headerWhId] || null;

    await connection.query(
      `INSERT INTO warehouse_purchases
       (id, purchase_no, warehouse_id, warehouse_name, status, total_amount, created_by, created_by_name,
        purchase_type, supplier_id, supplier_name, prepay_amount)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      [id, purchaseNo, headerWhId, headerWhName, totalAmount, createdBy, createdByName,
       purchase_type, supplier_id, supplier_name, prepay_amount]
    );

    // 写入明细（含行级仓库）
    let sortOrder = 0;
    for (const item of items) {
      const itemId = uuidv4();
      const qty = toNum(item.quantity ?? item.requested_quantity);
      const price = toNum(item.unit_price ?? item.requested_unit_price);
      const amount = toNum(item.amount ?? item.requested_amount) > 0 ? toNum(item.amount ?? item.requested_amount) : (qty * price);
      const itemWhId = item.warehouse_id || null;
      const itemWhName = item.warehouse_name || whMap[itemWhId] || null;
      // 采购人申报的当前库存（未填为 NULL）
      const stockAtPurchase = item.stock_at_purchase != null && item.stock_at_purchase !== '' && !isNaN(Number(item.stock_at_purchase))
        ? Number(item.stock_at_purchase) : null;
      await connection.query(
        `INSERT INTO warehouse_purchase_items
         (id, purchase_id, item_id, item_name, category_name, spec, department_id, department_name,
          warehouse_id, warehouse_name,
          requested_quantity, requested_unit, requested_unit_price, requested_amount, reason, sort_order,
          instant_use_override, stock_at_purchase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId, id,
          item.item_id || null,
          item.item_name || '',
          item.category_name || null,
          item.spec || null,
          item.department_id || null,
          item.department_name || null,
          itemWhId,
          itemWhName,
          qty,
          item.unit ?? item.requested_unit ?? '',
          price,
          amount,
          item.reason || null,
          sortOrder++,
          item.instant_use_override !== undefined ? item.instant_use_override : null,
          stockAtPurchase,
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
    // 入库时间：从 stock_movements 派生（最近一次收货入库的最早时间），与出入库记录页同源
    const [receivedRows] = await pool.query(
      `SELECT MIN(created_at) AS received_at FROM stock_movements
       WHERE related_type = 'purchase' AND related_id = ? AND movement_type = 'inbound'`,
      [id]
    );
    res.json({
      ...normalizePurchaseRow(rows[0]),
      received_at: receivedRows[0]?.received_at || null,
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
    const { items = [] } = req.body;

    const [rows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    if (rows[0].status !== 'draft' && rows[0].status !== 'rejected') {
      await connection.rollback();
      return res.status(400).json({ error: '只有草稿或驳回状态的采购单可以编辑' });
    }

    // 批量查询仓库名称
    const whIds = Array.from(new Set(items.map(i => i.warehouse_id).filter(Boolean)));
    let whMap = {};
    if (whIds.length > 0) {
      const [whRows] = await connection.query('SELECT id, name FROM warehouses WHERE id IN (?)', [whIds]);
      for (const w of whRows) whMap[w.id] = w.name;
    }

    // 先删后插更新明细
    await connection.query('DELETE FROM warehouse_purchase_items WHERE purchase_id = ?', [id]);

    let totalAmount = 0;
    let sortOrder = 0;
    for (const item of items) {
      const itemId = uuidv4();
      const qty = toNum(item.quantity ?? item.requested_quantity);
      const price = toNum(item.unit_price ?? item.requested_unit_price);
      const amount = toNum(item.amount ?? item.requested_amount) > 0 ? toNum(item.amount ?? item.requested_amount) : (qty * price);
      totalAmount += amount;
      const itemWhId = item.warehouse_id || null;
      const itemWhName = item.warehouse_name || whMap[itemWhId] || null;
      // 采购人申报的当前库存（未填为 NULL）
      const stockAtPurchase = item.stock_at_purchase != null && item.stock_at_purchase !== '' && !isNaN(Number(item.stock_at_purchase))
        ? Number(item.stock_at_purchase) : null;
      await connection.query(
        `INSERT INTO warehouse_purchase_items
         (id, purchase_id, item_id, item_name, category_name, spec, department_id, department_name,
          warehouse_id, warehouse_name,
          requested_quantity, requested_unit, requested_unit_price, requested_amount, reason, sort_order,
          instant_use_override, stock_at_purchase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId, id,
          item.item_id || null,
          item.item_name || '',
          item.category_name || null,
          item.spec || null,
          item.department_id || null,
          item.department_name || null,
          itemWhId,
          itemWhName,
          qty,
          item.unit ?? item.requested_unit ?? '',
          price,
          amount,
          item.reason || null,
          sortOrder++,
          item.instant_use_override !== undefined ? item.instant_use_override : null,
          stockAtPurchase,
        ]
      );
    }

    const { purchase_type, supplier_id, supplier_name, prepay_amount } = req.body;

    // 表头仓库取第一行
    const headerWhId = items.length > 0 ? (items[0].warehouse_id || null) : rows[0].warehouse_id;
    const headerWhName = items.length > 0 ? (items[0].warehouse_name || whMap[items[0].warehouse_id] || null) : rows[0].warehouse_name;

    await connection.query(
      `UPDATE warehouse_purchases
       SET warehouse_id = ?, warehouse_name = ?, total_amount = ?,
           purchase_type = COALESCE(?, purchase_type),
           supplier_id = COALESCE(?, supplier_id),
           supplier_name = COALESCE(?, supplier_name),
           prepay_amount = COALESCE(?, prepay_amount)
       WHERE id = ?`,
      [headerWhId, headerWhName, totalAmount,
       purchase_type, supplier_id, supplier_name, prepay_amount, id]
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
  const startTime = Date.now();
  console.log(`[提交审批] 开始处理: ${req.params.id}`);
  
  // 设置请求超时（30秒）
  const timeout = setTimeout(() => {
    res.status(504).json({ error: '请求超时，请稍后重试' });
  }, 30000);

  try {
    const { id } = req.params;
    console.log(`[提交审批] 步骤1: 验证采购单`);
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      clearTimeout(timeout);
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (row.status !== 'draft' && row.status !== 'rejected') {
      clearTimeout(timeout);
      return res.status(400).json({ error: '只有草稿或驳回状态的采购单可以提交审批' });
    }

    console.log(`[提交审批] 步骤2: 获取企微配置`);
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret || !config.warehouse_approval_template_id || !config.applicant_userid) {
      clearTimeout(timeout);
      return res.status(400).json({ error: '请先完成企微仓库审批配置（仓库审批模板ID和申请人用户ID）' });
    }

    // 校验当前用户是否绑定企微账号
    const currentWecomUserid = req.user?.wecom_userid;
    if (!currentWecomUserid) {
      clearTimeout(timeout);
      return res.status(400).json({ error: '当前用户未绑定企微账号，无法发起审批。请联系管理员在用户管理中绑定企微账号。' });
    }
    console.log(`[提交审批] 当前登录用户wecom_userid: ${currentWecomUserid}`);

    console.log(`[提交审批] 步骤3: 查询明细`);
    const [itemRows] = await pool.query(
      `SELECT wpi.*, d.name as department_name, d.wecom_dept_id
       FROM warehouse_purchase_items wpi
       LEFT JOIN warehouses w ON wpi.warehouse_id = w.id
       LEFT JOIN departments d ON d.id = COALESCE(wpi.department_id, w.department_id)
       WHERE wpi.purchase_id = ? ORDER BY wpi.sort_order ASC, wpi.id ASC`,
      [id]
    );
    console.log(`[提交审批] 明细条数: ${itemRows.length}, 含wecom_dept_id条数: ${itemRows.filter(i => i.wecom_dept_id).length}`);
    if (itemRows.length > 0) {
      console.log(`[提交审批] 首条明细: item=${itemRows[0].item_name}, dept_name=${itemRows[0].department_name}, wecom_dept_id=${itemRows[0].wecom_dept_id}`);
    }

    console.log(`[提交审批] 步骤4: 获取模板控件类型`);
    const fieldMapping = parseFieldMapping(config.warehouse_field_mapping);
    const { controlTypeMap, selectorOptionsMap, requiredControls, controlTitles, contactModes } = await fetchWarehouseTemplateControlTypes(config);
    console.log(`[提交审批] fieldMapping:`, JSON.stringify(fieldMapping));
    console.log(`[提交审批] controlTypeMap:`, JSON.stringify(controlTypeMap));

    console.log(`[提交审批] 步骤4.5: 生成采购申请PDF`);
    let applyPdfPath = null;
    try {
      applyPdfPath = await generatePurchaseApplyPDF(id);
      console.log(`[提交审批] PDF生成成功: ${applyPdfPath}`);
    } catch (pdfErr) {
      console.error(`[提交审批] PDF生成失败（不影响提交）:`, pdfErr.message);
    }

    console.log(`[提交审批] 步骤5: 构建审批数据`);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const monthDayStr = `${now.getMonth() + 1}月${now.getDate()}日`;
    const totalAmount = toNum(row.total_amount);

    // 构建事由：采购事由：8月1日采购单，预计费用¥30.00，详情请查阅附件
    // 预付款类型追加供应商和预付金额信息
    let reason = `采购事由：${monthDayStr}采购单，预计费用¥${totalAmount.toFixed(2)}`;
    if (row.purchase_type === 'prepay' && row.supplier_name) {
      reason += `，供应商：${row.supplier_name}`;
    }
    if (row.purchase_type === 'prepay' && row.prepay_amount && toNum(row.prepay_amount) > 0) {
      reason += `，预付金额：¥${toNum(row.prepay_amount).toFixed(2)}`;
    }
    reason += '，详情请查阅附件';

    const applyData = await buildWarehouseApplyData(config, fieldMapping, controlTypeMap, selectorOptionsMap, {
      date: dateStr,
      amount: toNum(row.total_amount),
      reason,
      items: itemRows,
      useReceived: false,
      pdfPath: applyPdfPath,
      pdfType: 'apply',
      rowId: id,
      creatorUserid: req.user?.wecom_userid,
      requiredControls,
      controlTitles,
      contactModes,
    });

    console.log(`[提交审批] 步骤6: 提交企微审批`);
    const spNo = await submitApproval(config, applyData);
    console.log(`[提交审批] 审批单号: ${spNo}`);

    console.log(`[提交审批] 步骤7: 更新数据库`);
    const applyPdfUrl = applyPdfPath ? `/api/warehouse-purchases/${id}/pdf?type=apply` : null;
    await pool.query(
      'UPDATE warehouse_purchases SET status = ?, approval_sp_no = ?, approval_status = ?, apply_pdf_path = ?, apply_pdf_url = ? WHERE id = ?',
      ['pending_approval', spNo, 'pending', applyPdfPath, applyPdfUrl, id]
    );

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    clearTimeout(timeout);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[提交审批] 完成，耗时: ${elapsed}秒`);
    res.json(normalizePurchaseRow(freshRows[0]));
  } catch (err) {
    clearTimeout(timeout);
    console.error('提交仓库采购审批失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 批量刷新仓库采购审批状态
// 入参: { status?: string }  可选，与列表筛选一致；不传则刷所有
// 串行调用企微 API（避免 45009 限流），单条失败不中断
// 按单据状态自动选择刷新哪个 sp_no:
//   - pending_approval / rejected → approval_sp_no  (refresh-approval 逻辑)
//   - reimbursing                  → reimbursement_sp_no (refresh-status 报销分支)
//   - confirming 无 sp_no          → 直接返回最新数据
//   - monthly 付款中               → monthly_payment_sp_no (reconciliation 逻辑)
//   - 预付款审批中                  → prepay_sp_no (refresh-prepay 逻辑)
//   - 终态（已报销/已收货/已确认等） → 跳过
// ============================================================
async function refreshWarehousePurchaseCore(row, config) {
  // 终态：不刷新
  const terminalStatuses = ['reimbursed', 'received', 'confirmed', 'approved', 'draft', 'rejected'];
  if (terminalStatuses.includes(row.status) && row.status !== 'rejected') {
    // rejected 需要刷新看是否已被审批（实际上 rejected 是终态，不需要刷 approval）
    return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: 'terminal status' };
  }

  // 已冻结（企微 6/7）：禁止自动回退，跳过所有自动刷新，等人工核对
  if (row.approval_status === 'frozen' || row.reimbursement_status === 'frozen' || row.prepay_status === 'frozen') {
    return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: 'approval frozen' };
  }

  if (!config || !config.corp_id || !config.app_secret) {
    return { ok: false, error: '请先完成企业微信应用配置' };
  }

  // 1) 采购审批单号（pending_approval / rejected）
  if (row.status === 'pending_approval' && row.approval_sp_no) {
    try {
      const detail = await getApprovalDetail(config, row.approval_sp_no);
      const spStatus = detail?.info?.sp_status ?? detail?.sp_status;
      const mapping = mapPurchaseApproval(spStatus);
      if (!mapping) {
        return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: `unsupported sp_status ${spStatus}` };
      }
      if (!isApplied(row, mapping.fields)) {
        await applyFields(pool, 'warehouse_purchases', row.id, mapping.fields);
      }
      if (mapping.alert) {
        await writeAlertLog(pool, {
          purchaseId: row.id,
          spNo: row.approval_sp_no,
          docType: 'warehouse_purchase_approval',
          spStatus: mapping.spStatus,
          message: mapping.message,
        });
      }
      const [fresh] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [row.id]);
      return { ok: true, data: normalizePurchaseRow(fresh[0]) };
    } catch (err) {
      return { ok: false, error: `刷新采购审批失败: ${err.message}` };
    }
  }

  // 2) 报销审批单号（reimbursing）
  if (row.status === 'reimbursing' && row.reimbursement_sp_no) {
    try {
      const detail = await getApprovalDetail(config, row.reimbursement_sp_no);
      const info = detail.info || {};
      const spStatus = info.sp_status;
      const mapping = mapReimbursement(spStatus, row);
      if (!mapping) {
        return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: `unsupported sp_status ${spStatus}` };
      }

      const fields = { ...mapping.fields };
      if (mapping.action === 'approve' && row.purchase_type === 'prepay' &&
          (row.writeoff_status === 'manual' || row.writeoff_status === 'reimbursing')) {
        fields.writeoff_status = 'auto';
      }
      if ((mapping.action === 'reject' || mapping.action === 'revoke') &&
          row.purchase_type === 'prepay' && row.writeoff_status === 'reimbursing') {
        fields.writeoff_status = 'manual';
      }

      if (!isApplied(row, fields)) {
        await applyFields(pool, 'warehouse_purchases', row.id, fields);
      }
      if (mapping.alert) {
        await writeAlertLog(pool, {
          purchaseId: row.id,
          spNo: row.reimbursement_sp_no,
          docType: 'warehouse_purchase_reimbursement',
          spStatus: mapping.spStatus,
          message: mapping.message,
        });
      }
      const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [row.id]);
      return { ok: true, data: normalizePurchaseRow(freshRows[0]) };
    } catch (err) {
      return { ok: false, error: `刷新报销审批失败: ${err.message}` };
    }
  }

  // 3) 预付款审批单号（pending_prepay 状态或 prepay_status=pending）
  if (row.prepay_sp_no && row.prepay_status === 'pending') {
    try {
      const detail = await getApprovalDetail(config, row.prepay_sp_no);
      const spStatus = detail?.info?.sp_status ?? detail?.sp_status;
      const mapping = mapPrepayApproval(spStatus);
      if (!mapping) {
        return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: `unsupported sp_status ${spStatus}` };
      }
      if (!isApplied(row, mapping.fields)) {
        await applyFields(pool, 'warehouse_purchases', row.id, mapping.fields);
      }
      if (mapping.alert) {
        await writeAlertLog(pool, {
          purchaseId: row.id,
          spNo: row.prepay_sp_no,
          docType: 'warehouse_purchase_prepay',
          spStatus: mapping.spStatus,
          message: mapping.message,
        });
      }
      const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [row.id]);
      return { ok: true, data: normalizePurchaseRow(freshRows[0]) };
    } catch (err) {
      return { ok: false, error: `刷新预付款审批失败: ${err.message}` };
    }
  }

  // 4) 月结付款审批单号（monthly_payment_sp_no 且未付款）
  if (row.purchase_type === 'monthly' && row.monthly_payment_sp_no && !row.monthly_paid_at) {
    try {
      const detail = await getApprovalDetail(config, row.monthly_payment_sp_no);
      const spStatus = detail.info?.sp_status;
      if (spStatus === 2) {
        await pool.query(
          'UPDATE warehouse_purchases SET monthly_paid_at = NOW() WHERE monthly_payment_sp_no = ?',
          [row.monthly_payment_sp_no]
        );
      }
      const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [row.id]);
      return { ok: true, data: normalizePurchaseRow(freshRows[0]) };
    } catch (err) {
      return { ok: false, error: `刷新月结付款审批失败: ${err.message}` };
    }
  }

  // 5) confirming 无 sp_no：直接返回最新数据
  if (row.status === 'confirming') {
    return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: 'confirming (no sp_no)' };
  }

  // 其他情况跳过
  return { ok: true, data: normalizePurchaseRow(row), skipped: true, reason: 'no refreshable sp_no' };
}

// POST /batch-refresh-status — 批量刷新仓库采购审批状态
// 入参: { ids?: string[], status?: string }
//   - 传 ids 时只刷新指定 ID 的单据（前端当前页可见的记录）
//   - 未传 ids 时按 status 过滤（兼容旧调用，会刷新全部分页记录）
router.post('/batch-refresh-status', requireAuth, async (req, res) => {
  try {
    const { ids, status } = req.body || {};

    // 复用列表查询的过滤条件
    const conditions = [];
    const params = [];
    if (Array.isArray(ids) && ids.length > 0) {
      // 优先用 ids 精确刷新当前页记录
      conditions.push('id IN (?)');
      params.push(ids);
    } else if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    const userRole = req.user?.role;
    if (userRole !== 'admin') {
      conditions.push('created_by = ?');
      params.push(req.user.id);
    }
    const whereSql = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // 只查需要刷新的记录（按 id IN 或 status 过滤）
    const [rows] = await pool.query(
      `SELECT * FROM warehouse_purchases${whereSql} ORDER BY created_at DESC`,
      params
    );

    if (rows.length === 0) {
      return res.json({
        results: [],
        failed: [],
        summary: { total: 0, success: 0, failed: 0, skipped: 0 }
      });
    }

    // 企微配置只查一次，复用给每条
    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企业微信应用配置' });
    }

    const results = [];
    const failed = [];
    let skipped = 0;

    // 串行调用避免企微 API 限流
    for (const row of rows) {
      try {
        const result = await refreshWarehousePurchaseCore(row, config);
        if (result.ok) {
          results.push(result.data);
          if (result.skipped) skipped++;
        } else {
          failed.push({ id: row.id, purchase_no: row.purchase_no, error: result.error });
        }
      } catch (err) {
        failed.push({ id: row.id, purchase_no: row.purchase_no, error: err.message });
      }
    }

    res.json({
      results,
      failed,
      summary: {
        total: rows.length,
        success: results.length - skipped,
        failed: failed.length,
        skipped
      }
    });
  } catch (err) {
    console.error('batch-refresh-status error:', err);
    res.status(400).json({ error: err.message });
  }
});

// 5.4. POST /admin/reconcile-approvals — 管理员一键对账
// 入参: { dry_run?: boolean }  默认 true（只预览差异，不写库）
// 权限: 服务端校验 req.user.roles 包含 admin
router.post('/admin/reconcile-approvals', requireAuth, async (req, res) => {
  try {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    if (!roles.includes('admin')) {
      return res.status(403).json({ error: '仅管理员可执行审批对账' });
    }

    const dryRun = req.body?.dry_run !== false;
    const { reconcileApprovals } = require('../utils/warehouse-approval-reconcile');
    const result = await reconcileApprovals({ dryRun });

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('审批对账失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5.5. POST /:id/refresh-approval — 刷新采购审批状态
router.post('/:id/refresh-approval', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '采购单不存在' });
    const row = rows[0];
    if (!row.approval_sp_no) {
      return res.status(400).json({ error: '该采购单未发起审批' });
    }
    // 已冻结（企微 6/7）不允许自动回退，需人工核对后处理
    if (row.approval_status === 'frozen') {
      return res.json(normalizePurchaseRow(row));
    }

    const config = await getWecomConfig();
    if (!config) return res.status(400).json({ error: '企业微信未配置' });

    console.log(`[刷新采购审批] 查询审批详情: sp_no=${row.approval_sp_no}`);
    const detail = await getApprovalDetail(config, row.approval_sp_no);
    console.log(`[刷新采购审批] 原始响应:`, JSON.stringify(detail).substring(0, 500));
    
    // 企微API返回结构: { errcode, errmsg, info: { sp_status, ... } }
    const spStatus = detail?.info?.sp_status ?? detail?.sp_status;
    console.log(`[刷新采购审批] sp_status=${spStatus} (类型: ${typeof spStatus})`);
    // sp_status: 1=审批中，2=已通过，3=已驳回，4=已撤销，6=通过后撤销，7=已删除

    const mapping = mapPurchaseApproval(spStatus);
    if (!mapping) {
      // 解析失败/未知状态：不写库，原样返回
      console.warn(`[刷新采购审批] sp_status 无法识别，跳过写库: ${spStatus}`);
      return res.json(normalizePurchaseRow(row));
    }

    if (!isApplied(row, mapping.fields)) {
      await applyFields(pool, 'warehouse_purchases', id, mapping.fields);
    }
    if (mapping.alert && row.approval_status !== 'frozen') {
      await writeAlertLog(pool, {
        purchaseId: id,
        spNo: row.approval_sp_no,
        docType: 'warehouse_purchase_approval',
        spStatus: mapping.spStatus,
        message: mapping.message,
      });
    }

    const [fresh] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    console.log(`[刷新采购审批] ${id}: spStatus=${spStatus} -> ${JSON.stringify(mapping.fields)}`);
    res.json(normalizePurchaseRow(fresh[0]));
  } catch (err) {
    console.error('刷新采购审批状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================
// 通用辅助：冲回采购单关联的库存和流水
//   - 删除/修改已收货的采购单时调用
//   - 严格校验：冲回后库存不能为负，否则拒绝操作
// ================================================
async function reversePurchaseStock(connection, purchaseId, strict = true) {
  // 1. 查该采购单关联的所有 stock_movements
  const [oldMoves] = await connection.query(
    `SELECT id, warehouse_id, item_id, quantity, movement_type
     FROM stock_movements WHERE related_type='purchase' AND related_id=?
     ORDER BY id ASC`,
    [purchaseId]
  );

  if (oldMoves.length === 0) {
    return { reversed: false, reason: '无关联流水需要冲回' };
  }

  // 2. 先按 仓库+物资 汇总冲回增量
  //    inbound 流水：库存增加过 +qty，冲回 -qty
  //    expense 流水：quantity 为负数（库存减少过），冲回 -quantity（即恢复）
  const deltaMap = new Map();
  for (const m of oldMoves) {
    if (m.movement_type !== 'inbound' && m.movement_type !== 'expense') continue;
    const delta = -toNum(m.quantity);
    if (!delta) continue;
    const key = `${m.warehouse_id}::${m.item_id}`;
    const cur = deltaMap.get(key) || { warehouse_id: m.warehouse_id, item_id: m.item_id, delta: 0 };
    cur.delta += delta;
    deltaMap.set(key, cur);
  }

  // 3. 按 warehouse_id, item_id 升序加锁并校验，避免逐条校验漏掉合计超扣
  const entries = Array.from(deltaMap.values()).sort((a, b) => {
    const wa = String(a.warehouse_id);
    const wb = String(b.warehouse_id);
    if (wa !== wb) return wa < wb ? -1 : 1;
    const ia = String(a.item_id);
    const ib = String(b.item_id);
    return ia === ib ? 0 : (ia < ib ? -1 : 1);
  });

  for (const e of entries) {
    const [invRows] = await connection.query(
      'SELECT quantity FROM inventory WHERE warehouse_id = ? AND item_id = ? FOR UPDATE',
      [e.warehouse_id, e.item_id]
    );
    const currentQty = invRows.length > 0 ? toNum(invRows[0].quantity) : 0;

    if (strict) {
      const newQty = currentQty + e.delta;
      if (newQty < 0) {
        throw new Error(
          `冲回库存失败：仓库/物资 ${e.warehouse_id}/${e.item_id} 当前库存 ${currentQty}，` +
          `冲回后将变为 ${newQty}（负数）。可能已有其他出库操作，请先盘点调账。`
        );
      }
    }

    if (invRows.length > 0) {
      await connection.query(
        'UPDATE inventory SET quantity = quantity + ? WHERE warehouse_id = ? AND item_id = ?',
        [e.delta, e.warehouse_id, e.item_id]
      );
    }
    // 如果 inventory 记录已被删除（极端情况），也不再补，保持现状
  }

  // 4. 删除旧流水
  await connection.query(
    'DELETE FROM stock_movements WHERE related_type = ? AND related_id = ?',
    ['purchase', purchaseId]
  );

  return { reversed: true, moveCount: oldMoves.length };
}

// ================================================
// 通用辅助：检查采购单是否被预付款核销/月结账单关联
//   用于判断是否允许删除
// ================================================
async function checkPurchaseNoBlocked(connection, purchaseId) {
  // 检查预付款核销关联
  const [writeOffRows] = await connection.query(
    `SELECT id FROM prepay_writeoffs WHERE related_purchase_id = ? LIMIT 1`,
    [purchaseId]
  );
  if (writeOffRows.length > 0) {
    return { blocked: true, reason: '该采购单已关联预付款核销，无法删除' };
  }

  // 检查月结账单关联
  const [monthlyRows] = await connection.query(
    `SELECT id FROM warehouse_monthly_bill_items WHERE purchase_id = ? LIMIT 1`,
    [purchaseId]
  );
  if (monthlyRows.length > 0) {
    return { blocked: true, reason: '该采购单已关联月结账单，无法删除' };
  }

  return { blocked: false };
}

// ================================================
// 通用辅助：存在未完结退货单（submitted/confirmed/completed）时
//   禁止修改收货、删除整单
// ================================================
async function findActiveReturn(connection, purchaseId) {
  const [rows] = await connection.query(
    `SELECT id, return_no, status FROM warehouse_purchase_returns
     WHERE purchase_id = ? AND status IN (?) LIMIT 1`,
    [purchaseId, ACTIVE_RETURN_STATUSES]
  );
  return rows[0] || null;
}

// 6. POST /:id/receive — 录入实际收货（支持对已收货的采购单重新录入 = 修改收货）
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
    const purchaseRow = rows[0];
    // 允许审批通过 + 已收货 的采购单录入收货（已收货状态 = 修改收货），也允许状态异常（confirmed但无收货数据）的预付订单重新录入
    const canReceive = ['approved', 'received'].includes(purchaseRow.status);
    const isPrepayFix = purchaseRow.purchase_type === 'prepay' && purchaseRow.status === 'confirmed' && toNum(purchaseRow.actual_amount) <= 0;
    if (!canReceive && !isPrepayFix) {
      await connection.rollback();
      return res.status(400).json({ error: '只有审批通过或已收货的采购单可以录入/修改收货' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '收货明细不能为空' });
    }

    // 存在未完结退货单时禁止修改收货（避免实收数量与已退数量口径冲突）
    const activeReturn = await findActiveReturn(connection, id);
    if (activeReturn) {
      await connection.rollback();
      return res.status(400).json({
        error: `该采购单存在未完结退货单（${activeReturn.return_no}，状态 ${activeReturn.status}），请先处理退货后再修改收货`,
      });
    }

    // 如果已经收货过，先冲回旧库存和流水（严格校验不允许负库存）
    if (purchaseRow.status === 'received') {
      try {
        await reversePurchaseStock(connection, id, true);
      } catch (reverseErr) {
        await connection.rollback();
        return res.status(400).json({ error: reverseErr.message });
      }
    }

    let actualAmount = 0;
    for (const item of items) {
      const qty = toNum(item.received_quantity);
      const price = toNum(item.received_unit_price);
      const notArrived = item.not_arrived ? 1 : 0;
      const amount = qty * price;
      actualAmount += amount;
      await connection.query(
        `UPDATE warehouse_purchase_items
         SET received_quantity = ?, received_unit = ?, received_unit_price = ?, received_amount = ?, received_spec = ?, not_arrived = ?
         WHERE id = ? AND purchase_id = ?`,
        [
          qty,
          item.received_unit || null,
          price,
          amount,
          item.received_spec || null,
          notArrived,
          item.id,
          id,
        ]
      );
    }

    await connection.query(
      'UPDATE warehouse_purchases SET actual_amount = ?, status = ? WHERE id = ?',
      [actualAmount, 'received', id]
    );

    // 写入入库流水 + 更新库存
    const [receiveItemRows] = await connection.query(
      `SELECT wpi.*, w.type as wh_type, w.department_id as wh_department_id,
              wi.instant_use as item_instant_use
       FROM warehouse_purchase_items wpi
       LEFT JOIN warehouses w ON wpi.warehouse_id = w.id
       LEFT JOIN warehouse_items wi ON wpi.item_id = wi.id
       WHERE wpi.purchase_id = ? ORDER BY wpi.sort_order ASC, wpi.id ASC`,
      [id]
    );
    const operatorId = (req.user && req.user.id) || null;
    const operatorName = (req.user && req.user.name) || null;
    for (const ri of receiveItemRows) {
      const rQty = toNum(ri.received_quantity);
      if (rQty <= 0 || !ri.warehouse_id || !ri.item_id) continue;
      const rPrice = toNum(ri.received_unit_price);
      const rAmount = toNum(ri.received_amount);
      const rUnit = ri.received_unit || ri.requested_unit || '';
      // 部门仓自动取仓库绑定部门，总仓取明细行部门（可能为空）
      const deptId = ri.wh_type === 'dept' ? (ri.wh_department_id || ri.department_id) : ri.department_id;
      const deptName = ri.department_name || null;

      // 判断是否即采即用：明细行覆盖优先，否则继承物资库设置
      const isInstantUse = ri.instant_use_override !== null
        ? Number(ri.instant_use_override) === 1
        : Number(ri.item_instant_use) === 1;

      // 写入 stock_movements（入库）
      await connection.query(
        `INSERT INTO stock_movements
         (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount,
          reason, related_type, related_id, operator_id, operator_name, department_id, department_name)
         VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'purchase', ?, ?, ?, ?, ?)`,
        [uuidv4(), ri.warehouse_id, ri.item_id, ri.item_name,
         rQty, rUnit, rPrice, rAmount,
         `采购入库 ${purchaseRow.purchase_no || id}`,
         id, operatorId, operatorName, deptId || null, deptName]
      );

      // upsert inventory，并按加权平均法更新物资参考单价
      const [existingInv] = await connection.query(
        'SELECT quantity FROM inventory WHERE warehouse_id = ? AND item_id = ?',
        [ri.warehouse_id, ri.item_id]
      );
      if (existingInv.length > 0) {
        const oldQty = Number(existingInv[0].quantity) || 0;
        await connection.query(
          'UPDATE inventory SET quantity = quantity + ?, unit = ? WHERE warehouse_id = ? AND item_id = ?',
          [rQty, rUnit, ri.warehouse_id, ri.item_id]
        );

        if (rPrice !== null && !isNaN(rPrice)) {
          const [refRows] = await connection.query('SELECT reference_price FROM warehouse_items WHERE id = ? LIMIT 1', [ri.item_id]);
          const oldPrice = Number(refRows[0]?.reference_price) || 0;
          const newTotalQty = oldQty + rQty;
          let weightedPrice;
          if (oldQty <= 0 || oldPrice <= 0) {
            weightedPrice = rPrice;
          } else if (newTotalQty > 0) {
            weightedPrice = parseFloat(((oldQty * oldPrice) + (rQty * rPrice)) / newTotalQty).toFixed(4);
            weightedPrice = parseFloat(weightedPrice);
          } else {
            weightedPrice = rPrice;
          }
          await connection.query('UPDATE warehouse_items SET reference_price = ? WHERE id = ?', [weightedPrice, ri.item_id]);
        }
      } else {
        await connection.query(
          'INSERT INTO inventory (id, warehouse_id, item_id, quantity, unit) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), ri.warehouse_id, ri.item_id, rQty, rUnit]
        );
        if (rPrice !== null && !isNaN(rPrice)) {
          await connection.query('UPDATE warehouse_items SET reference_price = ? WHERE id = ?', [rPrice, ri.item_id]);
        }
      }

      // 即采即用：仅部门仓自动出库归零（费用化）；总仓保留库存供其他部门领用
      if (isInstantUse && ri.wh_type === 'dept') {
        await connection.query(
          `INSERT INTO stock_movements
           (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount,
            reason, related_type, related_id, operator_id, operator_name, department_id, department_name)
           VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?, ?, 'purchase', ?, ?, ?, ?, ?)`,
          [uuidv4(), ri.warehouse_id, ri.item_id, ri.item_name,
           -rQty, rUnit, rPrice, rAmount,
           `即采即用自动出库 ${purchaseRow.purchase_no || id}`,
           id, operatorId, operatorName, deptId || null, deptName]
        );
        // 库存归零
        await connection.query(
          'UPDATE inventory SET quantity = 0 WHERE warehouse_id = ? AND item_id = ?',
          [ri.warehouse_id, ri.item_id]
        );
      }
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
    const hasApiConfig = config.corp_id && config.app_secret && config.agent_id;
    if (!hasApiConfig) {
      await connection.rollback();
      return res.status(400).json({ error: '请先完成企业微信自建应用配置（corp_id/app_secret/agent_id）' });
    }

    const [itemRows] = await connection.query(
      'SELECT * FROM warehouse_purchase_items WHERE purchase_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    // 读取各部门确认人（解析为 userid 数组，支持多人）
    const [deptRows] = await connection.query('SELECT id, name, confirmer_userid FROM departments');
    const deptConfirmerMap = {}; // dept id/name -> [userid, ...]
    for (const d of deptRows) {
      const userids = parseConfirmerUserids(d.confirmer_userid);
      if (userids.length > 0) {
        deptConfirmerMap[d.id] = userids;
        deptConfirmerMap[d.name] = userids;
      }
    }

    // 读取各仓库确认人（解析为 userid 数组，支持多人）
    const [whRows] = await connection.query('SELECT id, name, confirmer_userid FROM warehouses WHERE status = 1');
    const whConfirmerMap = {}; // wh id/name -> [userid, ...]
    for (const w of whRows) {
      const userids = parseConfirmerUserids(w.confirmer_userid);
      if (userids.length > 0) {
        whConfirmerMap[w.id] = userids;
        whConfirmerMap[w.name] = userids;
      }
    }

    // 按仓库维度组织确认任务：whKey -> { whName, confirmers: [userid...], items: [] }
    // 优先使用仓库确认人，仓库未配置则 fallback 到部门确认人
    const warehouseTasks = {}; // whKey(whId||whName) -> task
    for (const item of itemRows) {
      const whId = item.warehouse_id || null;
      const whName = item.warehouse_name || '未指定仓库';
      const whKey = whId || whName;
      // 优先仓库确认人，fallback 部门确认人
      const confirmers = (whId && whConfirmerMap[whId]) || whConfirmerMap[whName]
        || (item.department_id && deptConfirmerMap[item.department_id]) || deptConfirmerMap[item.department_name]
        || [];
      if (!warehouseTasks[whKey]) {
        warehouseTasks[whKey] = {
          whId, whName,
          confirmers: Array.from(new Set(confirmers)), // 去重
          items: [],
        };
      } else {
        // 合并确认人（同一仓库不同部门的物资，确认人取并集）
        for (const u of confirmers) {
          if (!warehouseTasks[whKey].confirmers.includes(u)) {
            warehouseTasks[whKey].confirmers.push(u);
          }
        }
      }
      warehouseTasks[whKey].items.push(item);
    }

    // 过滤掉没有确认人的仓库任务（这些仓库无需确认）
    const tasksNeedingConfirm = Object.values(warehouseTasks).filter(t => t.confirmers.length > 0);
    const hasConfirmers = tasksNeedingConfirm.length > 0;

    // 构建 userid -> { items, whNames, whKeys } 映射（用于发送个人卡片）
    const userTaskMap = {}; // userid -> { items: [], whNames: Set, whKeys: Set }
    for (const task of tasksNeedingConfirm) {
      for (const userid of task.confirmers) {
        if (!userTaskMap[userid]) userTaskMap[userid] = { items: [], whNames: new Set(), whKeys: new Set() };
        userTaskMap[userid].items.push(...task.items);
        userTaskMap[userid].whNames.add(task.whName);
        userTaskMap[userid].whKeys.add(task.whId || task.whName);
      }
    }
    const mentionedUsers = Object.keys(userTaskMap);

    // 解析 @提及用户的真实姓名
    const mentionedNameMap = {};
    for (const uid of mentionedUsers) {
      try {
        mentionedNameMap[uid] = await getWecomUserName(uid);
      } catch (_) {
        mentionedNameMap[uid] = uid;
      }
    }

    const domain = config.app_domain || (req.headers.origin || (req.protocol + '://' + req.get('host')));
    const purchaseNo = row.purchase_no || '';
    const totalAmount = computeNetAmount(row);

    // 汇总涉及仓库
    const warehouseNames = Array.from(new Set(itemRows.map(i => i.warehouse_name).filter(Boolean)));

    // 构建群消息 Markdown（按仓库分组明细，@确认人）
    let mdContent = `**📋 仓库采购确认通知**\n\n`;
    mdContent += `📦 **采购单号**：${purchaseNo}\n`;
    mdContent += `🏢 **涉及仓库**：${warehouseNames.length > 0 ? warehouseNames.join('、') : '未指定'}\n`;
    mdContent += `💰 **总金额**：¥${totalAmount.toFixed(2)}\n\n`;
    mdContent += `---\n\n`;

    // 按仓库分组
    const groupedByWh = {};
    for (const item of itemRows) {
      const wn = item.warehouse_name || '未指定仓库';
      if (!groupedByWh[wn]) groupedByWh[wn] = [];
      groupedByWh[wn].push(item);
    }
    for (const [whName, whItems] of Object.entries(groupedByWh)) {
      mdContent += `**【${whName}】**\n`;
      // 已到货物资
      for (const item of whItems) {
        if (item.not_arrived) continue; // 未到货物资单独列出
        const hasReceived = toNum(item.received_amount) > 0 || toNum(item.received_quantity) > 0;
        const price = hasReceived ? toNum(item.received_unit_price) : toNum(item.requested_unit_price);
        const qty = hasReceived ? toNum(item.received_quantity) : toNum(item.requested_quantity);
        const amt = hasReceived ? toNum(item.received_amount) : toNum(item.requested_amount);
        const unit = hasReceived ? (item.received_unit || item.requested_unit) : item.requested_unit;
        const deptTag = item.department_name ? `[${item.department_name}]` : '';
        mdContent += `> ${item.item_name}  ${price.toFixed(2)}/${unit} ×${qty}${unit} = ¥${amt.toFixed(2)} ${deptTag}\n`;
      }
      // 未到货物资单独列出
      const notArrivedItems = whItems.filter(i => i.not_arrived);
      if (notArrivedItems.length > 0) {
        mdContent += `\n> ⚠️ **未到货物资**：\n`;
        for (const item of notArrivedItems) {
          mdContent += `> ${item.item_name}  （未到货）\n`;
        }
      }
      // 小计只计算已到货物资
      const subtotal = whItems.filter(i => !i.not_arrived).reduce((s, i) => {
        const hasReceived = toNum(i.received_amount) > 0 || toNum(i.received_quantity) > 0;
        return s + (hasReceived ? toNum(i.received_amount) : toNum(i.requested_amount));
      }, 0);
      mdContent += `> *小计：¥${subtotal.toFixed(2)}*\n\n`;
    }

    mdContent += `---\n\n`;
    if (mentionedUsers.length > 0) {
      mdContent += `📢 **请相关人员核对清单并确认入库**：`;
      for (const userid of mentionedUsers) {
        const displayName = mentionedNameMap[userid] || userid;
        mdContent += ` @${displayName}`;
      }
      mdContent += `\n\n`;
    }

    // 发送个人模板卡片消息（不发送群消息）
    let wecomMsgId = null;
    const sentToUsers = [];
    const failedUsers = [];
    const sentResponseCodes = []; // { userid, responseCode }
    for (const [userid, data] of Object.entries(userTaskMap)) {
        try {
          const userWhNames = Array.from(data.whNames);
          const userItems = data.items;
          // 金额只统计已到货物资
          const userTotal = userItems.filter(i => !i.not_arrived).reduce((s, i) => {
            const hasReceived = toNum(i.received_amount) > 0 || toNum(i.received_quantity) > 0;
            return s + (hasReceived ? toNum(i.received_amount) : toNum(i.requested_amount));
          }, 0);

          // 用户负责仓库的内容摘要
          const scopeLabel = userWhNames.join('、');
          const subTitle = `采购单号：${purchaseNo}\n您负责确认：${scopeLabel}`;

          const horizontalContentList = [
            { keyname: '采购单号', value: String(purchaseNo || '-') },
            { keyname: '涉及仓库', value: userWhNames.join('、') },
            { keyname: '物资项数', value: `${userItems.length}项` },
          ];

          const userTaskId = `${id}_${userid}`;
          const confirmUrl = `${domain}/warehouse-confirm?id=${id}&user=${userid}`;

          const sendResult = await sendTemplateCardToUser(config, userid, {
            card_type: 'button_interaction',
            main_title: { title: '📋 仓库采购确认通知', desc: warehouseNames.join('、') },
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
          sentToUsers.push({ userid, scope: scopeLabel, total: userTotal });
        } catch (sendErr) {
          console.error(`发送个人模板卡片消息失败 ${userid}:`, sendErr.message);
          failedUsers.push({ userid, error: sendErr.message });
        }
    }

    // 发送群聊文本消息（webhook text 类型 + mentioned_list 实现真正@提醒）
    // 不含金额等敏感信息，仅提醒相关人员前往应用内核对确认
    // 发送失败不影响个人卡片推送和主流程，仅记录结果
    let groupMsgResult = null;
    const webhookUrl = config.webhook_url || config.test_webhook_url;
    if (webhookUrl && mentionedUsers.length > 0) {
      try {
        let groupText = `【仓库采购确认通知】\n`;
        groupText += `采购单号：${purchaseNo || '未生成'}\n`;
        groupText += `涉及仓库：${warehouseNames.length > 0 ? warehouseNames.join('、') : '未指定'}\n`;
        groupText += `\n请相关人员尽快前往应用内核对入库清单并确认。`;

        await sendTextViaWebhook(webhookUrl, groupText, mentionedUsers);
        console.log('[send-confirm] 群聊@提醒消息发送成功');
        groupMsgResult = { success: true, method: 'webhook' };
      } catch (groupErr) {
        console.error('[send-confirm] 群聊@提醒消息发送失败（不影响主流程）:', groupErr.message);
        groupMsgResult = { success: false, error: groupErr.message };
      }
    } else {
      groupMsgResult = { success: false, error: '未配置 webhook 或无确认人' };
    }

    // 构建 user_departments 存库（按仓库维度组织，记录该仓库的确认人列表）
    // 结构: { whKey: { wh_name, confirmers: [userid...], response_codes: { userid: code }, confirmed: false, confirmed_by: null, confirmed_at: null } }
    const userDepartmentsMap = {};
    for (const task of tasksNeedingConfirm) {
      const whKey = task.whId || task.whName;
      const responseCodes = {};
      for (const userid of task.confirmers) {
        const sentItem = sentResponseCodes.find(s => s.userid === userid);
        if (sentItem) responseCodes[userid] = sentItem.responseCode;
      }
      userDepartmentsMap[whKey] = {
        wh_id: task.whId,
        wh_name: task.whName,
        confirmers: task.confirmers,
        response_codes: responseCodes,
        confirmed: false,
        confirmed_by: null,
        confirmed_at: null,
      };
    }

    // 如果没有匹配到任何确认人：不发送任何消息，提示用户去配置确认人
    if (!hasConfirmers) {
      await connection.rollback();
      const tip = '未匹配到任何确认人。请在「仓库管理」或「部门管理」中为相关仓库/部门配置确认人（企业微信userid）后再发送确认通知。';
      res.status(400).json({
        success: false,
        error: tip,
        no_confirmer: true,
      });
    } else {
      await connection.query(
        'UPDATE warehouse_purchases SET wecom_msg_id = ?, user_departments = ?, user_confirmations = ?, status = ? WHERE id = ?',
        [wecomMsgId, JSON.stringify(userDepartmentsMap), JSON.stringify({}), 'confirming', id]
      );

      await connection.commit();

      res.json({
        success: true,
        message: groupMsgResult?.success
          ? '确认通知已发送（含群聊@提醒）'
          : '确认通知已发送（群聊消息发送失败，个人消息已送达）',
        wecom_msg_id: wecomMsgId,
        sent_to_users: sentToUsers,
        failed_users: failedUsers,
        user_departments: userDepartmentsMap,
        group_message: groupMsgResult,
      });
    }
  } catch (err) {
    await connection.rollback();
    console.error('发送仓库采购确认通知失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 10. POST /:id/generate-pdf — 生成PDF（支持 type=apply|confirm 指定类型，未指定时按状态自动判断）
router.post('/:id/generate-pdf', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query; // 'apply' = 申请单, 'confirm' = 确认单
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    // 显式指定类型优先；未指定时按状态自动判断
    const applyStatuses = ['draft', 'pending_approval', 'rejected', 'approved'];
    const isApplyPdf = type === 'apply' ? true : (type === 'confirm' ? false : applyStatuses.includes(row.status));
    if (isApplyPdf) {
      await generatePurchaseApplyPDF(id);
      const applyPdfUrl = `/api/warehouse-purchases/${id}/pdf?type=apply`;
      await pool.query('UPDATE warehouse_purchases SET apply_pdf_url = ? WHERE id = ?', [applyPdfUrl, id]);
      res.json({ success: true, pdf_url: applyPdfUrl, type: 'apply' });
    } else {
      await generateWarehousePDF(id);
      const pdfUrl = `/api/warehouse-purchases/${id}/pdf?type=confirm`;
      await pool.query('UPDATE warehouse_purchases SET pdf_url = ? WHERE id = ?', [pdfUrl, id]);
      res.json({ success: true, pdf_url: pdfUrl, type: 'confirm' });
    }
  } catch (err) {
    console.error('仓库采购PDF生成失败:', err);
    res.status(500).json({ error: err.message || 'PDF生成失败' });
  }
});

// 11. GET /:id/pdf — 下载PDF（支持 type=apply|confirm 指定类型，未指定时按状态自动判断）
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query; // 'apply' = 申请单, 'confirm' = 确认单

    const [rows] = await pool.query('SELECT status FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const orderStatus = rows[0].status;
    const applyStatuses = ['draft', 'pending_approval', 'rejected', 'approved'];
    const isApplyPdf = type === 'apply' ? true : (type === 'confirm' ? false : applyStatuses.includes(orderStatus));

    const confirmPdfPath = path.join(PDF_DIR, `warehouse_${id}.pdf`);
    const applyPdfPath = path.join(PDF_DIR, `warehouse_apply_${id}.pdf`);

    if (isApplyPdf) {
      // 申请单 PDF
      if (fs.existsSync(applyPdfPath)) {
        return res.download(applyPdfPath, `仓库采购申请单_${id}.pdf`);
      }
      try {
        await generatePurchaseApplyPDF(id);
        if (fs.existsSync(applyPdfPath)) {
          try { await pool.query('UPDATE warehouse_purchases SET apply_pdf_url = ? WHERE id = ?', [`/api/warehouse-purchases/${id}/pdf?type=apply`, id]); } catch (e) {}
          return res.download(applyPdfPath, `仓库采购申请单_${id}.pdf`);
        }
      } catch (genErr) {
        console.error('生成申请单PDF失败:', genErr.message);
      }
      return res.status(404).json({ error: '申请单PDF不存在' });
    } else {
      // 确认单 PDF
      if (fs.existsSync(confirmPdfPath)) {
        return res.download(confirmPdfPath, `仓库采购确认单_${id}.pdf`);
      }
      try {
        await generateWarehousePDF(id);
        if (fs.existsSync(confirmPdfPath)) {
          try { await pool.query('UPDATE warehouse_purchases SET pdf_url = ? WHERE id = ?', [`/api/warehouse-purchases/${id}/pdf?type=confirm`, id]); } catch (e) {}
          return res.download(confirmPdfPath, `仓库采购确认单_${id}.pdf`);
        }
      } catch (genErr) {
        console.error('生成确认单PDF失败:', genErr.message);
      }
      return res.status(404).json({ error: '确认单PDF不存在' });
    }
  } catch (err) {
    console.error('下载仓库采购PDF失败:', err);
    res.status(500).json({ error: err.message || '下载失败' });
  }
});

// 12. POST /:id/refresh-status — 刷新订单状态（确认进度或报销审批状态）
router.post('/:id/refresh-status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];

    // 已冻结（企微 6/7）：禁止自动回退，原样返回
    if (row.reimbursement_status === 'frozen') {
      return res.json({
        ...normalizePurchaseRow(row),
        warning: '审批异常已冻结，请联系财务人工核对',
      });
    }

    // 如果订单还在确认中，没有报销单号，直接返回最新数据（用于刷新确认进度）
    if (row.status === 'confirming' && !row.reimbursement_sp_no) {
      const [updatedRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
      return res.json(normalizePurchaseRow(updatedRows[0]));
    }

    if (!row.reimbursement_sp_no) {
      // 订单已确认但尚未发起报销（可能是自动发起失败），直接返回最新数据
      const [updatedRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
      return res.json(normalizePurchaseRow(updatedRows[0]));
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

    const mapping = mapReimbursement(spStatus, row);
    if (!mapping) {
      // 解析失败 / 未知状态：一律不写库
      return res.json({
        ...normalizePurchaseRow(row),
        sp_status: spStatus,
        warning: `企微审批状态 ${spStatus ?? '未知'} 暂不支持自动同步，本单状态未修改`,
      });
    }

    const fields = { ...mapping.fields };
    // 预付款尾款报销通过后，标记核销完成
    if (mapping.action === 'approve' && row.purchase_type === 'prepay' &&
        (row.writeoff_status === 'manual' || row.writeoff_status === 'reimbursing')) {
      fields.writeoff_status = 'auto';
    }
    // 报销被驳回或撤销后，恢复 writeoff_status 以便重新发起
    if ((mapping.action === 'reject' || mapping.action === 'revoke') &&
        row.purchase_type === 'prepay' && row.writeoff_status === 'reimbursing') {
      fields.writeoff_status = 'manual';
    }

    let latestApprover = null;
    if (spRecord.length > 0) {
      const lastRecord = spRecord[spRecord.length - 1];
      if (lastRecord.approver && lastRecord.approver.length > 0) {
        latestApprover = lastRecord.approver[0].name || lastRecord.approver[0].userid;
      }
    }

    if (!isApplied(row, fields)) {
      await applyFields(pool, 'warehouse_purchases', id, fields);
    }
    if (mapping.alert) {
      await writeAlertLog(pool, {
        purchaseId: id,
        spNo: row.reimbursement_sp_no,
        docType: 'warehouse_purchase_reimbursement',
        spStatus: mapping.spStatus,
        message: mapping.message,
      });
    }

    const [updatedRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json({
      ...normalizePurchaseRow(updatedRows[0]),
      sp_status: spStatus,
      latest_approver: latestApprover,
      ...(mapping.frozen ? { warning: mapping.message } : {}),
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
    // 业务依据：撤销的付款申请一定未付款，unknown 亦按未付款处理，均可重发；
    // 仅当明确查到付款记录（月结已付 / 预付已回填凭证 / 费用支付记录已付）时禁止重发。
    const paymentState = await derivePaymentState(pool, row);
    if (paymentState === 'paid') {
      return res.status(400).json({ error: '该采购单已记录付款，禁止重新发起报销' });
    }
    // 允许两种场景：1) 首次发起报销（status=confirmed 且无 reimbursement_sp_no）；
    // 2) 报销被驳回/被撤销后重新发起（frozen 为异常冻结，禁止重发）
    const isFirstTime = row.status === 'confirmed' && !row.reimbursement_sp_no;
    const isResubmit = row.reimbursement_status === 'rejected' || row.reimbursement_status === 'revoked';
    if (!isFirstTime && !isResubmit) {
      return res.status(400).json({ error: '只有已确认未报销或报销被驳回/撤销的采购单可以发起报销' });
    }

    const [itemRows] = await pool.query(
      `SELECT wpi.*, d.name as department_name
       FROM warehouse_purchase_items wpi
       LEFT JOIN warehouses w ON wpi.warehouse_id = w.id
       LEFT JOIN departments d ON w.department_id = d.id
       WHERE wpi.purchase_id = ? ORDER BY wpi.sort_order ASC, wpi.id ASC`,
      [id]
    );

    // 重新生成 PDF（确保最新）
    try { await generateWarehousePDF(id); } catch (e) { console.error('重新生成PDF失败:', e.message); }

    const spNo = await submitWarehouseReimbursement(row, itemRows, req.user?.wecom_userid);

    // 记录历史报销单号（重发前把旧单号追加进历史，便于追溯已撤销/驳回的审批单）
    let historySpNos = [];
    try {
      const parsed = JSON.parse(row.reimbursement_sp_no_history || '[]');
      if (Array.isArray(parsed)) historySpNos = parsed.filter(Boolean);
    } catch (e) { historySpNos = []; }
    if (row.reimbursement_sp_no && !historySpNos.includes(row.reimbursement_sp_no)) {
      historySpNos.push(row.reimbursement_sp_no);
    }
    const historyJson = JSON.stringify(historySpNos);

    if (row.purchase_type === 'prepay' && row.writeoff_status === 'manual') {
      await pool.query(
        `UPDATE warehouse_purchases
         SET reimbursement_status = ?, reimbursement_sp_no = ?, reimbursement_sp_no_history = ?, status = ?, writeoff_status = ?
         WHERE id = ?`,
        ['pending', spNo, historyJson, 'reimbursing', 'reimbursing', id]
      );
    } else {
      await pool.query(
        `UPDATE warehouse_purchases
         SET reimbursement_status = ?, reimbursement_sp_no = ?, reimbursement_sp_no_history = ?, status = ?
         WHERE id = ?`,
        ['pending', spNo, historyJson, 'reimbursing', id]
      );
    }

    const [updatedRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(updatedRows[0]));
  } catch (err) {
    console.error('重新发起仓库报销失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. DELETE /:id — 删除采购单
// 权限规则：
//   - 管理员（admin）：可删除任意状态的采购单
//   - 非管理员：只能删除自己创建的草稿单（status='draft' 且 created_by=当前用户）
router.delete('/:id', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;
    const [rows] = await connection.query(
      'SELECT id, status, created_by FROM warehouse_purchases WHERE id = ?',
      [id]
    );
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }

    const row = rows[0];
    // 兼容多角色：req.user.role 单值 + req.user.roles 数组
    const roleCodes = [req.user?.role, ...(req.user?.roles || []).map(r => typeof r === 'string' ? r : (r && r.code))].filter(Boolean);
    const isAdmin = roleCodes.includes('admin');
    const isDraftOwner = row.status === 'draft' && row.created_by === req.user.id;
    const isPendingOwner = row.status === 'pending_approval' && row.created_by === req.user.id; // 审批中创建人可撤回

    // 1. 非草稿/非审批中 + 非管理员 → 拒绝
    if (!isAdmin && !isDraftOwner && !isPendingOwner) {
      await connection.rollback();
      if (row.status === 'draft') {
        return res.status(403).json({ error: '无权限删除他人创建的采购单' });
      }
      if (row.status === 'pending_approval') {
        return res.status(403).json({ error: '审批中的采购单只有创建人可撤回' });
      }
      return res.status(400).json({ error: '该状态的采购单不允许删除（仅管理员可删除已收货/已确认订单）' });
    }

    // 2. 管理员删除已收货/已确认订单：检查是否被预付款核销/月结账单关联
    if (isAdmin && ['received', 'confirming', 'confirmed'].includes(row.status)) {
      const blockCheck = await checkPurchaseNoBlocked(connection, id);
      if (blockCheck.blocked) {
        await connection.rollback();
        return res.status(400).json({ error: blockCheck.reason });
      }
    }

    // 3. 存在未完结退货单时拒绝删除整单
    const activeReturn = await findActiveReturn(connection, id);
    if (activeReturn) {
      await connection.rollback();
      return res.status(400).json({
        error: `该采购单存在未完结退货单（${activeReturn.return_no}，状态 ${activeReturn.status}），请先处理退货后再删除`,
      });
    }

    // 4. 冲回已产生的库存和流水（received/confirming/confirmed 状态）
    if (['received', 'confirming', 'confirmed'].includes(row.status)) {
      try {
        await reversePurchaseStock(connection, id, true);
      } catch (reverseErr) {
        await connection.rollback();
        return res.status(400).json({ error: reverseErr.message });
      }
    }

    // 5. 清理草稿/已作废的退货记录（未对库存与金额产生残留影响）
    await connection.query(
      `DELETE ri FROM warehouse_purchase_return_items ri
       INNER JOIN warehouse_purchase_returns r ON r.id = ri.return_id
       WHERE r.purchase_id = ? AND r.status IN ('draft', 'voided')`,
      [id]
    );
    await connection.query(
      `DELETE FROM warehouse_purchase_returns WHERE purchase_id = ? AND status IN ('draft', 'voided')`,
      [id]
    );

    // 6. 删除明细 + 主表
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

// ================================================
// 预付款相关接口
// ================================================

// 上传预付附件（二进制，不走 base64，避免 413）
router.post('/:id/submit-prepay/upload-attachment', requireAuth, express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  try {
    const filename = req.headers['x-filename'] ? decodeURIComponent(String(req.headers['x-filename'])) : `attachment_${Date.now()}.pdf`;
    const config = await getWecomConfig();
    if (!config) return res.status(400).json({ error: '企微配置缺失' });

    const attachDir = path.join(__dirname, '..', 'uploads', 'prepay_attachments');
    if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

    const safeFilename = String(filename).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
    const savePath = path.join(attachDir, `${Date.now()}_${safeFilename}`);
    fs.writeFileSync(savePath, req.body);

    const mediaId = await uploadMedia(config, savePath, safeFilename);
    res.json({ filename: safeFilename, mediaId });
  } catch (err) {
    console.error('[预付采购] 附件上传失败:', err);
    res.status(500).json({ error: '附件上传失败: ' + err.message });
  }
});

// 12. POST /:id/submit-prepay — 发起预付款审批
router.post('/:id/submit-prepay', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (row.purchase_type !== 'prepay') {
      return res.status(400).json({ error: '该采购单不是预付款类型' });
    }
    const allowedPrepayStatuses = ['draft', 'pending_approval', 'confirmed'];
    if (!allowedPrepayStatuses.includes(row.status)) {
      return res.status(400).json({ error: '当前状态不可发起预付款审批' });
    }
    // 仅当审批仍在进行中（pending/approving）时阻止重复发起
    // 已撤回/已拒绝/已通过等状态允许重新发起
    if (row.prepay_sp_no && (row.prepay_status === 'pending' || row.prepay_status === 'approving')) {
      return res.status(400).json({ error: '预付款审批进行中，请等待结果或撤回后重新发起' });
    }

    const config = await getWecomConfig();
    if (!config || !config.corp_id || !config.app_secret) {
      return res.status(400).json({ error: '请先完成企微配置' });
    }
    // 模板ID回退：prepay_approval_template_id → approval_template_id（费用报销模板）→ warehouse_approval_template_id
    const effectivePrepayTplId = config.prepay_approval_template_id
      || config.approval_template_id
      || config.warehouse_approval_template_id;
    if (!effectivePrepayTplId) {
      return res.status(400).json({ error: '请先完成企微审批模板配置（费用报销模板或预付款模板）' });
    }

    // 校验当前用户是否绑定企微账号
    const prepayWecomUserid = req.user?.wecom_userid;
    if (!prepayWecomUserid) {
      return res.status(400).json({ error: '当前用户未绑定企微账号，无法发起审批。请联系管理员在用户管理中绑定企微账号。' });
    }

    const prepayAmount = toNum(row.prepay_amount);
    if (prepayAmount <= 0) {
      return res.status(400).json({ error: '预付款金额必须大于0' });
    }

    // 字段映射回退：prepay_field_mapping → approval_field_mapping（费用报销模板字段映射）
    const fieldMapping = parseFieldMapping(config.prepay_field_mapping || config.approval_field_mapping);
    const { controlTypeMap, selectorOptionsMap: prepaySelectorOpts, requiredControls: prepayReqControls, controlTitles: prepayTitles, contactModes: prepayContactModes } = await fetchWarehouseTemplateControlTypes(config, true, effectivePrepayTplId);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const monthDayStr = `${now.getMonth() + 1}月${now.getDate()}日`;

    // 查询采购明细（用于部门信息填充备注说明）
    const [itemRows] = await pool.query(
      `SELECT wpi.*, d.name as department_name, d.wecom_dept_id
       FROM warehouse_purchase_items wpi
       LEFT JOIN warehouses w ON wpi.warehouse_id = w.id
       LEFT JOIN departments d ON d.id = COALESCE(wpi.department_id, w.department_id)
       WHERE wpi.purchase_id = ? ORDER BY wpi.sort_order ASC, wpi.id ASC`,
      [id]
    );

    // 附件已通过上传接口上传，直接用 mediaId（不走 base64，避免 413）
    const { attachments: rawAttachments = [] } = req.body;
    const uploadedAttachments = Array.isArray(rawAttachments)
      ? rawAttachments.filter(a => a && a.mediaId).map(a => ({ filename: a.filename, mediaId: a.mediaId }))
      : [];
    // 文件已在 upload-attachment 接口落盘，submit-prepay 不再持久化文件路径
    const savedAttachments = [];

    // 付款事由：8月3日仓库采购预付款，预计总金额：¥136.00，预付金额：¥50.00，供应商：麦德龙
    const totalAmount = toNum(row.total_amount);
    const prepayReason = `${monthDayStr}仓库采购预付款，预计总金额：¥${totalAmount.toFixed(2)}，预付金额：¥${prepayAmount.toFixed(2)}，供应商：${row.supplier_name || '未指定'}`;
    // 备注说明：本次为仓库采购预付款，请相关部门确认收货后完成对账结算，采购单号：WH20260803001
    const prepayRemark = `本次为仓库采购预付款，请相关部门确认收货后完成对账结算，采购单号：${row.purchase_no || id}`;

    // 预校验报销模板必填字段配置是否完整
    const missingConfigs = [];
    if (fieldMapping.payee_name && !row.supplier_name) missingConfigs.push('供应商名称');
    if (fieldMapping.bank_name && !config.bank_name) missingConfigs.push('开户行');
    if (fieldMapping.bank_account && !config.bank_account) missingConfigs.push('银行账号');
    if (fieldMapping.payment_method && !config.default_payment_key) missingConfigs.push('付款方式');
    if (missingConfigs.length > 0) {
      console.warn(`[预付审批] 配置缺失: ${missingConfigs.join('、')}`);
    }

    const applyData = await buildWarehouseApplyData(config, fieldMapping, controlTypeMap, prepaySelectorOpts || {}, {
      date: dateStr,
      amount: prepayAmount,
      reason: prepayReason,
      items: itemRows,
      useReceived: true,
      pdfPath: null,
      rowId: id,
      prepayMode: true,
      template_id_override: effectivePrepayTplId,
      creatorUserid: prepayWecomUserid,
      payeeName: row.supplier_name || '供应商',
      relatedApprovalSpNo: row.approval_sp_no || null,
      requiredControls: prepayReqControls,
      controlTitles: prepayTitles,
      contactModes: prepayContactModes,
      attachments: uploadedAttachments,
      remarkTextOverride: prepayRemark,
    });

    // 打印审批数据摘要，便于排查提交失败
    console.log(`[预付审批] apply_data contents 数量: ${applyData.apply_data?.contents?.length || 0}`);
    console.log(`[预付审批] apply_data contents 摘要:`, JSON.stringify((applyData.apply_data?.contents || []).map(c => ({ id: c.id, control: c.control }))));

    let spNo;
    try {
      spNo = await submitApproval(config, applyData);
    } catch (submitErr) {
      console.error('[预付审批] 企微审批提交失败:', submitErr.message);
      // 将企微错误详情透传给前端
      const detail = submitErr.message || '提交审批失败';
      if (missingConfigs.length > 0) {
        throw new Error(`审批提交失败，可能原因：以下字段未配置（${missingConfigs.join('、')}）。企微返回：${detail}`);
      }
      throw new Error(`审批提交失败：${detail}`);
    }

    await pool.query(
      'UPDATE warehouse_purchases SET prepay_sp_no = ?, prepay_status = ?, prepay_attachments = ? WHERE id = ?',
      [spNo, 'pending', JSON.stringify(savedAttachments.length > 0 ? savedAttachments : null), id]
    );

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(freshRows[0]));
  } catch (err) {
    console.error('发起预付款审批失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12.1 GET /:id/prepay-attachments — 下载预付款审批附件
router.get('/:id/prepay-attachments', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { index } = req.query;
    const [rows] = await pool.query('SELECT prepay_attachments FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const attachments = parseJsonField(rows[0].prepay_attachments) || [];
    if (attachments.length === 0) {
      return res.status(404).json({ error: '无预付款附件' });
    }
    const idx = parseInt(index, 10) || 0;
    const att = attachments[idx];
    if (!att || !att.path || !fs.existsSync(att.path)) {
      return res.status(404).json({ error: '附件文件不存在' });
    }
    res.download(att.path, att.filename);
  } catch (err) {
    console.error('下载预付款附件失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /:id/refresh-prepay — 刷新预付款审批状态
router.post('/:id/refresh-prepay', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (!row.prepay_sp_no) {
      return res.status(400).json({ error: '未发起预付款审批' });
    }

    const config = await getWecomConfig();
    if (!config) {
      return res.status(400).json({ error: '请先完成企微配置' });
    }

    const detail = await getApprovalDetail(config, row.prepay_sp_no);
    console.log(`[刷新预付审批] 原始响应:`, JSON.stringify(detail).substring(0, 500));

    // 企微API返回结构: { errcode, errmsg, info: { sp_status, ... } }
    const spStatus = detail?.info?.sp_status ?? detail?.sp_status;
    console.log(`[刷新预付审批] sp_status=${spStatus} (类型: ${typeof spStatus})`);
    // sp_status: 1=审批中，2=已通过，3=已驳回，4=已撤销

    let newStatus = row.prepay_status;
    if (spStatus === 1 || spStatus === '1') {
      newStatus = 'pending';
    } else if (spStatus === 2 || spStatus === '2') {
      newStatus = 'approved';
      await pool.query(
        'UPDATE warehouse_purchases SET prepay_status = ? WHERE id = ?',
        [newStatus, id]
      );
      // 注：预付款审批通过后不在此处自动核销，需等待收货确认后通过 /writeoff-prepay 手动核销
      // 供应商余额也不在此处更新，避免与核销时重复计算（核销时按实际金额差异更新）
    } else if (spStatus === 3 || spStatus === '3') {
      newStatus = 'rejected';
      await pool.query(
        'UPDATE warehouse_purchases SET prepay_status = ? WHERE id = ?',
        [newStatus, id]
      );
    } else if (spStatus === 4 || spStatus === '4') {
      newStatus = 'revoked';
      await pool.query(
        'UPDATE warehouse_purchases SET prepay_status = ? WHERE id = ?',
        [newStatus, id]
      );
    }

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(freshRows[0]));
  } catch (err) {
    console.error('刷新预付款审批状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 预付款自动核销：货物已收货且预付款已支付时，根据预付与实际金额关系自动核销
// - prepay >= actual：writeoff_status='auto', status='completed'，多付部分计入供应商余额
// - prepay < actual：writeoff_status='manual'（对账中心发起尾款报销）
// 由 /prepay-voucher（回填凭证）和 confirm-submit（收货确认）共同调用，覆盖两种执行顺序
async function autoWriteoffPrepayIfReady(row, connection = null) {
  const actualAmount = computeNetAmount(row);
  const prepayAmount = toNum(row.prepay_amount);
  // 需同时满足：已收货 + 已回填凭证（prepay_status='paid'）+ 尚未核销
  if (actualAmount <= 0 || row.prepay_status !== 'paid' || row.writeoff_status) return false;

  const id = row.id;
  const exec = (sql, params) => (connection ? connection.query(sql, params) : pool.query(sql, params));
  if (prepayAmount >= actualAmount) {
    const diffAmount = prepayAmount - actualAmount;
    await exec(
      `UPDATE warehouse_purchases SET writeoff_status = 'auto', writeoff_amount = ?, status = 'completed' WHERE id = ?`,
      [actualAmount, id]
    );
    if (diffAmount > 0 && row.supplier_id) {
      const [supplierRows] = await exec('SELECT prepay_balance FROM suppliers WHERE id = ?', [row.supplier_id]);
      if (supplierRows.length > 0) {
        const currentBalance = toNum(supplierRows[0].prepay_balance);
        await exec('UPDATE suppliers SET prepay_balance = ? WHERE id = ?', [currentBalance + diffAmount, row.supplier_id]);
      }
    }
  } else {
    await exec(
      `UPDATE warehouse_purchases SET writeoff_status = 'manual', writeoff_amount = ? WHERE id = ?`,
      [prepayAmount, id]
    );
  }
  return true;
}

// 14. POST /:id/prepay-voucher — 回填预付款付款凭证
router.post('/:id/prepay-voucher', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_voucher_no, payment_voucher_at } = req.body;

    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '采购单不存在' });
    }
    const row = rows[0];
    if (row.prepay_status !== 'approved') {
      return res.status(400).json({ error: '预付款审批未通过' });
    }

    await pool.query(
      `UPDATE warehouse_purchases
       SET prepay_status = 'paid',
           prepay_voucher_no = ?,
           prepay_voucher_at = ?
       WHERE id = ?`,
      [payment_voucher_no || null, payment_voucher_at || null, id]
    );

    // 回填凭证后自动核销：若货物已收货，根据预付与实际金额关系自动处理
    row.prepay_status = 'paid';
    await autoWriteoffPrepayIfReady(row);

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(freshRows[0]));
  } catch (err) {
    console.error('回填预付款付款凭证失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14b. POST /:id/auto-writeoff — 手动触发预付款自动核销（幂等，可重复调用）
// 兜底入口：用于历史已回填凭证但 writeoff_status 仍为 NULL 的卡住订单
router.post('/:id/auto-writeoff', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: '采购单不存在' });
    const row = rows[0];
    if (row.purchase_type !== 'prepay') {
      return res.status(400).json({ error: '非预付款采购单' });
    }

    const writeoffDone = await autoWriteoffPrepayIfReady(row);
    if (!writeoffDone) {
      return res.json({
        success: false,
        message: '当前状态不满足自动核销条件（需已收货+已回填凭证+未核销）',
      });
    }
    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json({ success: true, data: normalizePurchaseRow(freshRows[0]) });
  } catch (err) {
    console.error('手动触发自动核销失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /:id/writeoff-prepay — 手动核销预付款
router.post('/:id/writeoff-prepay', requireAuth, async (req, res) => {
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
    if (row.purchase_type !== 'prepay') {
      await connection.rollback();
      return res.status(400).json({ error: '该采购单不是预付款类型' });
    }
    if (row.actual_amount == null || toNum(row.actual_amount) <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: '请先录入收货并完成确认' });
    }
    if (row.writeoff_status === 'auto' || row.writeoff_status === 'manual') {
      await connection.rollback();
      return res.status(400).json({ error: '该采购单已核销，请勿重复操作' });
    }

    const actualAmount = computeNetAmount(row);
    const prepayAmount = toNum(row.prepay_amount);
    let diffAmount = 0;
    let writeoffAmount = prepayAmount;
    let needReimbursement = false; // 核销完成后是否需要发起尾款报销

    if (prepayAmount >= actualAmount) {
      writeoffAmount = actualAmount;
      diffAmount = prepayAmount - actualAmount;
      await connection.query(
        `UPDATE warehouse_purchases
         SET writeoff_status = 'auto', writeoff_amount = ?, status = 'completed'
         WHERE id = ?`,
        [actualAmount, id]
      );
      if (diffAmount > 0 && row.supplier_id) {
        const [supplierRows] = await connection.query(
          'SELECT prepay_balance FROM suppliers WHERE id = ?',
          [row.supplier_id]
        );
        if (supplierRows.length > 0) {
          const currentBalance = toNum(supplierRows[0].prepay_balance);
          await connection.query(
            'UPDATE suppliers SET prepay_balance = ? WHERE id = ?',
            [currentBalance + diffAmount, row.supplier_id]
          );
        }
      }
      await connection.commit();
      return res.json({
        message: `核销完成：预付¥${prepayAmount.toFixed(2)}，实际¥${actualAmount.toFixed(2)}，多付¥${diffAmount.toFixed(2)}已计入供应商余额`,
        diff_amount: diffAmount,
        writeoff_amount: writeoffAmount,
        type: 'overpay',
        need_reimbursement: false,
      });
    } else {
      writeoffAmount = prepayAmount;
      const remainAmount = actualAmount - prepayAmount;
      await connection.query(
        `UPDATE warehouse_purchases
         SET writeoff_status = 'manual', writeoff_amount = ?
         WHERE id = ?`,
        [prepayAmount, id]
      );
      await connection.commit();

      // 核销完成后自动发起尾款报销
      try {
        const [itemRows] = await pool.query(
          `SELECT wpi.*, d.name as department_name
           FROM warehouse_purchase_items wpi
           LEFT JOIN warehouses w ON wpi.warehouse_id = w.id
           LEFT JOIN departments d ON w.department_id = d.id
           WHERE wpi.purchase_id = ? ORDER BY wpi.sort_order ASC, wpi.id ASC`,
          [id]
        );
        const freshRow = { ...row, actual_amount: actualAmount, prepay_amount: prepayAmount };
        const reimbursementSpNo = await submitWarehouseReimbursement(freshRow, itemRows, req.user?.wecom_userid);
        await pool.query(
          'UPDATE warehouse_purchases SET reimbursement_status = ?, reimbursement_sp_no = ?, status = ? WHERE id = ?',
          ['pending', reimbursementSpNo, 'reimbursing', id]
        );
        return res.json({
          message: `核销完成：预付¥${prepayAmount.toFixed(2)}，实际¥${actualAmount.toFixed(2)}，少付¥${remainAmount.toFixed(2)}已自动发起尾款报销`,
          diff_amount: remainAmount,
          writeoff_amount: writeoffAmount,
          type: 'underpay',
          need_reimbursement: true,
          reimbursement_sp_no: reimbursementSpNo,
        });
      } catch (approvalErr) {
        console.error('自动发起尾款报销失败:', approvalErr.message);
        return res.json({
          message: `核销完成：预付¥${prepayAmount.toFixed(2)}，实际¥${actualAmount.toFixed(2)}，少付¥${remainAmount.toFixed(2)}，但自动发起报销失败，请手动处理`,
          diff_amount: remainAmount,
          writeoff_amount: writeoffAmount,
          type: 'underpay',
          need_reimbursement: false,
          reimbursement_error: approvalErr.message,
        });
      }
    }
  } catch (err) {
    await connection.rollback();
    console.error('核销预付款失败:', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ===== 日志缓存与查看接口 =====
// 内存日志缓存（用于前端查看）
const _logCache = [];
const LOG_CACHE_MAX = 500; // 最多保存500条日志

// 包装 console.log 等方法，将日志存入缓存
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;

function addLog(type, ...args) {
  const message = args.map(a => {
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  
  // 只缓存包含关键标记的日志
  if (message.includes('[提交审批]') || 
      message.includes('[企微]') || 
      message.includes('错误') || 
      message.includes('失败') ||
      message.includes('Error') ||
      message.includes('error')) {
    const logEntry = {
      time: new Date().toISOString(),
      type,
      message
    };
    _logCache.push(logEntry);
    if (_logCache.length > LOG_CACHE_MAX) {
      _logCache.shift();
    }
  }
}

console.log = function(...args) {
  origLog.apply(console, args);
  addLog('INFO', ...args);
};
console.error = function(...args) {
  origError.apply(console, args);
  addLog('ERROR', ...args);
};
console.warn = function(...args) {
  origWarn.apply(console, args);
  addLog('WARN', ...args);
};

// GET /logs — 查看最近的系统日志
router.get('/logs', requireAuth, (req, res) => {
  const lines = parseInt(req.query.lines) || 50;
  const type = req.query.type; // 可选：INFO/ERROR/WARN
  let logs = _logCache;
  if (type) {
    logs = logs.filter(l => l.type === type);
  }
  res.json({
    total: _logCache.length,
    logs: logs.slice(-lines)
  });
});

// ================================================
// 8. 采购退货单（P1）
//    draft → submitted → confirmed → completed
//                       ↘ voided
// ================================================

const RETURNABLE_PURCHASE_STATUSES = ['received', 'confirming', 'confirmed', 'reimbursing', 'reimbursed'];
const ACTIVE_RETURN_STATUSES = ['submitted', 'confirmed', 'completed'];

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function genReturnNo() {
  const d = new Date();
  const p = (v, l = 2) => String(v).padStart(l, '0');
  return `TH${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

function isAdminUser(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return roles.includes('admin');
}

/**
 * 派生付款状态（只读，不允许手工写）
 * 业务依据（勿按「未知即危险」再收紧）：
 *  - 企微付款申请可以撤销，能撤销就说明一定还没付款；已付款的场景不会发生退货。
 *  - 因此「未知」在业务上等同「未付款」，只用于展示，不阻塞退货完成与报销重发。
 *  - 只有系统能明确查到付款记录时才判定 paid，并据此拦截（禁止重发、完成退货需退款凭证）。
 *  - 月结：monthly_paid_at 非空即已付
 *  - 预付：prepay_status='paid'（回填付款凭证后才会置 paid）即已付
 *  - 普通报销：已撤销直接视为未付款；否则按当前报销单号查支付记录，查不到返回 unknown（不阻塞）
 */
async function derivePaymentState(exec, purchase) {
  if (purchase.purchase_type === 'monthly') {
    return purchase.monthly_paid_at ? 'paid' : 'unpaid';
  }
  if (purchase.purchase_type === 'prepay') {
    return purchase.prepay_status === 'paid' ? 'paid' : 'unpaid';
  }
  // 撤销场景（reimbursement_status='revoked'）直接视同未付款
  if (purchase.reimbursement_status === 'revoked') return 'unpaid';
  if (!purchase.reimbursement_sp_no) return 'unpaid';
  const [rows] = await exec.query(
    'SELECT payment_status FROM wecom_expense_payments WHERE sp_no = ? LIMIT 1',
    [purchase.reimbursement_sp_no]
  );
  if (rows.length === 0) return 'unknown';
  return rows[0].payment_status === 'paid' ? 'paid' : 'unpaid';
}

/**
 * 计算本次退货明细金额：
 *   按原明细 received_amount 数量比例拆分，四舍五入到分，最后一笔取剩余
 *   —— 通过「累计到本次的应退金额 - 之前已退金额」自然获得尾差归属
 * @param {Array<{purchase_item_id:string, quantity:number}>} lines
 * @param {string|null} excludeReturnId 确认时排除本单（本单尚未计入已确认统计）
 */
async function buildReturnItemAmounts(exec, purchaseId, lines, excludeReturnId = null) {
  const ids = [...new Set(lines.map((l) => l.purchase_item_id).filter(Boolean))];
  if (ids.length === 0) return [];

  const [itemRows] = await exec.query(
    `SELECT id, item_id, item_name, spec, unit, warehouse_id, received_quantity, received_amount,
            received_unit_price, requested_quantity, requested_unit_price
     FROM warehouse_purchase_items
     WHERE purchase_id = ? AND id IN (?)`,
    [purchaseId, ids]
  );
  const itemMap = new Map(itemRows.map((r) => [r.id, r]));

  const aggSql = `SELECT ri.purchase_item_id, SUM(ri.quantity) AS qty, SUM(ri.amount) AS amt
                  FROM warehouse_purchase_return_items ri
                  INNER JOIN warehouse_purchase_returns r ON r.id = ri.return_id
                  WHERE r.status IN ('confirmed', 'completed') AND r.purchase_id = ?
                  ${excludeReturnId ? 'AND r.id <> ?' : ''}
                  GROUP BY ri.purchase_item_id`;
  const [aggRows] = await exec.query(aggSql, excludeReturnId ? [purchaseId, excludeReturnId] : [purchaseId]);
  const aggMap = new Map(aggRows.map((r) => [r.purchase_item_id, { qty: Number(r.qty) || 0, amt: Number(r.amt) || 0 }]));

  const result = [];
  const pendingQty = new Map(); // 同一请求内同明细的累计

  for (const line of lines) {
    const item = itemMap.get(line.purchase_item_id);
    if (!item) {
      const err = new Error('退货明细不属于该采购单');
      err.httpStatus = 400;
      throw err;
    }
    const qty = round3(line.quantity);
    if (!(qty > 0)) {
      const err = new Error(`物资「${item.item_name || ''}」退货数量必须大于 0`);
      err.httpStatus = 400;
      throw err;
    }

    const receivedQty = Number(item.received_quantity) || 0;
    const receivedAmount = Number(item.received_amount) || 0;
    const agg = aggMap.get(item.id) || { qty: 0, amt: 0 };
    const alreadyPending = pendingQty.get(item.id) || 0;

    if (receivedQty <= 0) {
      const err = new Error(`物资「${item.item_name || ''}」尚未收货，不能退货`);
      err.httpStatus = 400;
      throw err;
    }
    if (agg.qty + alreadyPending + qty > receivedQty + 0.0005) {
      const err = new Error(`物资「${item.item_name || ''}」累计退货数量超过实收数量`);
      err.httpStatus = 400;
      throw err;
    }

    // 累计到本次应退金额 - 之前已退金额 = 本笔金额（最后一笔自动吸收尾差）
    const cumQty = agg.qty + alreadyPending + qty;
    const cumAmount = Math.round((receivedAmount * cumQty / receivedQty) * 100) / 100;
    const amount = Math.max(0, Math.round((cumAmount - agg.amt) * 100) / 100);
    pendingQty.set(item.id, alreadyPending + qty);

    const unitPrice = receivedQty > 0
      ? Math.round((receivedAmount / receivedQty) * 100) / 100
      : (Number(item.received_unit_price) || Number(item.requested_unit_price) || 0);

    result.push({ item, qty, amount, unitPrice });
  }

  return result;
}

async function insertReturnMovement(exec, {
  warehouseId, itemId, itemName, movementType, quantity, unit, unitPrice, totalAmount,
  reason, relatedId, operatorId, operatorName, departmentId, departmentName,
}) {
  await exec.query(
    `INSERT INTO stock_movements
     (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount,
      reason, related_type, related_id, operator_id, operator_name, department_id, department_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'purchase_return', ?, ?, ?, ?, ?)`,
    [uuidv4(), warehouseId, itemId, itemName, movementType, quantity, unit, unitPrice, totalAmount,
     reason, relatedId, operatorId, operatorName, departmentId || null, departmentName]
  );
}

/**
 * 退货确认群消息（失败不影响主流程）
 */
async function sendReturnGroupMessage(purchase, returnRow, items, operatorName) {
  try {
    const config = await getWecomConfig();
    const webhookUrl = config?.webhook_url || config?.test_webhook_url;
    if (!webhookUrl) return;

    const itemLines = items.map((it) =>
      `> ${it.item_name || ''} ${Number(it.quantity)}${it.unit || ''}　¥${(Number(it.amount) || 0).toFixed(2)}`
    ).join('\n');

    const content = [
      '**采购退货已确认**',
      `> 采购单号：${purchase.purchase_no || purchase.id}`,
      `> 退货单号：${returnRow.return_no}`,
      itemLines,
      `> 退货金额：¥${(Number(returnRow.total_amount) || 0).toFixed(2)}`,
      `> 退货后净额：¥${(Number(returnRow.net_amount) || 0).toFixed(2)}`,
      `> 操作人：${operatorName || '-'}`,
      `> 时间：${new Date().toLocaleString('zh-CN')}`,
    ].filter(Boolean).join('\n');

    await sendTextViaWebhook(webhookUrl, content);
  } catch (err) {
    console.error('[采购退货] 群消息发送失败（不影响主流程）:', err.message);
  }
}

// 8.1 POST /:id/returns — 创建退货单（草稿/提交）
router.post('/:id/returns', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { items, remark, submit } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '请选择退货明细' });
    }
    const lineItemIds = items.map((it) => it && it.purchase_item_id).filter(Boolean);
    if (new Set(lineItemIds).size !== lineItemIds.length) {
      return res.status(400).json({ error: '同一物资不能重复提交退货明细' });
    }

    const [pRows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    if (pRows.length === 0) return res.status(404).json({ error: '采购单不存在' });
    const purchase = pRows[0];

    if (!RETURNABLE_PURCHASE_STATUSES.includes(purchase.status)) {
      return res.status(400).json({ error: '当前采购单状态不允许退货' });
    }
    if (!isAdminUser(req) && purchase.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权操作该采购单' });
    }

    const computed = await buildReturnItemAmounts(connection, purchase.id, items);
    if (computed.length === 0) return res.status(400).json({ error: '请选择退货明细' });

    const returnId = uuidv4();
    const returnNo = genReturnNo();
    const status = submit === false ? 'draft' : 'submitted';
    const totalQty = computed.reduce((s, x) => s + x.qty, 0);
    const totalAmount = Math.round(computed.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const operatorId = req.user?.id || null;
    const operatorName = req.user?.name || null;

    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO warehouse_purchase_returns
       (id, return_no, purchase_id, purchase_no, warehouse_id, warehouse_name, status,
        total_quantity, total_amount, payment_state, remark, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
      [returnId, returnNo, purchase.id, purchase.purchase_no, purchase.warehouse_id, purchase.warehouse_name,
       status, totalQty, totalAmount, remark || null, operatorId, operatorName]
    );
    for (const line of computed) {
      await connection.query(
        `INSERT INTO warehouse_purchase_return_items
         (id, return_id, purchase_item_id, item_id, item_name, spec, unit, warehouse_id,
          quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), returnId, line.item.id, line.item.item_id, line.item.item_name, line.item.spec, line.item.unit,
         line.item.warehouse_id, line.qty, line.unitPrice, line.amount]
      );
    }
    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM warehouse_purchase_returns WHERE id = ?', [returnId]);
    const [itemRows] = await pool.query('SELECT * FROM warehouse_purchase_return_items WHERE return_id = ?', [returnId]);
    res.json({ ...rows[0], items: itemRows });
  } catch (err) {
    await connection.rollback();
    console.error('创建退货单失败:', err);
    res.status(err.httpStatus || 500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 8.2 GET /:id/returns — 查询该采购单的退货记录
router.get('/:id/returns', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [returns] = await pool.query(
      'SELECT * FROM warehouse_purchase_returns WHERE purchase_id = ? ORDER BY created_at DESC',
      [id]
    );
    let items = [];
    if (returns.length > 0) {
      [items] = await pool.query(
        'SELECT * FROM warehouse_purchase_return_items WHERE return_id IN (?) ORDER BY created_at ASC',
        [returns.map((r) => r.id)]
      );
    }
    const byReturn = new Map(returns.map((r) => [r.id, []]));
    items.forEach((it) => {
      if (byReturn.has(it.return_id)) byReturn.get(it.return_id).push(it);
    });
    res.json(returns.map((r) => ({ ...r, items: byReturn.get(r.id) })));
  } catch (err) {
    console.error('查询退货记录失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8.3 POST /returns/:returnId/confirm — 管理员确认退货（扣库存 / 写流水）
router.post('/returns/:returnId/confirm', requireAuth, async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: '仅管理员可确认退货' });
  }
  const connection = await pool.getConnection();
  let committed = false;
  try {
    const { returnId } = req.params;
    await connection.beginTransaction();

    // 锁顺序：退货单头 → 采购单头 → 明细（按明细 id 升序）→ 库存行（按仓库+物资升序）
    const [rRows] = await connection.query('SELECT * FROM warehouse_purchase_returns WHERE id = ? FOR UPDATE', [returnId]);
    if (rRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '退货单不存在' });
    }
    const returnRow = rRows[0];
    if (!['draft', 'submitted'].includes(returnRow.status)) {
      await connection.rollback();
      return res.status(400).json({ error: '当前退货单状态不可确认' });
    }

    const [pRows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ? FOR UPDATE', [returnRow.purchase_id]);
    if (pRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    const purchase = pRows[0];
    if (!RETURNABLE_PURCHASE_STATUSES.includes(purchase.status)) {
      await connection.rollback();
      return res.status(400).json({ error: '采购单当前状态不允许退货' });
    }

    const [returnItems] = await connection.query(
      `SELECT ri.*, wpi.received_quantity, wpi.received_amount, wpi.item_name AS wpi_item_name
       FROM warehouse_purchase_return_items ri
       INNER JOIN warehouse_purchase_items wpi ON wpi.id = ri.purchase_item_id
       WHERE ri.return_id = ?
       ORDER BY wpi.id ASC`,
      [returnId]
    );
    if (returnItems.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '退货单没有明细' });
    }
    const uniqueItemIds = new Set(returnItems.map((it) => it.purchase_item_id));
    if (uniqueItemIds.size !== returnItems.length) {
      await connection.rollback();
      return res.status(409).json({ error: '退货单存在重复物资明细，请作废后重新创建' });
    }

    // 金额重算（以已确认退货为基准，保证尾差归属正确）
    const recomputed = await buildReturnItemAmounts(
      connection,
      purchase.id,
      returnItems.map((it) => ({ purchase_item_id: it.purchase_item_id, quantity: Number(it.quantity) })),
      returnId
    );
    const amountByItem = new Map(recomputed.map((x) => [x.item.id, x]));

    const operatorId = req.user?.id || null;
    const operatorName = req.user?.name || null;
    let totalAmount = 0;
    let totalQty = 0;

    // 阶段一：按明细 id 升序做行级累计原子校验（锁 warehouse_purchase_items）
    const itemsById = [...returnItems].sort((a, b) => String(a.purchase_item_id).localeCompare(String(b.purchase_item_id)));
    for (const ri of itemsById) {
      const calc = amountByItem.get(ri.purchase_item_id);
      if (!calc) {
        const err = new Error('退货明细数据异常');
        err.httpStatus = 400;
        throw err;
      }
      const [upd] = await connection.query(
        `UPDATE warehouse_purchase_items
         SET returned_quantity = returned_quantity + ?
         WHERE id = ? AND returned_quantity + ? <= received_quantity`,
        [calc.qty, ri.purchase_item_id, calc.qty]
      );
      if (upd.affectedRows !== 1) {
        const err = new Error(`物资「${ri.item_name || ''}」累计退货数量超过实收数量`);
        err.httpStatus = 400;
        throw err;
      }
    }

    // 阶段二：按「仓库 + 物资」升序处理库存与流水，固定锁顺序避免死锁
    const stockItems = [...returnItems].sort((a, b) => {
      const wa = String(a.warehouse_id || '');
      const wb = String(b.warehouse_id || '');
      if (wa !== wb) return wa.localeCompare(wb);
      return String(a.item_id || '').localeCompare(String(b.item_id || ''));
    });
    for (const ri of stockItems) {
      const calc = amountByItem.get(ri.purchase_item_id);
      const qty = calc.qty;
      const amount = calc.amount;

      // 即采即用判定：原采购入库时存在 expense 流水
      const [expRows] = await connection.query(
        `SELECT id, warehouse_id, department_id, department_name
         FROM stock_movements
         WHERE related_type = 'purchase' AND related_id = ? AND item_id = ? AND movement_type = 'expense'
         ORDER BY created_at ASC LIMIT 1`,
        [purchase.id, ri.item_id]
      );
      const isInstant = expRows.length > 0;
      const flowRow = expRows[0] || {};
      const warehouseId = ri.warehouse_id || flowRow.warehouse_id || purchase.warehouse_id;

      if (isInstant) {
        // 即采即用：只写 expense（quantity 为正、金额为负），不动 inventory
        await insertReturnMovement(connection, {
          warehouseId,
          itemId: ri.item_id,
          itemName: ri.item_name,
          movementType: 'expense',
          quantity: qty,
          unit: ri.unit,
          unitPrice: calc.unitPrice,
          totalAmount: -amount,
          reason: `采购退货（即采即用冲减） ${returnRow.return_no}`,
          relatedId: returnId,
          operatorId,
          operatorName,
          departmentId: flowRow.department_id,
          departmentName: flowRow.department_name,
        });
      } else {
        // 普通物资：校验当前库存充足后扣减
        const [invRows] = await connection.query(
          'SELECT id, quantity FROM inventory WHERE warehouse_id = ? AND item_id = ? FOR UPDATE',
          [warehouseId, ri.item_id]
        );
        const stockQty = invRows.length > 0 ? Number(invRows[0].quantity) || 0 : 0;
        if (stockQty + 0.0005 < qty) {
          const err = new Error(`物资「${ri.item_name || ''}」库存不足，当前库存 ${stockQty}，本次退货 ${qty}`);
          err.httpStatus = 400;
          throw err;
        }
        if (invRows.length > 0) {
          await connection.query(
            'UPDATE inventory SET quantity = quantity - ? WHERE warehouse_id = ? AND item_id = ?',
            [qty, warehouseId, ri.item_id]
          );
        }
        await insertReturnMovement(connection, {
          warehouseId,
          itemId: ri.item_id,
          itemName: ri.item_name,
          movementType: 'return',
          quantity: -qty,
          unit: ri.unit,
          unitPrice: calc.unitPrice,
          totalAmount: -amount,
          reason: `采购退货 ${returnRow.return_no}`,
          relatedId: returnId,
          operatorId,
          operatorName,
          departmentId: flowRow.department_id,
          departmentName: flowRow.department_name,
        });
      }

      await connection.query(
        'UPDATE warehouse_purchase_return_items SET amount = ?, unit_price = ?, is_instant = ? WHERE id = ?',
        [amount, calc.unitPrice, isInstant ? 1 : 0, ri.id]
      );
      totalAmount += amount;
      totalQty += qty;
    }

    totalAmount = Math.round(totalAmount * 100) / 100;
    totalQty = round3(totalQty);

    // 订单级上限：累计退货金额不得超过实收金额（atomic）
    const [capUpd] = await connection.query(
      `UPDATE warehouse_purchases
       SET returned_amount = returned_amount + ?
       WHERE id = ?
         AND returned_amount + ? <= (CASE WHEN IFNULL(actual_amount, 0) > 0 THEN actual_amount ELSE IFNULL(total_amount, 0) END)`,
      [totalAmount, purchase.id, totalAmount]
    );
    if (capUpd.affectedRows !== 1) {
      const err = new Error('累计退货金额超过实收金额');
      err.httpStatus = 400;
      throw err;
    }

    const paymentState = await derivePaymentState(connection, purchase);
    const [freshRows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [purchase.id]);
    const netAmount = computeNetAmount(freshRows[0]);

    await connection.query(
      `UPDATE warehouse_purchase_returns
       SET status = 'confirmed', total_quantity = ?, total_amount = ?, net_amount = ?, payment_state = ?,
           confirmed_by = ?, confirmed_by_name = ?, confirmed_at = NOW()
       WHERE id = ?`,
      [totalQty, totalAmount, netAmount, paymentState, operatorId, operatorName, returnId]
    );

    await connection.commit();
    committed = true;

    const [freshReturn] = await pool.query('SELECT * FROM warehouse_purchase_returns WHERE id = ?', [returnId]);
    const [freshItems] = await pool.query('SELECT * FROM warehouse_purchase_return_items WHERE return_id = ?', [returnId]);
    const [freshPurchase] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [purchase.id]);

    await sendReturnGroupMessage(freshPurchase[0], freshReturn[0], freshItems, operatorName);

    res.json({
      ...freshReturn[0],
      items: freshItems,
      purchase: normalizePurchaseRow(freshPurchase[0]),
    });
  } catch (err) {
    if (!committed) await connection.rollback();
    console.error('确认退货失败:', err);
    res.status(err.httpStatus || 500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 8.4 POST /returns/:returnId/void — 作废退货单
router.post('/returns/:returnId/void', requireAuth, async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: '仅管理员可作废退货单' });
  }
  const connection = await pool.getConnection();
  try {
    const { returnId } = req.params;
    const { reason } = req.body || {};
    await connection.beginTransaction();

    const [rRows] = await connection.query('SELECT * FROM warehouse_purchase_returns WHERE id = ? FOR UPDATE', [returnId]);
    if (rRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '退货单不存在' });
    }
    const returnRow = rRows[0];
    if (returnRow.status === 'completed') {
      await connection.rollback();
      return res.status(400).json({ error: '已完成的退货单禁止作废' });
    }
    if (returnRow.status === 'voided') {
      await connection.rollback();
      return res.status(400).json({ error: '退货单已作废' });
    }

    const [pRows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ? FOR UPDATE', [returnRow.purchase_id]);
    if (pRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    const purchase = pRows[0];
    const operatorId = req.user?.id || null;
    const operatorName = req.user?.name || null;

    // 付款状态实时派生，避免确认后采购单才付款导致漏判
    const currentPaymentState = await derivePaymentState(connection, purchase);
    if (returnRow.settlement_ref || returnRow.payment_state === 'paid' || currentPaymentState === 'paid') {
      await connection.rollback();
      return res.status(400).json({ error: '已付款或已登记退款/抵扣凭证的退货单禁止作废' });
    }

    // 已确认的退货需要整单反向冲回
    if (returnRow.status === 'confirmed') {
      const [items] = await connection.query(
        'SELECT * FROM warehouse_purchase_return_items WHERE return_id = ? ORDER BY purchase_item_id ASC',
        [returnId]
      );

      for (const it of items) {
        const qty = Number(it.quantity) || 0;
        const amount = Number(it.amount) || 0;

        // 原子扣减累计已退数量
        const [qtyUpd] = await connection.query(
          `UPDATE warehouse_purchase_items
           SET returned_quantity = returned_quantity - ?
           WHERE id = ? AND returned_quantity >= ?`,
          [qty, it.purchase_item_id, qty]
        );
        if (qtyUpd.affectedRows !== 1) {
          const err = new Error('冲回累计退货数量失败，请人工核对');
          err.httpStatus = 409;
          throw err;
        }

        if (Number(it.is_instant) === 1) {
          // 即采即用：反向 expense（quantity 为负、金额为正）
          await insertReturnMovement(connection, {
            warehouseId: it.warehouse_id,
            itemId: it.item_id,
            itemName: it.item_name,
            movementType: 'expense',
            quantity: -qty,
            unit: it.unit,
            unitPrice: it.unit_price,
            totalAmount: amount,
            reason: `采购退货作废冲回（即采即用） ${returnRow.return_no}`,
            relatedId: returnId,
            operatorId,
            operatorName,
            departmentId: it.department_id,
            departmentName: it.department_name,
          });
        } else {
          // 普通物资：反向 return 流水（数量/金额为正）并恢复库存
          await insertReturnMovement(connection, {
            warehouseId: it.warehouse_id,
            itemId: it.item_id,
            itemName: it.item_name,
            movementType: 'return',
            quantity: qty,
            unit: it.unit,
            unitPrice: it.unit_price,
            totalAmount: amount,
            reason: `采购退货作废冲回 ${returnRow.return_no}`,
            relatedId: returnId,
            operatorId,
            operatorName,
            departmentId: it.department_id,
            departmentName: it.department_name,
          });
          const [invRows] = await connection.query(
            'SELECT id FROM inventory WHERE warehouse_id = ? AND item_id = ? FOR UPDATE',
            [it.warehouse_id, it.item_id]
          );
          if (invRows.length > 0) {
            await connection.query(
              'UPDATE inventory SET quantity = quantity + ? WHERE warehouse_id = ? AND item_id = ?',
              [qty, it.warehouse_id, it.item_id]
            );
          } else {
            await connection.query(
              'INSERT INTO inventory (id, warehouse_id, item_id, quantity, unit) VALUES (?, ?, ?, ?, ?)',
              [uuidv4(), it.warehouse_id, it.item_id, qty, it.unit]
            );
          }
        }
      }

      // 订单级累计金额回退
      const [amtUpd] = await connection.query(
        `UPDATE warehouse_purchases
         SET returned_amount = returned_amount - ?
         WHERE id = ? AND returned_amount >= ?`,
        [returnRow.total_amount, purchase.id, returnRow.total_amount]
      );
      if (amtUpd.affectedRows !== 1) {
        const err = new Error('冲回累计退货金额失败，请人工核对');
        err.httpStatus = 409;
        throw err;
      }
    }

    await connection.query(
      `UPDATE warehouse_purchase_returns
       SET status = 'voided', voided_by = ?, voided_by_name = ?, voided_at = NOW(), void_reason = ?
       WHERE id = ? AND status IN ('draft', 'submitted', 'confirmed')`,
      [operatorId, operatorName, reason || null, returnId]
    );

    await connection.commit();
    const [fresh] = await pool.query('SELECT * FROM warehouse_purchase_returns WHERE id = ?', [returnId]);
    res.json(fresh[0]);
  } catch (err) {
    await connection.rollback();
    console.error('作废退货单失败:', err);
    res.status(err.httpStatus || 500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 8.5 POST /returns/:returnId/complete — 完成退货（付款状态未知时禁止）
router.post('/returns/:returnId/complete', requireAuth, async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: '仅管理员可完成退货单' });
  }
  const connection = await pool.getConnection();
  try {
    const { returnId } = req.params;
    await connection.beginTransaction();

    const [rRows] = await connection.query('SELECT * FROM warehouse_purchase_returns WHERE id = ? FOR UPDATE', [returnId]);
    if (rRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '退货单不存在' });
    }
    const returnRow = rRows[0];
    if (returnRow.status !== 'confirmed') {
      await connection.rollback();
      return res.status(400).json({ error: '只有已确认的退货单可以完成' });
    }

    const [pRows] = await connection.query('SELECT * FROM warehouse_purchases WHERE id = ?', [returnRow.purchase_id]);
    if (pRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: '采购单不存在' });
    }
    const paymentState = await derivePaymentState(connection, pRows[0]);
    // 业务依据：撤销的付款申请一定未付款，unknown 也按未付款处理，均不阻塞完成；
    // 仅当明确查到已付款时，才要求先登记退款/抵扣凭证。
    if (paymentState === 'paid' && !returnRow.settlement_ref) {
      await connection.rollback();
      return res.status(400).json({ error: '已付款退货请先登记退款/抵扣凭证号，再完成退货' });
    }

    await connection.query(
      `UPDATE warehouse_purchase_returns
       SET status = 'completed', payment_state = ?, completed_by = ?, completed_by_name = ?, completed_at = NOW()
       WHERE id = ? AND status = 'confirmed'`,
      [paymentState, req.user?.id || null, req.user?.name || null, returnId]
    );

    await connection.commit();
    const [fresh] = await pool.query('SELECT * FROM warehouse_purchase_returns WHERE id = ?', [returnId]);
    res.json(fresh[0]);
  } catch (err) {
    await connection.rollback();
    console.error('完成退货单失败:', err);
    res.status(err.httpStatus || 500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// 8.6 PUT /returns/:returnId/settlement — 登记退款/抵扣凭证号（已付款退货完成前置）
router.put('/returns/:returnId/settlement', requireAuth, async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: '仅管理员可登记退款/抵扣凭证' });
  }
  try {
    const { returnId } = req.params;
    const { settlement_ref } = req.body || {};
    if (!settlement_ref || !String(settlement_ref).trim()) {
      return res.status(400).json({ error: '请填写退款/抵扣凭证号' });
    }
    const [rows] = await pool.query('SELECT * FROM warehouse_purchase_returns WHERE id = ?', [returnId]);
    if (rows.length === 0) return res.status(404).json({ error: '退货单不存在' });
    if (rows[0].status === 'voided') return res.status(400).json({ error: '已作废的退货单不能登记凭证' });

    await pool.query(
      'UPDATE warehouse_purchase_returns SET settlement_ref = ? WHERE id = ?',
      [String(settlement_ref).trim(), returnId]
    );
    const [fresh] = await pool.query('SELECT * FROM warehouse_purchase_returns WHERE id = ?', [returnId]);
    res.json(fresh[0]);
  } catch (err) {
    console.error('登记退款凭证失败:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
