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
  const reimburseAmount = toNum(row.actual_amount) || toNum(row.total_amount);
  const monthDayStr = `${orderDate.getMonth() + 1}月${orderDate.getDate()}日`;
  const reason = `${monthDayStr}仓库采购单，实际入库¥${reimburseAmount.toFixed(2)}`;

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
    amount: toNum(row.actual_amount) || toNum(row.total_amount),
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
  doc.text(`采购单号：${row.purchase_no || '-'}    仓库：${whNames.join('、') || '-'}    申请金额：¥${amountLabel.toFixed(2)}    状态：${statusText}`);
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

  // 表头与列宽（物资名称/规格/单价/数量/单位/金额/理由）
  const headers = ['物资名称', '规格', '单价/单位', '数量', '单位', '金额', '理由'];
  const colWidths = [
    tableWidth * 0.22,
    tableWidth * 0.15,
    tableWidth * 0.13,
    tableWidth * 0.06,
    tableWidth * 0.06,
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
      const spec = item.spec || '';
      const unit = item.requested_unit || '';
      const reason = item.reason || '';
      const cells = [
        item.item_name,
        spec,
        `${price.toFixed(2)}/${unit}`,
        String(qty),
        unit,
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
  // 汇总涉及仓库
  const pdfWarehouseNames = Array.from(new Set(itemRows.map(i => i.warehouse_name).filter(Boolean)));
  doc.text(`采购单号：${row.purchase_no || '-'}    仓库：${pdfWarehouseNames.join('、') || '-'}    金额：¥${amountLabel.toFixed(2)}    状态：${statusLabel}`);
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
      const spec = hasReceived ? (item.received_spec || item.spec || '') : (item.spec || '');
      const unit = hasReceived ? (item.received_unit || item.requested_unit || '') : (item.requested_unit || '');
      const itemName = notArrived ? `${item.item_name}（未到货）` : item.item_name;
      const qtyDisplay = notArrived ? '0' : String(qty);
      const amtDisplay = notArrived ? '¥0.00' : `¥${amt.toFixed(2)}`;
      const cells = [
        itemName,
        spec,
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
    const { status, warehouse_id, page = 1, page_size = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, parseInt(page_size, 10) || 20);
    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const params = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (warehouse_id) { conditions.push('warehouse_id = ?'); params.push(warehouse_id); }
    // 非管理员只能看到自己创建的采购单
    const userRole = req.user?.role;
    if (userRole !== 'admin') {
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
      // 1. 生成 PDF（确认单）
      let pdfUrl = row.pdf_url;
      try {
        await generateWarehousePDF(id);
        pdfUrl = `/api/warehouse-purchases/${id}/pdf?type=confirm`;
        await connection.query('UPDATE warehouse_purchases SET pdf_url = ?, status = ? WHERE id = ?', [pdfUrl, 'confirmed', id]);
      } catch (pdfErr) {
        console.error('仓库采购PDF生成失败:', pdfErr.message);
        await connection.query('UPDATE warehouse_purchases SET status = ? WHERE id = ?', ['confirmed', id]);
      }

      // 2. 发起报销审批
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
      await connection.query(
        `INSERT INTO warehouse_purchase_items
         (id, purchase_id, item_id, item_name, category_name, spec, department_id, department_name,
          warehouse_id, warehouse_name,
          requested_quantity, requested_unit, requested_unit_price, requested_amount, reason, sort_order,
          instant_use_override)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      await connection.query(
        `INSERT INTO warehouse_purchase_items
         (id, purchase_id, item_id, item_name, category_name, spec, department_id, department_name,
          warehouse_id, warehouse_name,
          requested_quantity, requested_unit, requested_unit_price, requested_amount, reason, sort_order,
          instant_use_override)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    const config = await getWecomConfig();
    if (!config) return res.status(400).json({ error: '企业微信未配置' });

    console.log(`[刷新采购审批] 查询审批详情: sp_no=${row.approval_sp_no}`);
    const detail = await getApprovalDetail(config, row.approval_sp_no);
    console.log(`[刷新采购审批] 原始响应:`, JSON.stringify(detail).substring(0, 500));
    
    // 企微API返回结构: { errcode, errmsg, info: { sp_status, ... } }
    const spStatus = detail?.info?.sp_status ?? detail?.sp_status;
    console.log(`[刷新采购审批] sp_status=${spStatus} (类型: ${typeof spStatus})`);
    // sp_status: 1=审批中，2=已通过，3=已驳回，4=已撤销

    let newStatus = row.status;
    let newApprovalStatus = row.approval_status || 'pending';

    if (spStatus === 1 || spStatus === '1') {
      newApprovalStatus = 'pending';
    } else if (spStatus === 2 || spStatus === '2') {
      // 采购审批通过：预付款订单直接进入 confirmed 状态（允许收货），不受预付款审批状态影响
      if (row.purchase_type === 'prepay') {
        newStatus = 'confirmed';
      } else {
        newStatus = 'approved';
      }
      newApprovalStatus = 'approved';
    } else if (spStatus === 3 || spStatus === '3') {
      newStatus = 'rejected';
      newApprovalStatus = 'rejected';
    } else if (spStatus === 4 || spStatus === '4') {
      newStatus = 'draft';
      newApprovalStatus = 'canceled';
    }

    await pool.query(
      'UPDATE warehouse_purchases SET status = ?, approval_status = ? WHERE id = ?',
      [newStatus, newApprovalStatus, id]
    );

    const [fresh] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    console.log(`[刷新采购审批] ${id}: spStatus=${spStatus} -> status=${newStatus}, approval=${newApprovalStatus}`);
    res.json(normalizePurchaseRow(fresh[0]));
  } catch (err) {
    console.error('刷新采购审批状态失败:', err);
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
    const purchaseRow = rows[0];
    if (purchaseRow.status !== 'approved') {
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

      // upsert inventory
      const [existingInv] = await connection.query(
        'SELECT id FROM inventory WHERE warehouse_id = ? AND item_id = ?',
        [ri.warehouse_id, ri.item_id]
      );
      if (existingInv.length > 0) {
        await connection.query(
          'UPDATE inventory SET quantity = quantity + ?, unit = ? WHERE warehouse_id = ? AND item_id = ?',
          [rQty, rUnit, ri.warehouse_id, ri.item_id]
        );
      } else {
        await connection.query(
          'INSERT INTO inventory (id, warehouse_id, item_id, quantity, unit) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), ri.warehouse_id, ri.item_id, rQty, rUnit]
        );
      }

      // 即采即用：自动出库归零，成本归集到部门
      if (isInstantUse) {
        await connection.query(
          `INSERT INTO stock_movements
           (id, warehouse_id, item_id, item_name, movement_type, quantity, unit, unit_price, total_amount,
            reason, related_type, related_id, operator_id, operator_name, department_id, department_name)
           VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 'purchase', ?, ?, ?, ?, ?)`,
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
    const totalAmount = toNum(row.actual_amount) || toNum(row.total_amount);

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

    // 对每个确认人发送模板卡片（逐人发送，touser 为单个 userid）
    const sentToUsers = [];
    const failedUsers = [];
    const sentResponseCodes = []; // { userid, responseCode }
    if (hasApiConfig) {
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

    // 如果没有匹配到任何确认人：群消息仍发送，但不自动确认，提示用户去配置确认人
    if (!hasConfirmers) {
      await connection.query(
        'UPDATE warehouse_purchases SET wecom_msg_id = ?, user_departments = ?, user_confirmations = ? WHERE id = ?',
        [wecomMsgId, JSON.stringify({}), JSON.stringify({}), id]
      );
      await connection.commit();
      const tip = '已发送群消息，但未匹配到任何确认人。请在「仓库管理」或「部门管理」中为相关仓库/部门配置确认人（企业微信userid）后再发送确认通知。';
      res.json({
        success: true,
        message: tip,
        wecom_msg_id: wecomMsgId,
        sent_to_users: [],
        failed_users: [],
        user_departments: {},
        auto_confirmed: false,
        no_confirmer: true,
      });
    } else {
      await connection.query(
        'UPDATE warehouse_purchases SET wecom_msg_id = ?, user_departments = ?, user_confirmations = ?, status = ? WHERE id = ?',
        [wecomMsgId, JSON.stringify(userDepartmentsMap), JSON.stringify({}), 'confirming', id]
      );

      await connection.commit();

      // 如果未配置企微应用信息，补充提示
      let extraMsg = '';
      if (!hasApiConfig) {
        extraMsg = '（未配置企微应用 corp_id/app_secret/agent_id，未发送个人应用消息，仅发送了群消息）';
      }

      res.json({
        success: true,
        message: `确认通知已发送${extraMsg}`,
        wecom_msg_id: wecomMsgId,
        sent_to_users: sentToUsers,
        failed_users: failedUsers,
        user_departments: userDepartmentsMap,
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
    // 允许两种场景：1) 首次发起报销（status=confirmed 且无 reimbursement_sp_no）；2) 报销被拒绝后重新发起
    const isFirstTime = row.status === 'confirmed' && !row.reimbursement_sp_no;
    const isResubmit = row.reimbursement_status === 'rejected';
    if (!isFirstTime && !isResubmit) {
      return res.status(400).json({ error: '只有已确认未报销或报销被拒绝的采购单可以发起报销' });
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

// ================================================
// 预付款相关接口
// ================================================

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

    // 处理手动上传的附件（base64 → 保存文件 → 上传企微获取 mediaId）
    const { attachments: rawAttachments = [] } = req.body;
    const uploadedAttachments = []; // 传给 buildWarehouseApplyData 的 [{filename, mediaId}]
    const savedAttachments = [];     // 持久化到 DB 的 [{filename, path, mime, size}]

    if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
      const attachDir = path.join(__dirname, '..', 'uploads', 'prepay_attachments', id);
      if (!fs.existsSync(attachDir)) {
        fs.mkdirSync(attachDir, { recursive: true });
      }
      for (let i = 0; i < rawAttachments.length; i++) {
        const att = rawAttachments[i];
        if (!att.filename || !att.base64) continue;
        try {
          const fileBuffer = Buffer.from(att.base64, 'base64');
          const safeFilename = String(att.filename).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
          const savePath = path.join(attachDir, `${Date.now()}_${i}_${safeFilename}`);
          fs.writeFileSync(savePath, fileBuffer);
          const mimeType = att.mimeType || 'application/octet-stream';
          const mediaId = await uploadMedia(config, savePath, safeFilename);
          uploadedAttachments.push({ filename: safeFilename, mediaId });
          savedAttachments.push({ filename: safeFilename, path: savePath, mime: mimeType, size: fileBuffer.length });
          console.log(`[预付审批] 附件上传成功: ${safeFilename} (${fileBuffer.length} bytes)`);
        } catch (attErr) {
          console.error(`[预付审批] 附件上传失败: ${att.filename}`, attErr.message);
        }
      }
    }

    // 付款事由：8月3日仓库采购预付款，供应商：麦德龙，预付金额：¥50.00
    const prepayReason = `${monthDayStr}仓库采购预付款，供应商：${row.supplier_name || '未指定'}，预付金额：¥${prepayAmount.toFixed(2)}`;
    // 备注说明：预付款给供应商麦德龙，采购单号：WH20260803001
    const prepayRemark = `预付款给供应商${row.supplier_name || '未指定'}，采购单号：${row.purchase_no || id}`;

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

    const spNo = await submitApproval(config, applyData);

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
    const spStatus = detail.status || detail.sp_status;

    let newStatus = row.prepay_status;
    if (spStatus === 2 || spStatus === 'approved') {
      newStatus = 'approved';
      await pool.query(
        'UPDATE warehouse_purchases SET prepay_status = ? WHERE id = ?',
        [newStatus, id]
      );
      // 自动核销
      await pool.query(
        `UPDATE warehouse_purchases
         SET writeoff_status = 'auto', writeoff_amount = prepay_amount
         WHERE id = ? AND writeoff_status = 'pending'`,
        [id]
      );
      // 更新供应商余额
      if (row.supplier_id) {
        const [supplierRows] = await pool.query(
          'SELECT prepay_balance FROM suppliers WHERE id = ?',
          [row.supplier_id]
        );
        if (supplierRows.length > 0) {
          const currentBalance = toNum(supplierRows[0].prepay_balance);
          await pool.query(
            'UPDATE suppliers SET prepay_balance = ? WHERE id = ?',
            [currentBalance + toNum(row.prepay_amount), row.supplier_id]
          );
        }
      }
    } else if (spStatus === 3 || spStatus === 'rejected') {
      newStatus = 'rejected';
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

    const [freshRows] = await pool.query('SELECT * FROM warehouse_purchases WHERE id = ?', [id]);
    res.json(normalizePurchaseRow(freshRows[0]));
  } catch (err) {
    console.error('回填预付款付款凭证失败:', err);
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

    const actualAmount = toNum(row.actual_amount);
    const prepayAmount = toNum(row.prepay_amount);
    let diffAmount = 0;
    let writeoffAmount = prepayAmount;

    if (prepayAmount >= actualAmount) {
      writeoffAmount = actualAmount;
      diffAmount = prepayAmount - actualAmount;
      await connection.query(
        `UPDATE warehouse_purchases
         SET writeoff_status = 'auto', writeoff_amount = ?
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
      res.json({
        message: `核销完成：预付¥${prepayAmount.toFixed(2)}，实际¥${actualAmount.toFixed(2)}，多付¥${diffAmount.toFixed(2)}已计入供应商余额`,
        diff_amount: diffAmount,
        writeoff_amount: writeoffAmount,
        type: 'overpay',
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
      res.json({
        message: `核销完成：预付¥${prepayAmount.toFixed(2)}，实际¥${actualAmount.toFixed(2)}，少付¥${remainAmount.toFixed(2)}待后续报销`,
        diff_amount: remainAmount,
        writeoff_amount: writeoffAmount,
        type: 'underpay',
      });
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

module.exports = router;
