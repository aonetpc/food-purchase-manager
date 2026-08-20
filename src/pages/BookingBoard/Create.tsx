import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  X,
  Upload,
  Download,
  Save,
  Send,
  Pencil,
  FileSpreadsheet,
  Eraser,
  AlertCircle,
  CheckCircle,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Edit3,
  Search,
} from 'lucide-react';
import type {
  BookingOrder,
  BookingItem,
  BizType,
  PaxEntry,
  PackageCode,
  LodgingType,
  MealSession,
  MealPricingMode,
  MeetingSession,
  WellnessSession,
  CarCustomer,
  CarpickupSession,
} from './types';
import {
  BIZ_MAP,
  MANUAL_BIZ_TYPES,
  CHECKUP_PACKAGES,
  LODGING_TYPES,
  MEETING_HALLS,
  WELLNESS_TYPES,
  PAYMENT_OPTIONS,
  LODGING_NAME_MAP,
  HALL_NAME_MAP,
  WELLNESS_NAME_MAP,
  PACKAGE_NAME_MAP,
} from './constants';
import {
  fmt,
  addDays,
  todayStr,
  daysBetween,
  genItemId,
  genOrderNo,
  calcCheckupAmount,
  calcSinglePaxAmount,
  resolvePaxItems,
  calcLodgingAmount,
  calcMeetingAmount,
  calcWellnessAmount,
  calcMealAmount,
  parseCSV,
  toCSV,
  downloadFile,
  groupTotal,
} from './utils';
import { bookingApi, type BookingSalesUser, type BookingConfig, type MealTypeRow } from '../../lib/api';
import { checkupApi, type Role, CATEGORIES } from '@/pages/CheckupTemplates/api';
import type { PackageRow, RoomTypeRow, MeetingHallRow, WellnessTypeRow, CustomPackageItem, CheckupItemRow } from './types';

// ================================================
// 样式常量
// ================================================
const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const labelCls = 'block text-xs text-gray-500 mb-1.5';
const cellInput =
  'bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900 text-xs focus:outline-none focus:border-green-500 w-full';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors';

// ================================================
// 本地工具函数
// ================================================

// 按 YYYY-MM-DD 本地解析，避免时区偏移
function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function emptyPax(): PaxEntry {
  return { name: '', idCard: '', phone: '', gender: '男', married: false, package: '' };
}

// 人员性别+婚否 → 套餐角色映射
function paxToRole(gender: '男' | '女', married: boolean): Role {
  if (gender === '男') return 'male';
  return married ? 'female_married' : 'female_single';
}

// 从18位身份证号推断性别：第17位奇数=男，偶数=女；同时可解析出生日期
function parseIdCardMeta(id: string): { gender?: '男' | '女'; birthDate?: string } {
  const s = (id || '').trim();
  if (s.length < 17) return {};
  const result: { gender?: '男' | '女'; birthDate?: string } = {};
  const s17 = s.charAt(16);
  const n17 = parseInt(s17, 10);
  if (!isNaN(n17)) result.gender = n17 % 2 === 1 ? '男' : '女';
  if (/^\d{17}[\dXx]$/.test(s)) {
    const y = s.slice(6, 10);
    const m = s.slice(10, 12);
    const d = s.slice(12, 14);
    result.birthDate = `${y}-${m}-${d}`;
  }
  return result;
}

// 销售套餐胶囊名称兜底：识别 UUID/纯ID 等自动生成名，生成友好名
function friendlyCapsuleName(cap: any, knownPackages?: Array<{ code: string; name: string; items?: any[] }>): string {
  if (!cap) return '';
  const raw = String(cap.name || '').trim();

  // 1. 空名称兜底
  if (!raw) return cap.code ? `${cap.code}套餐` : '体检套餐';

  // 2. 识别各种"丑陋"自动生成格式
  const uglyPatterns = [
    /^套餐\s*[0-9a-fA-F-]{8,}$/,          // 套餐-UUID格式
    /^[0-9a-fA-F]{8}-[0-9a-fA-F-]+$/,     // 纯UUID
    /^[0-9]+$/,                           // 纯数字ID
    /^[Pp]KG[_-]?\w+$/,                   // pkg_xxx / PKG_xxx
    /^[Pp]ackage[_-]?\w+$/,              // package_xxx
    /^[0-9a-fA-F]{12,}$/,                // 无分隔长十六进制串
  ];
  const isUgly = uglyPatterns.some(p => p.test(raw));

  // 如果名称看起来正常（含中文、或至少2个可读单词），直接返回
  if (!isUgly && /[\u4e00-\u9fa5]/.test(raw)) return raw;
  if (!isUgly && raw.split(/\s+/).length >= 2) return raw;

  // 3. 尝试从已知套餐库中查找匹配（通过 item_id 相似度关联）
  if (knownPackages && Array.isArray(cap.items) && cap.items.length > 0) {
    const capItemIds = new Set(
      cap.items.map((it: any) => String(it.item_id || '').trim()).filter(Boolean)
    );
    if (capItemIds.size > 0) {
      let bestMatch: { name: string; score: number } | null = null;
      for (const pkg of knownPackages) {
        const pkgItemIds = new Set(
          (pkg.items || []).map((it: any) => String(it.item_id || '').trim()).filter(Boolean)
        );
        if (pkgItemIds.size === 0) continue;
        let matchCount = 0;
        capItemIds.forEach((id: string) => { if (pkgItemIds.has(id)) matchCount++; });
        const score = matchCount / Math.min(capItemIds.size, pkgItemIds.size);
        if (score > 0.4 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { name: pkg.name, score };
        }
      }
      if (bestMatch) return bestMatch.name;
    }
  }

  // 4. 用 code 字段兜底
  if (cap.code) return `${cap.code}套餐`;

  // 5. 按角色价拼接
  const prices = cap.prices || {};
  const parts: string[] = [];
  const malePrice = Number(prices.male?.discount_price || 0);
  const fmMarrPrice = Number(prices.female_married?.discount_price || 0);
  const fmSinglePrice = Number(prices.female_single?.discount_price || 0);
  if (malePrice > 0) parts.push(`男¥${malePrice}`);
  if (fmSinglePrice > 0 && fmSinglePrice === fmMarrPrice) {
    parts.push(`女¥${fmSinglePrice}`);
  } else {
    if (fmMarrPrice > 0) parts.push(`女(婚)¥${fmMarrPrice}`);
    if (fmSinglePrice > 0 && fmSinglePrice !== fmMarrPrice) parts.push(`女(未)¥${fmSinglePrice}`);
  }
  return parts.length > 0 ? `定制体检 · ${parts.join('/')}` : '定制体检套餐';
}

// 解析一行文本：优先 Tab/逗号分隔；同时兼容中文逗号、多空格
function splitRow(line: string): string[] {
  const l = (line || '').trim();
  if (!l) return [];
  if (l.includes('\t')) return l.split('\t').map(s => s.trim());
  if (l.includes(',')) return l.split(',').map(s => s.trim());
  if (l.includes('，')) return l.split('，').map(s => s.trim());
  return l.split(/\s{2,}/).map(s => s.trim());
}

// 获取用餐标准信息（从后端配置或兜底常量）
function getMealTypeInfo(code: string, mealTypes?: any[]): { name: string; pricingMode: MealPricingMode; unitPrice: number; defaultTime: string; defaultTables: number; defaultPerTable: number; defaultPax: number } {
  const row = (mealTypes || []).find((m: any) => m.code === code);
  if (row) {
    return {
      name: row.name,
      pricingMode: row.pricing_mode as MealPricingMode,
      unitPrice: Number(row.unit_price || 0),
      defaultTime: row.default_time || '12:00',
      defaultTables: Number(row.default_tables || 1),
      defaultPerTable: Number(row.default_per_table || 10),
      defaultPax: Number(row.default_pax || 0),
    };
  }
  const FALLBACK: Record<string, { name: string; pricingMode: MealPricingMode; unitPrice: number; defaultTime: string; defaultTables: number; defaultPerTable: number; defaultPax: number }> = {
    work:     { name: '工作餐',     pricingMode: 'per_person', unitPrice: 30,  defaultTime: '12:00', defaultTables: 1, defaultPerTable: 10, defaultPax: 20 },
    standard: { name: '标准桌餐',   pricingMode: 'per_table',  unitPrice: 500, defaultTime: '12:00', defaultTables: 2, defaultPerTable: 10, defaultPax: 0 },
    premium:  { name: '豪华桌餐',   pricingMode: 'per_table',  unitPrice: 1200, defaultTime: '12:00', defaultTables: 2, defaultPerTable: 10, defaultPax: 0 },
    buffet:   { name: '自助餐',     pricingMode: 'per_person', unitPrice: 128, defaultTime: '12:00', defaultTables: 1, defaultPerTable: 10, defaultPax: 20 },
  };
  return FALLBACK[code] || FALLBACK['work'];
}

// 第5期：从 finalItems 快照恢复 customItems（编辑/复制场景使用）
// 订单项存储时使用 finalItems 快照，编辑时需要转为 customItems 才能进入"已定制"态继续修改
function restoreCustomItemsFromSnapshot<T extends { package: string; customItems?: any; finalItems?: any }>(
  paxList: T[],
): T[] {
  return (paxList || []).map((p) => {
    // 如果已经有 customItems，直接保留
    if (p.customItems && p.customItems.length > 0) return p;
    // 没有 customItems 但有 finalItems 快照 → 恢复为 customItems（可继续编辑）
    if (p.finalItems && p.finalItems.length > 0) {
      return {
        ...p,
        customItems: p.finalItems.map((it: any) => {
          // 去除 __temporary 标记：这些已在快照中，视为已正式保存的项目
          const { __temporary, ...rest } = it || {};
          return rest;
        }),
      };
    }
    return p;
  });
}

// 复制为新单：日期偏移 +7 天，保留所有业务配置和明细信息
function copyItemsForCopy(src: BookingOrder): BookingItem[] {
  const OFFSET = 7; // 向后偏移一周
  // 复制时按源订单的住宿状态判定入住/不住宿价
  const isGuestCopy = src.items.some((it) => it.itemType === 'lodging');
  return src.items.map((it) => {
    const extra = JSON.parse(JSON.stringify(it.extra || {}));
    let date = it.date ? fmt(addDays(parseDateLocal(it.date), OFFSET)) : '';
    let startTime = it.startTime || '';
    let amount = 0;

    if (it.itemType === 'checkup') {
      // 体检：保留 paxList，并从 finalItems 快照恢复 customItems（让复制后的订单可继续编辑定制项）
      extra.paxList = restoreCustomItemsFromSnapshot((extra.paxList || []).map((p: any) => ({ ...p })));
      extra.packageTotal = calcCheckupAmount(extra.paxList || []);
      amount = extra.packageTotal;
    } else if (it.itemType === 'lodging') {
      // 住宿：日期 +7 天，nights 保持不变，按新单价重新计算
      extra.dateCheckIn = extra.dateCheckIn ? fmt(addDays(parseDateLocal(extra.dateCheckIn), OFFSET)) : '';
      extra.dateCheckOut = extra.dateCheckOut ? fmt(addDays(parseDateLocal(extra.dateCheckOut), OFFSET)) : '';
      // 没有 date 时回退到 +7
      if (!date && extra.dateCheckIn) date = extra.dateCheckIn;
      extra.arrivalTime = extra.arrivalTime || '';
      if (extra.dateCheckIn && extra.dateCheckOut) {
        extra.nights = daysBetween(extra.dateCheckIn, extra.dateCheckOut);
        amount = calcLodgingAmount(extra.lodgingType, Number(it.pax) || 1, Number(extra.nights) || 0);
      } else {
        extra.nights = undefined;
        amount = 0;
      }
    } else if (it.itemType === 'lunch' || it.itemType === 'dinner') {
      // 餐食：sessions 日期偏移 7 天，重新计算金额
      extra.sessions = (extra.sessions || []).map((s: any) => ({
        ...s,
        date: s.date ? fmt(addDays(parseDateLocal(s.date), OFFSET)) : '',
      }));
      if (!date && extra.sessions?.[0]?.date) date = extra.sessions[0].date;
      amount = (extra.sessions || []).reduce((sum: number, s: any) =>
        sum + calcMealAmount(s.pricingMode, s.unitPrice, s.tables, s.perTable, s.pax), 0);
    } else if (it.itemType === 'meeting') {
      extra.sessions = (extra.sessions || []).map((s: any) => ({
        ...s,
        date: s.date ? fmt(addDays(parseDateLocal(s.date), OFFSET)) : '',
      }));
      const sessions = extra.sessions as MeetingSession[] || [];
      if (!date && sessions[0]?.date) date = sessions[0].date;
      amount = sessions.reduce((sum, s) => sum + calcMeetingAmount(s.hall, s.slotType), 0);
    } else if (it.itemType === 'wellness') {
      extra.sessions = (extra.sessions || []).map((s: any) => ({
        ...s,
        date: s.date ? fmt(addDays(parseDateLocal(s.date), OFFSET)) : '',
      }));
      const sessions = extra.sessions as WellnessSession[] || [];
      if (!date && sessions[0]?.date) date = sessions[0].date;
      amount = sessions.reduce((sum, s) => sum + calcWellnessAmount(s.wellnessType, s.hours, undefined, isGuestCopy), 0);
    } else {
      amount = Number(it.amount) || 0;
    }
    return { ...it, id: genItemId(), date, startTime, extra, amount };
  });
}

// 解析整单导入文本，按 [SHEET:xxx] 分段
function parseOrderImport(text: string): Record<string, string[][]> {
  const rows = parseCSV(text);
  const sections: Record<string, string[][]> = {};
  let current = '';
  for (const row of rows) {
    if (row.length === 0) continue;
    const m = row[0].match(/^\[SHEET:([^\]]+)\]/);
    if (m) {
      current = m[1].trim();
      sections[current] = [];
    } else if (current) {
      sections[current].push(row);
    }
  }
  return sections;
}

function colGetter(headers: string[], row: string[]) {
  return (name: string) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? row[idx] || '' : '';
  };
}

function parsePackage(raw: string): PackageCode {
  const v = (raw || '').trim();
  if (!v) return 'A';
  const up = v.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(up[0])) return up[0] as PackageCode;
  if (PACKAGE_NAME_MAP[v]) return PACKAGE_NAME_MAP[v];
  return 'A';
}

// 项目摘要（动态数据优先，兜底常量保底）
function makeItemSummary(
  item: BookingItem,
  helpers: {
    getPackageInfo: (c: string) => { name: string; price: number; label: string };
    getRoomInfo: (c: string) => { name: string; price: number };
    getHallInfo: (c: string) => { name: string; capacity: number; halfPrice: number; fullPrice: number };
    getWellnessInfo: (c: string) => { name: string; minHours: number; price: number; free: boolean };
  },
): { main: string; sub: string } {
  let main = '';
  let sub = '';
  if (item.itemType === 'checkup') {
    main = `${item.date} ${item.startTime}`;
    const paxList = (item.extra.paxList || []) as Array<{ package: string; name?: string }>;
    const pkgs = paxList.reduce(
      (acc, p) => {
        acc[p.package] = (acc[p.package] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const paxListCount = Number((item.extra as any)?.paxListCount ?? paxList.length);
    // 【C-1】区分：如果有 roleCounts 且不等于名单人数，显式注明「名单X人 · 设定Y人」
    const savedCounts = (item.extra as any)?.roleCounts;
    let roleTotal = 0;
    if (savedCounts) {
      roleTotal =
        Number(savedCounts.male) +
        Number(savedCounts.female_married) +
        Number(savedCounts.female_single);
    } else {
      // 没存过角色人数时，item.pax 就是名单人数（老数据）
      roleTotal = item.pax;
    }
    let peopleLabel = `${item.pax}人`;
    if (savedCounts && roleTotal > 0 && roleTotal !== paxListCount) {
      // 设定人数与名单人数不一致 → 同时显示，按「设定人数（名单实际录入X人）」显示
      peopleLabel = `${roleTotal}人(名单${paxListCount}人)`;
    }
    sub = `${peopleLabel} · ${Object.entries(pkgs)
      .map(([k, v]) => `${helpers.getPackageInfo(k).name || k}×${v}`)
      .join(' ')}`;
  } else if (item.itemType === 'lodging') {
    main = `${item.extra.dateCheckIn || '-'} → ${item.extra.dateCheckOut || '-'}`;
    sub = `${helpers.getRoomInfo(item.extra.lodgingType || 'standard').name} ${item.pax}间 · ${
      item.extra.nights || 0
    }晚`;
  } else if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    const ss = item.extra.sessions || [];
    main = `${ss[0]?.date || item.date} · ${ss.length}场`;
    sub = ss.map((s: any) => {
      const info = getMealTypeInfo(s.mealType, (helpers as any).mealTypes);
      const amt = calcMealAmount(s.pricingMode, s.unitPrice, s.tables, s.perTable, s.pax);
      return `${info.name} ¥${amt.toLocaleString()}`;
    }).join('、');
  } else if (item.itemType === 'meeting') {
    const ss = item.extra.sessions || [];
    main = `${ss[0]?.date || item.date} · ${ss.length}场`;
    sub = ss.map((s: any) => helpers.getHallInfo(s.hall).name).join('、');
  } else if (item.itemType === 'wellness') {
    const ss = item.extra.sessions || [];
    main = `${ss[0]?.date || item.date} · ${ss.length}场`;
    sub = ss.map((s: any) => `${helpers.getWellnessInfo(s.wellnessType).name} ${s.hours}h`).join('、');
  }
  return { main, sub };
}

// ================================================
// 抽屉状态
// ================================================
interface DrawerState {
  open: boolean;
  mode: 'select' | 'form';
  itemType: BizType | null;
  editIdx: number;
}

interface ImportResult {
  msg: string;
  warnings: string[];
}

// ============================================================
// 追加项目选择器：居中 Modal 弹窗，分类分组胶囊多选
// 支持默认选中（原套餐项目）、新增、移除三种操作
// ============================================================
interface PickResult {
  addedIds: string[];    // 新增选中的项目ID
  removedIds: string[];  // 从原套餐中移除的项目ID
}

function CapsuleItemPicker(props: {
  open: boolean;
  onClose: () => void;
  lib: CheckupItemRow[];
  defaultSelectedIds: Set<string>; // 原套餐包含的项目（默认选中，可点击移除）
  userSelectedIds: Set<string>;    // 用户新增选中的项目
  onToggleUserSelection: (id: string) => void; // 切换用户新增选中
  onConfirm: (result: PickResult) => void;
  confirmLabel?: string;
  title?: string;
  multiplierLabel?: string;
  allowRemove?: boolean;
}) {
  const {
    open, onClose, defaultSelectedIds, userSelectedIds, onToggleUserSelection, onConfirm,
    confirmLabel, title, multiplierLabel, allowRemove = true,
  } = props;

  // 合并去重 lib
  const effectiveLib = useMemo<CheckupItemRow[]>(() => {
    const base = Array.isArray(props.lib) ? props.lib : [];
    const byId = new Map<string, CheckupItemRow>();
    for (const ci of base) if (ci?.id) byId.set(ci.id, ci);
    return Array.from(byId.values());
  }, [props.lib]);

  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // 按 CATEGORIES 顺序分组
  const groups = useMemo(() => {
    const g: Record<string, CheckupItemRow[]> = {};
    const known = [...CATEGORIES, '其他'];
    known.forEach(k => g[k] = []);
    const lowerQ = q.trim().toLowerCase();
    for (const ci of effectiveLib) {
      if (lowerQ && !(ci.name || '').toLowerCase().includes(lowerQ)) continue;
      const cat = ci.category || '其他';
      if (g[cat]) g[cat].push(ci);
      else g['其他'].push(ci);
    }
    return known.map(k => ({ category: k, items: g[k] || [] })).filter(x => x.items.length > 0);
  }, [effectiveLib, q]);

  // 打开时初始化
  useEffect(() => {
    if (!open) return;
    setQ('');
    setRemovedIds(new Set());
    // 根据选中状态自动折叠无选中的分类
    const activeIds = new Set([...userSelectedIds, ...defaultSelectedIds]);
    if (activeIds.size > 0) {
      const nextCollapsed = new Set<string>();
      groups.forEach(g => {
        const hasActive = g.items.some(ci => ci.id && activeIds.has(ci.id));
        if (!hasActive) nextCollapsed.add(g.category);
      });
      setCollapsed(nextCollapsed);
    } else {
      setCollapsed(new Set());
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const totalChanges = userSelectedIds.size + removedIds.size;
        if (totalChanges > 0) {
          if (!confirm(`您有 ${totalChanges} 项变更未确认，确定关闭吗？`)) return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 统计数量
  const countAdded = userSelectedIds.size;
  const countRemoved = removedIds.size;
  const countDefaultKept = [...defaultSelectedIds].filter(id => !removedIds.has(id)).length;

  // 净变化金额
  const netChange = useMemo(() => {
    let addedSum = 0;
    let removedSum = 0;
    for (const ci of effectiveLib) {
      if (ci.id && userSelectedIds.has(ci.id)) {
        addedSum += Number(ci.default_price || 0);
      }
      if (ci.id && removedIds.has(ci.id)) {
        removedSum += Number(ci.default_price || 0);
      }
    }
    return addedSum - removedSum;
  }, [effectiveLib, userSelectedIds, removedIds]);

  const highlightMatch = (text: string, keyword: string) => {
    if (!keyword) return text;
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 text-gray-900 rounded px-0.5">{text.slice(idx, idx + keyword.length)}</mark>
        {text.slice(idx + keyword.length)}
      </>
    );
  };

  const toggleCollapse = (cat: string) => {
    setCollapsed(prev => {
      const n = new Set(prev);
      if (n.has(cat)) n.delete(cat);
      else n.add(cat);
      return n;
    });
  };

  const clearAll = () => {
    // 取消所有新增选中
    for (const id of userSelectedIds) {
      onToggleUserSelection(id);
    }
    // 恢复所有被移除的原套餐项目
    setRemovedIds(new Set());
  };

  const handleClose = () => {
    const totalChanges = userSelectedIds.size + removedIds.size;
    if (totalChanges > 0) {
      if (!confirm(`您有 ${totalChanges} 项变更未确认，确定关闭吗？`)) return;
    }
    onClose();
  };

  const handleConfirm = () => {
    const result: PickResult = {
      addedIds: [...userSelectedIds],
      removedIds: [...removedIds],
    };
    onConfirm(result);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[720px] max-h-[85vh] flex flex-col border border-gray-200"
        onClick={e => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="shrink-0 px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-green-600" />
              <span className="text-sm font-semibold text-gray-800">
                {title || '体检项目配置'}
              </span>
              <span className="text-xs text-gray-400">（勾选新增 · 点击已选可取消 · 原套餐项目默认选中）</span>
            </div>
            <button
              onClick={handleClose}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
              title="关闭 (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="搜索体检项目（按名称模糊搜索）..."
              className="w-full pl-8 pr-8 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500"
              autoFocus
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="清空搜索"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 统计信息 */}
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>
              <span className="text-gray-400">共 {effectiveLib.length} 项</span>
              <span className="mx-1">·</span>
              <span className="text-green-600 font-semibold">{countDefaultKept}</span> 原套餐保留
              {countRemoved > 0 && (
                <>
                  <span className="mx-1">·</span>
                  <span className="text-red-500 font-semibold">{countRemoved}</span> 已移除
                </>
              )}
              {countAdded > 0 && (
                <>
                  <span className="mx-1">·</span>
                  <span className="text-green-600 font-semibold">{countAdded}</span> 新增
                </>
              )}
            </span>
            {(countAdded > 0 || countRemoved > 0) && (
              <span className={`font-mono font-semibold ${netChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                净变化 {netChange >= 0 ? '+' : ''}¥{netChange.toLocaleString()}
                {multiplierLabel && <span className="ml-1 text-xs text-gray-400 font-normal">({multiplierLabel})</span>}
              </span>
            )}
          </div>
        </div>

        {/* 滚动内容区 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50/30">
          {groups.length === 0 && (
            <div className="py-10 text-center text-xs text-gray-400 space-y-2">
              <div>
                {effectiveLib.length === 0
                  ? '项目库暂无数据（请在「业务配置」中添加体检项目）'
                  : '没有匹配的项目，请换关键词搜索'}
              </div>
            </div>
          )}
          {groups.map(g => {
            const isCollapsed = collapsed.has(g.category);
            const groupCountAdded = g.items.filter(ci => ci.id && userSelectedIds.has(ci.id)).length;
            const groupCountRemoved = g.items.filter(ci => ci.id && removedIds.has(ci.id)).length;
            const groupCountDefault = g.items.filter(ci => ci.id && defaultSelectedIds.has(ci.id) && !removedIds.has(ci.id)).length;
            return (
              <div key={g.category} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleCollapse(g.category)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
                >
                  <span className="inline-block w-1 h-4 rounded-sm shrink-0 bg-green-500" />
                  <span className="text-xs font-bold text-gray-800 flex-1 text-left">{g.category}</span>
                  <span className="text-[10px] text-gray-400">{g.items.length} 项</span>
                  {(groupCountAdded > 0 || groupCountRemoved > 0 || groupCountDefault > 0) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-1">
                      {groupCountDefault > 0 && <span className="bg-green-100 text-green-700">{groupCountDefault} 套餐</span>}
                      {groupCountAdded > 0 && <span className="bg-blue-100 text-blue-700">+{groupCountAdded}</span>}
                      {groupCountRemoved > 0 && <span className="bg-red-100 text-red-600">-{groupCountRemoved}</span>}
                    </span>
                  )}
                  {isCollapsed ? (
                    <ChevronDown size={14} className="text-gray-400" />
                  ) : (
                    <ChevronUp size={14} className="text-gray-400" />
                  )}
                </button>
                {!isCollapsed && (
                  <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                    {g.items.map(ci => {
                      const id = ci.id || '';
                      const isDefault = !!id && defaultSelectedIds.has(id);
                      const isRemoved = !!id && removedIds.has(id);
                      const isNewSelected = !!id && userSelectedIds.has(id);

                      // 三种状态的样式
                      let stateClass = '';
                      let iconEl: React.ReactNode = <span className="inline-block w-2" />;
                      let tagEl: React.ReactNode = null;

                      if (isDefault && !isRemoved) {
                        // 原套餐保留：绿色 + [套餐] 标签
                        stateClass = 'bg-green-500/15 border-green-500 text-green-700 shadow-sm hover:bg-green-500/20';
                        iconEl = <CheckCircle size={10} />;
                        tagEl = <span className="text-[9px] bg-green-500 text-white px-1 py-0 rounded-sm font-medium">套餐</span>;
                      } else if (isRemoved) {
                        // 从原套餐移除：红色 + × 图标
                        stateClass = 'bg-red-50 border-red-300 text-red-500 line-through opacity-70 hover:bg-red-100';
                        iconEl = <span className="text-red-400">×</span>;
                        tagEl = <span className="text-[9px] bg-red-400 text-white px-1 py-0 rounded-sm font-medium">已移除</span>;
                      } else if (isNewSelected) {
                        // 用户新增选中：蓝色
                        stateClass = 'bg-blue-500/10 border-blue-500 text-blue-700 shadow-sm hover:bg-blue-500/20';
                        iconEl = <CheckCircle size={10} className="text-blue-600" />;
                      } else {
                        // 未选择
                        stateClass = 'bg-white border-gray-200 text-gray-700 hover:border-green-300 hover:bg-green-50';
                      }

                      const isClickable = !isDefault || allowRemove;

                      return (
                        <button
                          key={id || ci.name}
                          disabled={!isClickable && !isRemoved}
                          onClick={() => {
                            if (!id) return;
                            if (isDefault) {
                              if (!allowRemove) return;
                              setRemovedIds(prev => {
                                const n = new Set(prev);
                                if (n.has(id)) n.delete(id);
                                else n.add(id);
                                return n;
                              });
                            } else {
                              onToggleUserSelection(id);
                            }
                          }}
                          className={[
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border transition-all shrink-0 cursor-pointer',
                            stateClass,
                            isRemoved ? 'cursor-pointer' : '',
                          ].join(' ')}
                          title={
                            isDefault && !isRemoved
                              ? '点击从套餐中移除此项目'
                              : isRemoved
                              ? '点击恢复到套餐中'
                              : `${ci.name} ¥${Number(ci.default_price || 0).toFixed(0)}`
                          }
                        >
                          {iconEl}
                          {tagEl}
                          <span className="truncate max-w-[180px]">
                            {q ? highlightMatch(ci.name, q) : ci.name}
                          </span>
                          <span className={`font-mono text-[10px] ${isDefault && !isRemoved ? 'opacity-100' : 'opacity-70'}`}>
                            ¥{Number(ci.default_price || 0).toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部确认条 - 始终可见 */}
        <div className="shrink-0 border-t border-gray-200 px-4 py-3 bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {countAdded > 0 || countRemoved > 0 ? (
              <>
                {countDefaultKept > 0 && (
                  <><span className="text-green-600 font-semibold">{countDefaultKept}</span> 套餐项目保留</>
                )}
                {countRemoved > 0 && (
                  <><span className="mx-1">·</span><span className="text-red-500 font-semibold">{countRemoved}</span> 项移除</>
                )}
                {countAdded > 0 && (
                  <><span className="mx-1">·</span><span className="text-blue-600 font-semibold">{countAdded}</span> 项新增</>
                )}
                <span className="mx-1">·</span>
                净变化 <span className={`font-mono font-semibold ${netChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {netChange >= 0 ? '+' : ''}¥{netChange.toLocaleString()}
                </span>
              </>
            ) : (
              <span className="text-gray-400">点击项目进行勾选新增或取消选择</span>
            )}
          </div>
          <div className="flex gap-2">
            {(countAdded > 0 || countRemoved > 0) && (
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-500 border border-gray-200 transition-colors"
                title="清空所有变更（取消新增 + 恢复移除）"
              >
                <Eraser size={12} />
                重置
              </button>
            )}
            <button
              onClick={handleClose}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={countAdded === 0 && countRemoved === 0}
              className={[
                'inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg text-white font-medium transition-colors',
                countAdded === 0 && countRemoved === 0
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600 shadow-sm',
              ].join(' ')}
            >
              <CheckCircle size={12} />
              {confirmLabel || `确认 (新增 ${countAdded} / 移除 ${countRemoved})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 第4期：单人定制项目编辑器子组件（可安全使用 useState）
// ============================================================
// PaxItemsEditor（子组件）
function PaxItemsEditor(props: {
  index: number;
  pax: PaxEntry;
  paxAmount: number;
  items: CustomPackageItem[];
  hasCustom: boolean;
  pkgName: string;
  pkgCode: string;
  checkupItemsLib: CheckupItemRow[];
  onRemoveItem: (itemIdx: number) => void;
  onRemoveItemById: (itemId: string) => void;
  onUpdateItemField: (itemIdx: number, field: 'item_price' | 'quantity' | 'remark', val: any) => void;
  onReset: () => void;
  onAddItem: (ci: CheckupItemRow) => void;
  fallbackLib?: CheckupItemRow[];
}) {
  const {
    index, pax, paxAmount, items, hasCustom, pkgName, pkgCode,
    checkupItemsLib, onRemoveItem, onRemoveItemById, onUpdateItemField, onReset, onAddItem,
    fallbackLib = [],
  } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  // 用户新增选中态
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  // 项目表格展开/折叠状态
  const [tableExpanded, setTableExpanded] = useState(false);
  // 合并最终 lib：项目库优先；不足时兜底 + 从当前 items 反推（保证不空）
  const finalLib = useMemo<CheckupItemRow[]>(() => {
    const byId = new Map<string, CheckupItemRow>();
    for (const ci of checkupItemsLib) if (ci?.id) byId.set(ci.id, ci);
    for (const ci of fallbackLib) if (ci?.id && !byId.has(ci.id)) byId.set(ci.id, ci);
    // 从当前 items 反推（保证胶囊面板至少能看到已有项目分类）
    for (const it of items || []) {
      const id = String((it as any).item_id || (it as any).id || '').trim();
      if (!id) continue;
      if (byId.has(id)) continue;
      const fallback: CheckupItemRow = {
        id,
        code: it.item_id || it.item_name_snapshot?.slice(0, 8) || id.slice(0, 8),
        name: it.item_name_snapshot || '未知项目',
        category: '其他',
        description: '',
        default_price: Number(it.item_price || 0),
        unit: '',
        status: 1,
        sort_order: 0,
      };
      byId.set(id, fallback);
    }
    return Array.from(byId.values());
  }, [checkupItemsLib, fallbackLib, items]);
  const defaultSelectedIds = useMemo(() => new Set(items.map((i: any) => String(i.item_id || i.id || '')).filter(Boolean)), [items]);
  // 摘要统计
  const stats = useMemo(() => {
    const added = items.filter(i => i.__temporary).length;
    const subtotal = items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
    return { total: items.length, added, subtotal };
  }, [items]);
  const toggleUserSelection = (id: string) => {
    setPickedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const confirm = (result: PickResult) => {
    // 处理移除的项目（先移除再新增，避免冲突）
    for (const id of result.removedIds) {
      onRemoveItemById(id);
    }
    // 处理新增的项目
    for (const id of result.addedIds) {
      const ci = finalLib.find(x => x.id === id);
      if (ci) onAddItem(ci);
    }
    setPickedIds(new Set());
    setPickerOpen(false);
  };
  const closePicker = () => {
    setPickedIds(new Set());
    setPickerOpen(false);
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-gray-800 truncate">{pax.name}</span>
          <span className="text-gray-300">|</span>
          <span className="text-green-600 font-semibold truncate">{pkgName}</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-200 text-gray-600 font-mono">
            {pkgCode}
          </span>
          {hasCustom && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 font-medium">
              ✎ 已定制
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasCustom && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white hover:bg-gray-100 text-gray-500 border border-gray-200"
            >
              <RefreshCw size={10}/> 重置
            </button>
          )}
          <span className="font-mono text-green-600 font-semibold">¥{paxAmount.toLocaleString()}</span>
        </div>
      </div>
      {/* 摘要条（默认折叠显示） */}
      <div className="border-t border-gray-100 bg-gray-50/40 px-3 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-gray-600">
          <span>共 <span className="font-semibold text-gray-800">{stats.total}</span> 项</span>
          {stats.added > 0 && <span className="text-cyan-600">追加 {stats.added} 项</span>}
          <span>合计 <span className="font-mono font-semibold text-green-600">¥{stats.subtotal.toLocaleString()}</span></span>
        </div>
        <button
          onClick={() => setTableExpanded(v => !v)}
          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] text-gray-500 hover:bg-gray-100 border border-gray-200"
        >
          {tableExpanded ? '收起 ▲' : '展开详情 ▼'}
        </button>
      </div>
      {/* 展开的详情表格 */}
      {tableExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">项目</th>
                <th className="px-2 py-1.5 text-left font-medium w-20">备注</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">单价</th>
                <th className="px-2 py-1.5 text-center font-medium w-12">数量</th>
                <th className="px-2 py-1.5 text-right font-medium w-16">小计</th>
                <th className="px-2 py-1.5 text-center font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, iIdx) => {
                const subtotal = Number(it.item_price || 0) * Number(it.quantity || 1);
                return (
                  <tr key={iIdx} className={`border-t border-gray-100 ${it.__temporary ? 'bg-cyan-50/40' : ''}`}>
                    <td className="px-2 py-1.5 text-gray-700">
                      {it.__temporary && <span className="text-[9px] bg-cyan-500 text-white px-1 py-0.5 rounded mr-1 align-middle">追加</span>}
                      {it.item_name_snapshot}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={it.remark || ''}
                        onChange={e => onUpdateItemField(iIdx, 'remark', e.target.value)}
                        className={`w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500`}
                        placeholder="如空腹"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        value={it.item_price}
                        onChange={e => onUpdateItemField(iIdx, 'item_price', Number(e.target.value) || 0)}
                        className={`w-20 px-1 py-0.5 text-[11px] border border-gray-200 rounded font-mono text-right focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="number"
                        min="1"
                        value={it.quantity}
                        onChange={e => onUpdateItemField(iIdx, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                        className={`w-12 px-1 py-0.5 text-[11px] border border-gray-200 rounded text-center focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-700">¥{subtotal.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => onRemoveItem(iIdx)}
                        className="text-red-400 hover:text-red-600 inline-flex items-center gap-0.5"
                        title="移除"
                      >
                        <Trash2 size={12}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-3 text-center text-xs text-gray-400">
                    当前无项目，请从下方「追加项目」按钮选择
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-gray-100 bg-gray-50/30 px-3 py-2">
        <button
          onClick={() => { setPickerOpen(!pickerOpen); setPickedIds(new Set()); }}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 transition-colors"
        >
          <Plus size={11}/> 配置项目（按分类多选增/删）
        </button>
        <CapsuleItemPicker
          open={pickerOpen}
          onClose={closePicker}
          lib={finalLib}
          defaultSelectedIds={defaultSelectedIds}
          userSelectedIds={pickedIds}
          onToggleUserSelection={toggleUserSelection}
          onConfirm={confirm}
          confirmLabel="确认配置"
          title="体检项目配置（可增可减）"
        />
      </div>
    </div>
  );
}

// -------- 单人项目编辑弹窗（包裹 PaxItemsEditor，附加头部+关闭+同步套餐标准） --------
function PaxItemsEditorModal(props: {
  pax: PaxEntry;
  paxAmount: number;
  items: CustomPackageItem[];
  hasCustom: boolean;
  pkgName: string;
  pkgCode: string;
  checkupItemsLib: CheckupItemRow[];
  hasSharedEdits: boolean;
  onRemoveItem: (itemIdx: number) => void;
  onRemoveItemById: (itemId: string) => void;
  onUpdateItemField: (itemIdx: number, field: 'item_price' | 'quantity' | 'remark', val: any) => void;
  onReset: () => void;
  onAddItem: (ci: CheckupItemRow) => void;
  onSyncShared: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={props.onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-2.5 border-b border-gray-200 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-gray-900">{props.pax.name}</span>
            <span className="text-gray-300">|</span>
            <span className="text-green-600 font-semibold">{props.pkgName}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-200 text-gray-600 font-mono">
              {props.pkgCode}
            </span>
            {props.hasCustom && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700 font-medium">
                ✎ 已定制
              </span>
            )}
            <span className="text-gray-300">|</span>
            <span className="font-mono text-green-600 font-semibold">¥{props.paxAmount.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            {props.hasCustom && props.hasSharedEdits && (
              <button
                onClick={props.onSyncShared}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-cyan-50 hover:bg-cyan-100 text-cyan-600 border border-cyan-200 transition-colors"
                title="将当前套餐共享版本同步过来，覆盖此人的定制"
              >
                ↺ 同步套餐标准
              </button>
            )}
            {props.hasCustom && !props.hasSharedEdits && (
              <button
                onClick={props.onReset}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-white hover:bg-gray-100 text-gray-500 border border-gray-200"
              >
                <RefreshCw size={10}/> 重置为套餐默认
              </button>
            )}
            <button onClick={props.onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <PaxItemsEditor
            index={-1}
            pax={props.pax}
            paxAmount={props.paxAmount}
            items={props.items}
            hasCustom={props.hasCustom}
            pkgName={props.pkgName}
            pkgCode={props.pkgCode}
            checkupItemsLib={props.checkupItemsLib}
            onRemoveItem={props.onRemoveItem}
            onRemoveItemById={props.onRemoveItemById}
            onUpdateItemField={props.onUpdateItemField}
            onReset={props.onReset}
            onAddItem={props.onAddItem}
          />
        </div>
      </div>
    </div>
  );
}

// -------- 套餐汇总卡片（批量编辑套餐共享版 + 展示组信息） --------
function PackageGroupSummary(props: {
  pkgCode: string;
  pkgName: string;
  pkgPrice: number;
  paxList: PaxEntry[];
  sharedItems: CustomPackageItem[];
  hasSharedEdits: boolean;
  isCustomizedFn: (p: PaxEntry) => boolean;
  checkupItemsLib: CheckupItemRow[];
  singlePaxAmountFn: (sharedOverride: CustomPackageItem[]) => number;
  getPerPersonPrice: (p: PaxEntry) => number;
  onAddItem: (ci: CheckupItemRow) => void;
  onRemoveItem: (itemIdx: number) => void;
  onRemoveItemById: (itemId: string) => void;
  onUpdateItemField: (itemIdx: number, field: 'item_price' | 'quantity' | 'remark', val: any) => void;
  onReset: () => void;
}) {
  const {
    pkgCode, pkgName, pkgPrice, paxList, sharedItems, hasSharedEdits,
    isCustomizedFn, checkupItemsLib, singlePaxAmountFn, getPerPersonPrice,
    onAddItem, onRemoveItem, onRemoveItemById, onUpdateItemField, onReset,
  } = props;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  // 项目表格展开/折叠状态
  const [tableExpanded, setTableExpanded] = useState(false);

  const nTotal = paxList.length;
  const nCustom = paxList.filter(isCustomizedFn).length;
  const nStandard = nTotal - nCustom;

  // 修复：单人金额优先使用胶囊折扣价，而非逐项原价合计
  // 只有在用户实际编辑了共享项目时，才使用逐项计算
  const singleAmt = (() => {
    // 如果有共享编辑，使用逐项计算
    if (hasSharedEdits && sharedItems.length > 0) {
      return singlePaxAmountFn(sharedItems);
    }
    // 否则使用胶囊折扣价（取第一位标准人员的价格作为代表）
    const standardPax = paxList.filter(p => !isCustomizedFn(p));
    if (standardPax.length > 0) {
      return getPerPersonPrice(standardPax[0]);
    }
    // 兜底
    return singlePaxAmountFn(sharedItems);
  })();

  // 修复：合计金额使用每人的实际价格（胶囊折扣价或定制价）
  const groupTotal = paxList.reduce((s, p) => {
    if (isCustomizedFn(p)) {
      // 已定制：使用 customItems 计算
      if (p.customItems && p.customItems.length > 0) {
        return s + p.customItems.reduce((a, i) => a + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
      }
      return s;
    }
    // 标准人：使用胶囊折扣价
    return s + getPerPersonPrice(p);
  }, 0);

  const itemsSubtotal = sharedItems.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
  // 摘要统计
  const grpStats = useMemo(() => {
    const added = sharedItems.filter(i => i.__temporary).length;
    return { total: sharedItems.length, added, subtotal: itemsSubtotal };
  }, [sharedItems, itemsSubtotal]);
  // 合并最终 lib（项目库 + 已有 sharedItems 反推兜底）
  const finalLib = useMemo<CheckupItemRow[]>(() => {
    const byId = new Map<string, CheckupItemRow>();
    for (const ci of checkupItemsLib) if (ci?.id) byId.set(ci.id, ci);
    for (const it of sharedItems || []) {
      const id = String((it as any).item_id || (it as any).id || '').trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        code: it.item_id || it.item_name_snapshot?.slice(0, 8) || id.slice(0, 8),
        name: it.item_name_snapshot || '未知项目',
        category: '其他',
        description: '',
        default_price: Number(it.item_price || 0),
        unit: '',
        status: 1,
        sort_order: 0,
      });
    }
    return Array.from(byId.values());
  }, [checkupItemsLib, sharedItems]);
  const defaultSelectedIds = useMemo(() => new Set(sharedItems.map((i: any) => String(i.item_id || i.id || '')).filter(Boolean)), [sharedItems]);
  const toggleUserSelection = (id: string) => {
    setPickedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const confirm = (result: PickResult) => {
    // 处理移除的项目
    for (const id of result.removedIds) {
      onRemoveItemById(id);
    }
    // 处理新增的项目
    for (const id of result.addedIds) {
      const ci = finalLib.find(x => x.id === id);
      if (ci) onAddItem(ci);
    }
    setPickedIds(new Set());
    setPickerOpen(false);
  };
  const closePicker = () => {
    setPickedIds(new Set());
    setPickerOpen(false);
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* 卡片头 */}
      <div className="bg-gray-50 px-4 py-2.5 text-xs flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/10 text-green-600 font-semibold border border-green-200">
            {pkgCode}
          </span>
          <span className="font-semibold text-gray-800 truncate">{pkgName}</span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-500">
            <span className="font-mono text-gray-700 font-medium">{nTotal}</span> 人
            {nStandard > 0 && <span className="ml-2"><span className="text-green-600">●</span> 标准 {nStandard}</span>}
            {nCustom > 0 && <span className="ml-2 text-amber-600">✎ 已定制 {nCustom} (不参与批量修改)</span>}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {hasSharedEdits && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-white hover:bg-gray-100 text-gray-500 border border-gray-200"
            >
              <RefreshCw size={10}/> 重置为套餐默认
            </button>
          )}
          <div className="text-right">
            <div className="text-[10px] text-gray-400">
              单人 <span className="font-mono">¥{singleAmt.toLocaleString()}</span>
              <span className="mx-1">·</span>
              {nStandard} 标准人
            </div>
            <div className="font-mono text-green-600 font-semibold text-sm">合计 ¥{groupTotal.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* 摘要条（默认折叠显示） */}
      <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-gray-600">
          <span>共 <span className="font-semibold text-gray-800">{grpStats.total}</span> 项</span>
          {grpStats.added > 0 && <span className="text-cyan-600">追加 {grpStats.added} 项</span>}
          <span>项目合计 <span className="font-mono font-semibold text-green-600">¥{grpStats.subtotal.toLocaleString()}</span></span>
          {nStandard > 1 && <span className="text-gray-400">× {nStandard} 标准人 = ¥{(grpStats.subtotal * nStandard).toLocaleString()}</span>}
        </div>
        <button
          onClick={() => setTableExpanded(v => !v)}
          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] text-gray-500 hover:bg-gray-100 border border-gray-200"
        >
          {tableExpanded ? '收起 ▲' : '展开详情 ▼'}
        </button>
      </div>
      {/* 展开的详情表格 */}
      {tableExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-gray-500 bg-gray-50/50">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium w-8">#</th>
                <th className="px-3 py-1.5 text-left font-medium">项目</th>
                <th className="px-3 py-1.5 text-left font-medium w-28">备注</th>
                <th className="px-3 py-1.5 text-right font-medium w-20">单价</th>
                <th className="px-3 py-1.5 text-center font-medium w-14">数量</th>
                <th className="px-3 py-1.5 text-right font-medium w-20">小计</th>
                <th className="px-3 py-1.5 text-center font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {sharedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-xs text-gray-400">
                    当前无项目，请从下方「批量追加项目」添加
                  </td>
                </tr>
              ) : sharedItems.map((it, iIdx) => {
                const subtotal = Number(it.item_price || 0) * Number(it.quantity || 1);
                return (
                  <tr key={iIdx} className={`border-t border-gray-100 ${it.__temporary ? 'bg-cyan-50/40' : ''}`}>
                    <td className="px-3 py-1 text-gray-400 font-mono text-center">{iIdx + 1}</td>
                    <td className="px-3 py-1 text-gray-700">
                      {it.__temporary && <span className="text-[9px] bg-cyan-500 text-white px-1 py-0.5 rounded mr-1 align-middle">追加</span>}
                      {it.item_name_snapshot}
                    </td>
                    <td className="px-3 py-1">
                      <input
                        value={it.remark || ''}
                        onChange={e => onUpdateItemField(iIdx, 'remark', e.target.value)}
                        className={`w-full px-1.5 py-0.5 text-[11px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500`}
                        placeholder="如：需空腹"
                      />
                    </td>
                    <td className="px-3 py-1 text-right">
                      <input
                        type="number"
                        value={it.item_price}
                        onChange={e => onUpdateItemField(iIdx, 'item_price', Number(e.target.value) || 0)}
                        className={`w-20 px-1 py-0.5 text-[11px] border border-gray-200 rounded font-mono text-right focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500`}
                      />
                    </td>
                    <td className="px-3 py-1 text-center">
                      <input
                        type="number"
                        min="1"
                        value={it.quantity}
                        onChange={e => onUpdateItemField(iIdx, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                        className={`w-14 px-1 py-0.5 text-[11px] border border-gray-200 rounded text-center focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500`}
                      />
                    </td>
                    <td className="px-3 py-1 text-right font-mono text-gray-700">¥{subtotal.toLocaleString()}</td>
                    <td className="px-3 py-1 text-center">
                      <button
                        onClick={() => onRemoveItem(iIdx)}
                        className="text-red-400 hover:text-red-600 inline-flex items-center gap-0.5"
                        title="移除"
                      >
                        <Trash2 size={12}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50/40">
                <td colSpan={5} className="py-1.5 pr-4 text-right font-medium text-gray-500 text-xs">
                  项目合计（× {nStandard} 标准人 = 标准部分 ¥{(itemsSubtotal * nStandard).toLocaleString()}）
                </td>
                <td className="py-1.5 text-right font-mono font-semibold text-green-600">¥{itemsSubtotal.toLocaleString()}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-2 flex items-center justify-between">
        <div>
          <button
            onClick={() => { setPickerOpen(!pickerOpen); setPickedIds(new Set()); }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-cyan-500 text-white hover:bg-cyan-600 transition-colors"
          >
            <Plus size={11}/> 批量配置项目（同步到 {nStandard} 位标准人员 · 可增可减）
          </button>
          <CapsuleItemPicker
            open={pickerOpen}
            onClose={closePicker}
            lib={finalLib}
            defaultSelectedIds={defaultSelectedIds}
            userSelectedIds={pickedIds}
            onToggleUserSelection={toggleUserSelection}
            onConfirm={confirm}
            confirmLabel={nStandard > 1 ? `确认配置（×${nStandard}人同步）` : '确认配置'}
            title="批量配置体检项目（可增可减）"
            multiplierLabel={nStandard > 1 ? `×${nStandard}人同步` : undefined}
          />
        </div>
        {nCustom > 0 && (
          <div className="text-[10px] text-amber-600 inline-flex items-center gap-1">
            <AlertCircle size={12}/>
            {nCustom} 人已独立定制，不受批量修改影响，点击表格「✎ 已定制 [编辑]」进行单人调整
          </div>
        )}
      </div>
    </div>
  );
}

// -------- 解析预览详情组件（可折叠） --------
function ImportPreviewDetails(props: { paxList: PaxEntry[] }) {
  const [open, setOpen] = useState(false);
  const { paxList } = props;
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 bg-gray-50 hover:bg-gray-100 text-xs text-gray-600 flex items-center justify-between"
      >
        <span>查看导入详情（{paxList.length} 人）</span>
        <span>{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left font-medium">姓名</th>
                <th className="px-2 py-1 text-left font-medium">性别</th>
                <th className="px-2 py-1 text-left font-medium">婚姻</th>
                <th className="px-2 py-1 text-left font-medium">套餐</th>
              </tr>
            </thead>
            <tbody>
              {paxList.map((p, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-gray-800">{p.name}</td>
                  <td className="px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.gender === '男' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>
                      {p.gender}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${p.married ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.married ? '已婚' : '未婚'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-gray-600 font-mono">{p.package}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ================================================
// 主组件
// ================================================
export default function BookingBoardCreate(props: {
  mode: 'create' | 'edit' | 'copy';
  order?: BookingOrder;
  onClose: () => void;
  onSaved: (order: BookingOrder) => Promise<void> | void;
}) {
  const { mode, order, onClose, onSaved } = props;
  const editOrder = mode === 'edit' ? order : undefined;
  const copySource = mode === 'copy' ? order : undefined;
  const isEdit = mode === 'edit';
  const isCopy = mode === 'copy';

  // 订单草稿（客户信息 + 业务项目）
  const [draftGroup, setDraftGroup] = useState<BookingOrder>(() => {
    if (editOrder) {
      const cloned = JSON.parse(JSON.stringify(editOrder)) as BookingOrder;
      // 第5期：编辑模式初始化时，从 finalItems 快照恢复每个体检项的 customItems
      cloned.items = cloned.items.map((it) => {
        if (it.itemType === 'checkup' && it.extra?.paxList) {
          return {
            ...it,
            extra: {
              ...it.extra,
              paxList: restoreCustomItemsFromSnapshot(it.extra.paxList as any[]),
            },
          };
        }
        return it;
      });
      return cloned;
    }
    if (copySource) {
      return {
        id: '',
        customerName: '',
        contactName: '',
        contactPhone: '',
        salesPerson: copySource.salesPerson,
        salesPersonId: copySource.salesPersonId,
        payment: copySource.payment,
        remark: copySource.remark,
        items: copyItemsForCopy(copySource),
        status: 'pending',
        createdAt: '',
      };
    }
    return {
      id: '',
      customerName: '',
      contactName: '',
      contactPhone: '',
      salesPerson: '',
      salesPersonId: undefined,
      payment: PAYMENT_OPTIONS[0],
      remark: '',
      items: [],
      status: 'pending',
      createdAt: '',
    };
  });

  // 抽屉
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: 'select',
    itemType: null,
    editIdx: -1,
  });

  // 体检表单
  const [chkDate, setChkDate] = useState(todayStr());
  const [chkTime, setChkTime] = useState('07:30');
  const [chkPax, setChkPax] = useState<PaxEntry[]>([emptyPax()]);
  const [showChkPaste, setShowChkPaste] = useState(false);
  const [chkPasteText, setChkPasteText] = useState('');
  // 粘贴导入弹窗的默认套餐（改为使用 selectedChkPkg）
  const [chkPastePkg, setChkPastePkg] = useState<string>('');
  // 体检改造：选中的套餐胶囊ID
  const [selectedChkPkg, setSelectedChkPkg] = useState<string>('');
  // 体检改造：各角色人数
  const [roleCounts, setRoleCounts] = useState<{ male: number; female_married: number; female_single: number }>({
    male: 0, female_married: 0, female_single: 0,
  });
  // 解析后预览弹窗
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [chkImportPreview, setChkImportPreview] = useState<{
    paxList: PaxEntry[];
    male: number;
    marriedFemale: number;
    singleFemale: number;
  }>({ paxList: [], male: 0, marriedFemale: 0, singleFemale: 0 });
  const [detailPaxIdx, setDetailPaxIdx] = useState<number | null>(null);
  // 套餐共享批量编辑：key=套餐code, value=CustomPackageItem[]
  //   undefined = 未做过批量修改，跟随套餐表默认项目
  //   数组 = 该套餐下所有"标准状态"人员的共享项目版本
  const [packageSharedEdits, setPackageSharedEdits] = useState<Record<string, CustomPackageItem[] | undefined>>({});
  // 单人编辑弹窗：当前正在编辑的人员索引
  const [editingPaxIdx, setEditingPaxIdx] = useState<number | null>(null);

  // 住宿表单（多房型）：默认值（新增行时自动带入） + 明细行
  type LodgingSession = {
    id: string;
    lodgingType: LodgingType;
    dateCheckIn: string;
    dateCheckOut: string;
    arrivalTime: string;
    rooms: number;
  };
  const [lgIn, setLgIn] = useState(todayStr());
  const [lgOut, setLgOut] = useState(fmt(addDays(new Date(), 1)));
  const [lgArr, setLgArr] = useState('14:00');
  const [lgRooms, setLgRooms] = useState(1);
  const [lgSessions, setLgSessions] = useState<LodgingSession[]>([]);

  // 用餐表单（多场次，每场含用餐标准/计价模式/特殊要求）
  const [mlSessions, setMlSessions] = useState<MealSession[]>([]);
  // 用餐标准弹出面板状态：null=无，否则=当前正在修改的场次索引
  const [mlPickerOpen, setMlPickerOpen] = useState<number | null>(null);

  // 会务表单
  const [mtSessions, setMtSessions] = useState<MeetingSession[]>([]);

  // 康乐表单
  const [wlSessions, setWlSessions] = useState<WellnessSession[]>([]);

  // 用车表单（单条会话，里面含客户一/二/三...列表）
  const [carSession, setCarSession] = useState<CarpickupSession>(() => ({
    date: todayStr(),
    startTime: '07:00',
    shareRide: false,
    pricePerCustomer: 0,
    customers: [],
  }));
  // 当前正在编辑的客户索引
  const [carActiveCust, setCarActiveCust] = useState<number>(0);

  // 页面状态
  const [err, setErr] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 销售员列表（从后端拉取，仅含 sales 角色的用户）
  const [salesUsers, setSalesUsers] = useState<BookingSalesUser[]>([]);
  const [salesPickerOpen, setSalesPickerOpen] = useState(false);
  // 4 类业务动态配置（含启用的套餐/房型/会议厅/康乐 + 体检项目库）
  const [bizConfig, setBizConfig] = useState<BookingConfig>({
    packages: [], roomTypes: [], meetingHalls: [], wellnessTypes: [], mealTypes: [], checkupItems: [], salesUsers: [],
  });
  // 体检项目库（供「追加项目」选择器使用）
  const [checkupItemsLib, setCheckupItemsLib] = useState<CheckupItemRow[]>([]);

  // 拉取配置（一次）：销售员 + 业务常量 + 体检项目库
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await bookingApi.getConfig();
        if (!mounted) return;
        setSalesUsers(Array.isArray(cfg.salesUsers) ? cfg.salesUsers : []);
        setCheckupItemsLib(Array.isArray(cfg.checkupItems) ? cfg.checkupItems.filter(c => c.status === 1) : []);
        setBizConfig({
          packages: Array.isArray(cfg.packages) ? cfg.packages : [],
          roomTypes: Array.isArray(cfg.roomTypes) ? cfg.roomTypes : [],
          meetingHalls: Array.isArray(cfg.meetingHalls) ? cfg.meetingHalls : [],
          wellnessTypes: Array.isArray(cfg.wellnessTypes) ? cfg.wellnessTypes : [],
          // 修复：补上 mealTypes（之前完全遗漏，导致 bizConfig.mealTypes 永远是空数组 → 午餐晚餐只显示 4 个 fallback）
          mealTypes: Array.isArray(cfg.mealTypes) ? cfg.mealTypes.filter((m: any) => Number(m.status) === 1) : [],
          checkupItems: Array.isArray(cfg.checkupItems) ? cfg.checkupItems : [],
          salesUsers: cfg.salesUsers || [],
        });
      } catch (e) {
        // 静默失败，下方使用兜底
      }
    })();
    return () => { mounted = false; };
  }, []);

  // 销售员名下套餐胶囊（Phase 4：选完销售员后自动加载）
  const [salesCapsules, setSalesCapsules] = useState<any[]>([]);
  const [capsulesLoading, setCapsulesLoading] = useState(false);

  useEffect(() => {
    const sid = draftGroup.salesPersonId;
    if (!sid) { setSalesCapsules([]); return; }
    let mounted = true;
    setCapsulesLoading(true);
    (async () => {
      try {
        const res = await checkupApi.listSalesCapsules(sid);
        if (!mounted) return;
        if (res?.ok) setSalesCapsules(res.data || []);
        else setSalesCapsules([]);
      } catch { if (mounted) setSalesCapsules([]); }
      finally { if (mounted) setCapsulesLoading(false); }
    })();
    return () => { mounted = false; };
  }, [draftGroup.salesPersonId]);

  // 胶囊查找：按 capsule.id 查找
  const capsuleMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const c of salesCapsules) m[c.id] = c;
    return m;
  }, [salesCapsules]);

  // 【关键】将销售胶囊 UUID 解析为套餐 code（短码如 A/B/C）
  // 因为 pax.package 可能存的是销售胶囊 id（UUID），而套餐项目查找需要 code
  function resolvePkgCode(pkgOrCapsuleId: string): string {
    const cap = capsuleMap[pkgOrCapsuleId];
    return cap?.code || pkgOrCapsuleId;
  }

  // 获取某 pax 的套餐折后价（基于胶囊 + 性别角色匹配）
  function getCapsulePriceForPax(p: PaxEntry): number {
    if (!p.package) return 0;
    const cap = capsuleMap[p.package];
    if (!cap) return 0;
    const role = paxToRole(p.gender, p.married);
    const plan = cap.prices?.[role];
    return Number(plan?.discount_price || 0);
  }
  const pkgMap = useMemo<Record<string, PackageRow & { label: string }>>(
    () => bizConfig.packages.reduce((acc, p) => {
      acc[p.code] = { ...p, label: `${p.name} · ¥${Number(p.price || 0).toLocaleString()}` };
      return acc;
    }, {} as Record<string, PackageRow & { label: string }>),
    [bizConfig.packages],
  );
  const roomMap = useMemo<Record<string, RoomTypeRow>>(
    () => bizConfig.roomTypes.reduce((acc, r) => { acc[r.code] = r; return acc; }, {} as Record<string, RoomTypeRow>),
    [bizConfig.roomTypes],
  );
  const hallMap = useMemo<Record<string, MeetingHallRow>>(
    () => bizConfig.meetingHalls.reduce((acc, r) => { acc[r.code] = r; return acc; }, {} as Record<string, MeetingHallRow>),
    [bizConfig.meetingHalls],
  );
  const wellnessMap = useMemo<Record<string, WellnessTypeRow>>(
    () => bizConfig.wellnessTypes.reduce((acc, r) => { acc[r.code] = r; return acc; }, {} as Record<string, WellnessTypeRow>),
    [bizConfig.wellnessTypes],
  );
  const pkgNameToCode = useMemo<Record<string, string>>(
    () => bizConfig.packages.reduce((acc, p) => { acc[p.name] = p.code; return acc; }, {} as Record<string, string>),
    [bizConfig.packages],
  );
  const roomNameToCode = useMemo<Record<string, string>>(
    () => bizConfig.roomTypes.reduce((acc, r) => { acc[r.name] = r.code; return acc; }, {} as Record<string, string>),
    [bizConfig.roomTypes],
  );
  const hallNameToCode = useMemo<Record<string, string>>(
    () => bizConfig.meetingHalls.reduce((acc, r) => { acc[r.name] = r.code; return acc; }, {} as Record<string, string>),
    [bizConfig.meetingHalls],
  );
  const wellnessNameToCode = useMemo<Record<string, string>>(
    () => bizConfig.wellnessTypes.reduce((acc, r) => { acc[r.name] = r.code; return acc; }, {} as Record<string, string>),
    [bizConfig.wellnessTypes],
  );

  // 下拉选项（按 sort_order 排序）：仅启用项
  const pkgOptions = useMemo(() => bizConfig.packages.filter(p => p.status === 1), [bizConfig.packages]);
  const roomOptions = useMemo(() => bizConfig.roomTypes.filter(p => p.status === 1), [bizConfig.roomTypes]);
  const hallOptions = useMemo(() => bizConfig.meetingHalls.filter(p => p.status === 1), [bizConfig.meetingHalls]);
  const wellnessOptions = useMemo(() => bizConfig.wellnessTypes.filter(p => p.status === 1), [bizConfig.wellnessTypes]);
  const mealOptions = useMemo(() => (bizConfig.mealTypes || []).filter(p => p.status === 1), [bizConfig.mealTypes]);

  // 兜底：如果后端没返回数据（首次部署未执行迁移），用硬编码保证 UI 可用
  const finalPkgOptions = pkgOptions.length > 0
    ? pkgOptions
    : ([
        { id: 'fb_A', code: 'A', name: '基础体检套餐', price: 588, status: 1, sort_order: 1 },
        { id: 'fb_B', code: 'B', name: '综合体检套餐', price: 1288, status: 1, sort_order: 2 },
        { id: 'fb_C', code: 'C', name: '深度体检套餐', price: 2888, status: 1, sort_order: 3 },
        { id: 'fb_D', code: 'D', name: 'VIP体检套餐', price: 5888, status: 1, sort_order: 4 },
      ] as PackageRow[]);
  const finalRoomOptions = roomOptions.length > 0 ? roomOptions : ([
    { id: 'fb_std', code: 'standard', name: '标准间', price: 480, status: 1, sort_order: 1 },
    { id: 'fb_big', code: 'bigbed', name: '大床房', price: 520, status: 1, sort_order: 2 },
    { id: 'fb_sui', code: 'suite', name: '套房', price: 880, status: 1, sort_order: 3 },
    { id: 'fb_vip', code: 'vipsuite', name: 'VIP套房', price: 1880, status: 1, sort_order: 4 },
  ] as RoomTypeRow[]);
  const finalHallOptions = hallOptions.length > 0 ? hallOptions : ([
    { id: 'fb_sj', code: 'siji', name: '四季厅', capacity: 80, half_price: 2000, full_price: 3500, status: 1, sort_order: 1 },
    { id: 'fb_ss', code: 'shanshui', name: '山水厅', capacity: 40, half_price: 1200, full_price: 2200, status: 1, sort_order: 2 },
    { id: 'fb_qq', code: 'qingquan', name: '清泉厅', capacity: 20, half_price: 600, full_price: 1100, status: 1, sort_order: 3 },
    { id: 'fb_wh', code: 'wanghu', name: '望湖厅', capacity: 120, half_price: 3000, full_price: 5800, status: 1, sort_order: 4 },
  ] as MeetingHallRow[]);
  const finalWellnessOptions = wellnessOptions.length > 0 ? wellnessOptions : ([
    { id: 'fb_mj', code: 'mahjong', name: '棋牌室', min_hours: 4, package_hours: 4, price: 200, price_guest: 200, price_external: 250, time_window: null, pricing_mode: 'package' as const, is_free: 0, status: 1, sort_order: 1 },
    { id: 'fb_fish', code: 'fishing', name: '钓鱼', min_hours: 0, package_hours: 12, price: 200, price_guest: 200, price_external: 250, time_window: '06:00-18:00', pricing_mode: 'package' as const, is_free: 0, status: 1, sort_order: 2 },
    { id: 'fb_ktv', code: 'ktv', name: 'KTV大包', min_hours: 0, package_hours: 3, price: 688, price_guest: 688, price_external: 688, time_window: null, pricing_mode: 'package' as const, is_free: 0, status: 1, sort_order: 3 },
    { id: 'fb_ks', code: 'ktv_small', name: 'KTV小包', min_hours: 0, package_hours: 3, price: 488, price_guest: 488, price_external: 488, time_window: null, pricing_mode: 'package' as const, is_free: 0, status: 1, sort_order: 4 },
    { id: 'fb_swim', code: 'swimming', name: '游泳池', min_hours: 0, package_hours: 0, price: 0, price_guest: 0, price_external: 0, time_window: null, pricing_mode: 'per_hour' as const, is_free: 1, status: 1, sort_order: 5 },
    { id: 'fb_gym', code: 'gym', name: '健身房', min_hours: 0, package_hours: 0, price: 0, price_guest: 0, price_external: 0, time_window: null, pricing_mode: 'per_hour' as const, is_free: 1, status: 1, sort_order: 6 },
    { id: 'fb_bl', code: 'billiards', name: '台球室', min_hours: 0, package_hours: 0, price: 0, price_guest: 0, price_external: 0, time_window: null, pricing_mode: 'per_hour' as const, is_free: 1, status: 1, sort_order: 7 },
    { id: 'fb_tt', code: 'tabletennis', name: '乒乓房', min_hours: 0, package_hours: 0, price: 0, price_guest: 0, price_external: 0, time_window: null, pricing_mode: 'per_hour' as const, is_free: 1, status: 1, sort_order: 8 },
  ] as WellnessTypeRow[]);
  const finalMealOptions = mealOptions.length > 0 ? mealOptions : ([
    { id: 'fb_work', code: 'work', name: '工作餐', pricing_mode: 'per_person', unit_price: 30, default_time: '12:00', default_tables: 1, default_per_table: 10, default_pax: 20, status: 1, sort_order: 1 },
    { id: 'fb_std', code: 'standard', name: '标准桌餐', pricing_mode: 'per_table', unit_price: 500, default_time: '12:00', default_tables: 2, default_per_table: 10, default_pax: 0, status: 1, sort_order: 2 },
    { id: 'fb_prem', code: 'premium', name: '豪华桌餐', pricing_mode: 'per_table', unit_price: 1200, default_time: '12:00', default_tables: 2, default_per_table: 10, default_pax: 0, status: 1, sort_order: 3 },
    { id: 'fb_buf', code: 'buffet', name: '自助餐', pricing_mode: 'per_person', unit_price: 128, default_time: '12:00', default_tables: 1, default_per_table: 10, default_pax: 20, status: 1, sort_order: 4 },
  ] as MealTypeRow[]);

  // 查找 code→显示信息（优先用动态配置，其次用 constants 的兜底常量）
  function getPackageInfo(code: string): { name: string; price: number; label: string; items?: any[]; autoTotal?: number } {
    // 先匹配销售胶囊（按id精确匹配）
    const cap = capsuleMap[code];
    if (cap) {
      // 传入已知套餐列表用于智能匹配
      const name = friendlyCapsuleName(cap, finalPkgOptions);
      // 价格取第一个非零角色价（兜底展示价）
      const prices = cap.prices || {};
      const price = Math.max(
        Number(prices.male?.discount_price || 0),
        Number(prices.female_married?.discount_price || 0),
        Number(prices.female_single?.discount_price || 0),
      );
      const items: any[] = cap.items && Array.isArray(cap.items) ? cap.items : [];
      const autoTotal = items.reduce((s: number, i: any) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
      return {
        name,
        price: price > 0 ? price : autoTotal,
        label: `${name}`,
        items,
        autoTotal,
      };
    }
    // 回退1：从 pkgMap（动态配置的套餐）按 code 查找
    const row = pkgMap[code] ?? finalPkgOptions.find(p => p.code === code);
    if (row) {
      const explicitPrice = Number(row.price || 0);
      const items = (row as any).items || [];
      const autoTotal = items.reduce((s: number, i: any) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
      const price = explicitPrice > 0 ? explicitPrice : autoTotal;
      return { name: row.name, price, label: `${row.code} · ${row.name} ¥${price.toLocaleString()}`, items, autoTotal };
    }
    // 回退2：通过名称反查 code（处理从导入数据中存的是名称而非 code 的情况）
    const byName = pkgNameToCode[code];
    if (byName && byName !== code) {
      return getPackageInfo(byName);
    }
    // 回退3：硬编码常量兜底
    const fb = (CHECKUP_PACKAGES as any)[code];
    if (fb) return { name: fb.name, price: fb.price, label: `${code} · ${fb.name} ¥${fb.price.toLocaleString()}` };
    // 最终兜底：返回 code 本身（用户可见，便于调试）
    return { name: code || '未知套餐', price: 0, label: code || '未知套餐' };
  }
  function getRoomInfo(code: string): { name: string; price: number } {
    const row = roomMap[code] ?? finalRoomOptions.find(p => p.code === code);
    if (row) return { name: row.name, price: Number(row.price || 0) };
    const fb = (LODGING_TYPES as any)[code];
    return fb ? { name: fb.name, price: fb.price } : { name: code, price: 0 };
  }
  function getHallInfo(code: string): { name: string; capacity: number; halfPrice: number; fullPrice: number } {
    const row = hallMap[code] ?? finalHallOptions.find(p => p.code === code);
    if (row) return { name: row.name, capacity: Number(row.capacity || 0), halfPrice: Number(row.half_price || 0), fullPrice: Number(row.full_price || 0) };
    const fb = (MEETING_HALLS as any)[code];
    return fb ? { name: fb.name, capacity: fb.capacity, halfPrice: fb.halfPrice, fullPrice: fb.fullPrice }
              : { name: code, capacity: 0, halfPrice: 0, fullPrice: 0 };
  }
  function getWellnessInfo(code: string): { name: string; minHours: number; price: number; free: boolean } {
    const row = wellnessMap[code] ?? finalWellnessOptions.find(p => p.code === code);
    if (row) return { name: row.name, minHours: Number(row.min_hours || 0), price: Number(row.price || 0), free: Number(row.is_free) === 1 };
    const fb = (WELLNESS_TYPES as any)[code];
    return fb ? { name: fb.name, minHours: fb.minHours, price: fb.price, free: fb.free }
              : { name: code, minHours: 0, price: 0, free: false };
  }
  const finalBizConfigForCalc = {
    packages: finalPkgOptions,
    roomTypes: finalRoomOptions,
    meetingHalls: finalHallOptions,
    wellnessTypes: finalWellnessOptions,
  };

  // 住宿：入住日期变化时，保证离店日期 >= 入住日期 + 1 天
  useEffect(() => {
    if (!drawer.open || drawer.itemType !== 'lodging') return;
    if (!lgIn) return;
    const minOut = fmt(addDays(parseDateLocal(lgIn), 1));
    if (!lgOut || parseDateLocal(lgOut) < parseDateLocal(minOut)) {
      setLgOut(minOut);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lgIn, drawer.open, drawer.itemType]);

  // 派生：订单内是否含住宿项（任意 lodging 项 = 入住客人）
  const isGuest = useMemo(
    () => draftGroup.items.some((it) => it.itemType === 'lodging'),
    [draftGroup.items],
  );

  // 体检改造：从胶囊获取指定角色的价格（必须在 drawerAmount 前声明，避免 TDZ）
  function getCapsulePriceByRole(capsuleId: string, role: 'male' | 'female_married' | 'female_single'): number {
    const cap = capsuleMap[capsuleId];
    if (!cap) return 0;
    const plan = cap.prices?.[role];
    return Number(plan?.discount_price || 0);
  }

  // 体检改造：按角色人数计算合计金额
  const roleBasedTotal = useMemo(() => {
    if (!selectedChkPkg) return 0;
    return (
      roleCounts.male * getCapsulePriceByRole(selectedChkPkg, 'male') +
      roleCounts.female_married * getCapsulePriceByRole(selectedChkPkg, 'female_married') +
      roleCounts.female_single * getCapsulePriceByRole(selectedChkPkg, 'female_single')
    );
  }, [selectedChkPkg, roleCounts, capsuleMap]);

  // 体检改造：统计已导入名单的角色人数
  const importedRoleCounts = useMemo(() => {
    const list = chkPax.filter(p => p.name.trim());
    const counts = { male: 0, female_married: 0, female_single: 0 };
    for (const p of list) {
      if (p.gender === '男') counts.male++;
      else if (p.gender === '女') {
        // married 字段是布尔值 true/false（checkbox 写入 + emptyPax 默认），不能用字符串比较
        if (p.married) counts.female_married++;
        else counts.female_single++;
      }
    }
    return counts;
  }, [chkPax]);

  // 体检改造：剩余需绑定的各角色人数
  const remainingRoleCounts = useMemo(() => ({
    male: Math.max(0, roleCounts.male - importedRoleCounts.male),
    female_married: Math.max(0, roleCounts.female_married - importedRoleCounts.female_married),
    female_single: Math.max(0, roleCounts.female_single - importedRoleCounts.female_single),
  }), [roleCounts, importedRoleCounts]);

  // 方案1：实时重算所有康乐项金额（含住宿状态变化时自动按入住/不住宿切换单价）
  useEffect(() => {
    setDraftGroup((g) => {
      let changed = false;
      const newItems = g.items.map((it) => {
        if (it.itemType !== 'wellness') return it;
        const sessions = (it.extra?.sessions as WellnessSession[] | undefined) || [];
        if (sessions.length === 0) return it;
        const newAmount = sessions.reduce(
          (s, x) => s + calcWellnessAmount(x.wellnessType, x.hours, finalBizConfigForCalc, isGuest),
          0,
        );
        if (newAmount !== (it.amount || 0)) {
          changed = true;
          return { ...it, amount: newAmount };
        }
        return it;
      });
      return changed ? { ...g, items: newItems } : g;
    });
  }, [isGuest, finalBizConfigForCalc]);

  // 总金额
  const totalAmount = useMemo(() => groupTotal(draftGroup), [draftGroup]);

  // 抽屉内实时金额
  const drawerAmount = useMemo(() => {
    const t = drawer.itemType;
    if (!t) return 0;
    if (t === 'checkup') {
      // 如果已选套餐，使用角色人数计算合计；否则回退到名单计算
      if (selectedChkPkg && roleBasedTotal > 0) return roleBasedTotal;
      return calcCheckupEffective(chkPax.filter((p) => p.name.trim()));
    }
    if (t === 'lodging')
      return lgSessions.reduce((s, x) => {
        const n = Math.max(0, daysBetween(x.dateCheckIn, x.dateCheckOut));
        return s + calcLodgingAmount(x.lodgingType, x.rooms, n, finalBizConfigForCalc);
      }, 0);
    if (t === 'lunch' || t === 'dinner')
      return mlSessions.reduce((s, x) => s + calcMealAmount(x.pricingMode, x.unitPrice, x.tables, x.perTable, x.pax), 0);
    if (t === 'meeting')
      return mtSessions.reduce((s, x) => s + calcMeetingAmount(x.hall, x.slotType, finalBizConfigForCalc), 0);
    if (t === 'wellness')
      return wlSessions.reduce((s, x) => s + calcWellnessAmount(x.wellnessType, x.hours, finalBizConfigForCalc, isGuest), 0);
    if (t === 'carpickup') {
      if (!carSession.customers?.length) return 0;
      return carSession.customAmount !== undefined && carSession.customAmount !== null
        ? Number(carSession.customAmount)
        : Math.max(0, carSession.customers.length * Number(carSession.pricePerCustomer || 0));
    }
    return 0;
  }, [drawer.itemType, chkPax, lgSessions, mlSessions, mtSessions, wlSessions, carSession, finalBizConfigForCalc, selectedChkPkg, roleBasedTotal, isGuest]);

  // ================================================
  // 抽屉操作
  // ================================================
  function openAdd() {
    setDrawer({ open: true, mode: 'select', itemType: null, editIdx: -1 });
  }

  function selectBizType(type: BizType) {
    setDrawer({ open: true, mode: 'form', itemType: type, editIdx: -1 });
    if (type === 'checkup') {
      setChkDate(todayStr());
      setChkTime('07:30');
      setChkPax([emptyPax()]);
      setSelectedChkPkg('');
      setRoleCounts({ male: 0, female_married: 0, female_single: 0 });
    } else if (type === 'lodging') {
      setLgIn(todayStr());
      setLgOut(fmt(addDays(new Date(), 1)));
      setLgArr('14:00');
      setLgRooms(1);
      setLgSessions([]);
    } else if (type === 'lunch' || type === 'dinner') {
      setMlSessions([]);
    } else if (type === 'meeting') {
      setMtSessions([
        { date: todayStr(), startTime: '09:00', hall: 'siji', slotType: 'full', pax: 20 },
      ]);
    } else if (type === 'wellness') {
      setWlSessions([
        { date: todayStr(), startTime: '15:00', wellnessType: 'mahjong', hours: 4, pax: 2 },
      ]);
    } else if (type === 'carpickup') {
      // 用车：默认 1 个客户，填入截图1的示例
      const firstCustomer: CarCustomer = {
        contactName: '孙老师',
        contactPhone: '15921728857',
        paxCount: 20,
        pickupDate: todayStr(),
        pickupTime: '7:00',
        pickupRoute: '7:00重固镇政府--7:40画一（走高速）',
        dropoffDate: todayStr(),
        dropoffTime: '体检结束后',
        dropoffRoute: '原路送回',
      };
      setCarSession({
        date: firstCustomer.pickupDate,
        startTime: firstCustomer.pickupTime,
        shareRide: false,
        pricePerCustomer: 0,
        customers: [firstCustomer],
      });
      setCarActiveCust(0);
    }
  }

  function openEdit(item: BookingItem, idx: number) {
    setDrawer({ open: true, mode: 'form', itemType: item.itemType, editIdx: idx });
    if (item.itemType === 'checkup') {
      setChkDate(item.date || todayStr());
      // B-1：chkTime 兜底改为 07:30（与新建默认一致）
      setChkTime(item.startTime || '07:30');
      const paxListBackup = (item.extra.paxList || []).map((p) => ({ ...p }));
      // 第5期：编辑时从 finalItems 快照恢复 customItems，确保定制内容可继续编辑
      setChkPax(restoreCustomItemsFromSnapshot(paxListBackup));
      // B-2：恢复 selectedChkPkgId（优先 extra 中保存的，其次从首个 pax.package 反推）
      const savedPkgId = (item.extra as any)?.selectedChkPkgId;
      const firstPaxPkg = paxListBackup.find((p: any) => p && p.package)?.package as string | undefined;
      setSelectedChkPkg(savedPkgId || firstPaxPkg || '');
      // B-3：恢复 roleCounts（优先 extra 中保存的；老数据则从 paxList 反推，保证至少能对齐名单人数）
      const savedCounts = (item.extra as any)?.roleCounts;
      if (savedCounts && (Number(savedCounts.male) + Number(savedCounts.female_married) + Number(savedCounts.female_single)) > 0) {
        setRoleCounts({
          male: Number(savedCounts.male) || 0,
          female_married: Number(savedCounts.female_married) || 0,
          female_single: Number(savedCounts.female_single) || 0,
        });
      } else {
        let male = 0, marriedF = 0, singleF = 0;
        for (const p of paxListBackup) {
          const any = p as any;
          if (!any?.name) continue;
          if (any.gender === '男') male++;
          else if (any.gender === '女') {
            // married 字段可能是布尔值或字符串 '已婚'，两者都视为真
            const isMarried = any.married === true || any.married === '已婚';
            if (isMarried) marriedF++; else singleF++;
          }
        }
        setRoleCounts({ male, female_married: marriedF, female_single: singleF });
      }
      // 清理套餐共享编辑缓存（避免带入上次状态）
      setPackageSharedEdits({});
    } else if (item.itemType === 'lodging') {
      setLgIn(item.extra.dateCheckIn || todayStr());
      setLgOut(item.extra.dateCheckOut || fmt(addDays(new Date(), 1)));
      setLgArr(item.extra.arrivalTime || '14:00');
      setLgRooms(item.pax || 1);
      setLgSessions([{
        id: item.id,
        lodgingType: item.extra.lodgingType || 'standard',
        dateCheckIn: item.extra.dateCheckIn || todayStr(),
        dateCheckOut: item.extra.dateCheckOut || fmt(addDays(new Date(), 1)),
        arrivalTime: item.extra.arrivalTime || '14:00',
        rooms: item.pax || 1,
      }]);
    } else if (item.itemType === 'lunch' || item.itemType === 'dinner') {
      setMlSessions((item.extra.sessions as MealSession[] || []).map((s) => ({
        date: s.date || todayStr(),
        time: s.time || '12:00',
        mealType: s.mealType || 'work',
        pricingMode: (s as any).pricingMode || 'per_table',
        unitPrice: (s as any).unitPrice ?? 0,
        tables: s.tables ?? 1,
        perTable: s.perTable ?? 10,
        pax: (s as any).pax ?? 0,
        remark: (s as any).remark || '',
      })));
    } else if (item.itemType === 'meeting') {
      setMtSessions((item.extra.sessions as MeetingSession[] || []).map((s) => ({ ...s })));
    } else if (item.itemType === 'wellness') {
      setWlSessions((item.extra.sessions as WellnessSession[] || []).map((s) => ({ ...s })));
    } else if (item.itemType === 'carpickup') {
      const sess: CarpickupSession = item.extra?.carpickup
        ? (item.extra.carpickup as CarpickupSession)
        : {
            date: item.date || todayStr(),
            startTime: item.startTime || '07:00',
            shareRide: false,
            pricePerCustomer: 0,
            customAmount: item.amount,
            customers: [],
          };
      if (!sess.customers || sess.customers.length === 0) {
        // 兼容老数据：至少保留一个空客户
        sess.customers = [{
          contactName: '', contactPhone: '', paxCount: 0,
          pickupDate: sess.date || todayStr(), pickupTime: sess.startTime || '07:00',
          pickupRoute: '', dropoffDate: sess.date || todayStr(),
          dropoffTime: '', dropoffRoute: '',
        }];
      }
      setCarSession(sess);
      setCarActiveCust(0);
    }
  }

  function closeDrawer() {
    setDrawer({ open: false, mode: 'select', itemType: null, editIdx: -1 });
  }

  function updChkPax(idx: number, patch: Partial<PaxEntry>) {
    setChkPax((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const next = { ...p, ...patch };
      // 套餐变更时重置 customItems
      if (patch.package && patch.package !== p.package) {
        next.customItems = null;
      }
      return next;
    }));
  }

  // 定制：移除单项
  function removePaxItem(idx: number, itemIdx: number) {
    setChkPax((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const pkgKey = resolvePkgCode(p.package);
      const base = resolvePaxItems({ ...p, package: pkgKey }, finalBizConfigForCalc);
      const next = base.filter((_, j) => j !== itemIdx);
      return { ...p, customItems: next };
    }));
  }

  // 定制：按 item_id 移除项目（用于 diff 回调整）
  function removePaxItemById(idx: number, itemId: string) {
    setChkPax((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const pkgKey = resolvePkgCode(p.package);
      const base = resolvePaxItems({ ...p, package: pkgKey }, finalBizConfigForCalc);
      const next = base.filter((it: any) => String(it.item_id || it.id || '') !== itemId);
      return { ...p, customItems: next };
    }));
  }

  // 定制：重置为套餐原始项目
  function resetPaxItems(idx: number) {
    setChkPax((prev) => prev.map((p, i) => (i === idx ? { ...p, customItems: null } : p)));
  }

  // 定制：从项目库追加项目
  function addItemToPax(idx: number, ci: CheckupItemRow) {
    setChkPax((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const pkgKey = resolvePkgCode(p.package);
      const base = resolvePaxItems({ ...p, package: pkgKey }, finalBizConfigForCalc);
      const next: CustomPackageItem[] = [
        ...base,
        {
          item_id: ci.id,
          item_name_snapshot: ci.name,
          item_price: ci.default_price || 0,
          quantity: 1,
          remark: '',
          __temporary: true,
        },
      ];
      return { ...p, customItems: next };
    }));
  }

  // 定制：更新某项单价/数量/备注
  function updatePaxItemField(idx: number, itemIdx: number, field: 'item_price' | 'quantity' | 'remark', val: any) {
    setChkPax((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      const pkgKey = resolvePkgCode(p.package);
      const base = resolvePaxItems({ ...p, package: pkgKey }, finalBizConfigForCalc);
      const next = [...base];
      next[itemIdx] = { ...next[itemIdx], [field]: val };
      return { ...p, customItems: next };
    }));
  }

  // ============================================================
  // 套餐汇总层：项目有效解析 + 套餐共享批量编辑
  // ============================================================

  // 【有效解析】获取一个 pax 的最终项目列表
  // 优先级：pax.customItems（独立定制）> packageSharedEdits[package] > 套餐表默认
  function resolvePaxItemsEffective(p: PaxEntry): CustomPackageItem[] {
    if (p.customItems && p.customItems.length > 0) {
      return p.customItems;
    }
    // 关键：将销售胶囊 UUID 解析为套餐 code
    const pkgKey = resolvePkgCode(p.package);
    const shared = packageSharedEdits[p.package] ?? packageSharedEdits[pkgKey];
    if (shared && shared.length > 0) {
      return shared;
    }
    if (shared && shared.length === 0) {
      // 批量清空了项目
      return [];
    }
    // 用解析后的 code 构建临时 pax 进行查找
    return resolvePaxItems({ ...p, package: pkgKey }, finalBizConfigForCalc);
  }

  // 【有效解析】获取一个 pax 的最终金额
  // 优先级：customItems > sharedEdits(非空) > 销售胶囊(按性别角色匹配) > 传统套餐单价
  function calcSinglePaxEffective(p: PaxEntry): number {
    if (p.customItems && p.customItems.length > 0) {
      return p.customItems.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
    }
    // 关键：解析销售胶囊 UUID → 套餐 code
    const pkgKey = resolvePkgCode(p.package);
    const shared = packageSharedEdits[p.package] ?? packageSharedEdits[pkgKey];
    // 修复：只在 shared 有内容时才使用 shared 计算（空数组 [] 视为未设置）
    if (shared && shared.length > 0) {
      return shared.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
    }
    // Phase 4：如果该套餐是销售胶囊中的套餐，按性别角色匹配折后价
    const capPrice = getCapsulePriceForPax(p);
    if (capPrice > 0) return capPrice;
    return calcSinglePaxAmount({ ...p, package: pkgKey }, finalBizConfigForCalc);
  }

  // 【有效解析】合计体检总额（用于UI展示，不影响保存）
  function calcCheckupEffective(paxList: PaxEntry[]): number {
    return paxList.reduce((s, p) => s + calcSinglePaxEffective(p), 0);
  }

  // 获取某套餐的共享项目（未设置共享版则返回套餐默认）
  function getSharedItems(pkgCode: string): CustomPackageItem[] {
    // 关键：将销售胶囊 UUID 解析为套餐 code
    const lookupCode = resolvePkgCode(pkgCode);
    const shared = packageSharedEdits[pkgCode] ?? packageSharedEdits[lookupCode];
    if (shared) return shared;
    const pkgMap = (finalBizConfigForCalc?.packages || []).reduce((acc: any, r: any) => { acc[r.code] = r; return acc; }, {});
    const row = pkgMap[lookupCode];
    if (row && row.items && row.items.length > 0) {
      return row.items.map((i: any) => ({
        item_id: i.item_id,
        item_name_snapshot: i.item_name_snapshot,
        item_price: Number(i.item_price || 0),
        quantity: Number(i.quantity || 1),
        remark: (i as any).remark || '',
        __temporary: false,
      }));
    }
    // fallback: 套餐表没返回 items，用 resolvePaxItems 传入一个假的 pax 来兜底
    const fake: PaxEntry = { name: '', idCard: '', phone: '', gender: '男', married: false, package: lookupCode as PackageCode };
    return resolvePaxItems(fake, finalBizConfigForCalc);
  }

  // 判断套餐是否有独立于默认的共享修改
  function hasSharedEdits(pkgCode: string): boolean {
    const lookupCode = resolvePkgCode(pkgCode);
    return packageSharedEdits[pkgCode] !== undefined || packageSharedEdits[lookupCode] !== undefined;
  }

  // ==== 套餐共享批量编辑操作 ====

  // 套餐共享版：追加项目
  function addSharedItem(pkgCode: string, ci: CheckupItemRow) {
    const base = getSharedItems(pkgCode);
    const next: CustomPackageItem[] = [
      ...base,
      {
        item_id: ci.id,
        item_name_snapshot: ci.name,
        item_price: ci.default_price || 0,
        quantity: 1,
        remark: '',
        __temporary: true,
      },
    ];
    setPackageSharedEdits(prev => ({ ...prev, [resolvePkgCode(pkgCode)]: next }));
  }

  // 套餐共享版：移除项目
  function removeSharedItem(pkgCode: string, itemIdx: number) {
    const base = getSharedItems(pkgCode);
    const next = base.filter((_, i) => i !== itemIdx);
    setPackageSharedEdits(prev => ({ ...prev, [resolvePkgCode(pkgCode)]: next }));
  }

  // 套餐共享版：按 item_id 移除项目（用于 diff 回调整）
  function removeSharedItemById(pkgCode: string, itemId: string) {
    const base = getSharedItems(pkgCode);
    const next = base.filter((it: any) => String(it.item_id || it.id || '') !== itemId);
    setPackageSharedEdits(prev => ({ ...prev, [resolvePkgCode(pkgCode)]: next }));
  }

  // 套餐共享版：更新某个字段
  function updateSharedItemField(pkgCode: string, itemIdx: number, field: 'item_price' | 'quantity' | 'remark', val: any) {
    const base = [...getSharedItems(pkgCode)];
    base[itemIdx] = { ...base[itemIdx], [field]: val };
    setPackageSharedEdits(prev => ({ ...prev, [resolvePkgCode(pkgCode)]: base }));
  }

  // 套餐共享版：重置为套餐默认（清掉 sharedEdits 记录）
  function resetSharedItems(pkgCode: string) {
    setPackageSharedEdits(prev => {
      const next = { ...prev };
      const key = resolvePkgCode(pkgCode);
      delete next[pkgCode];
      delete next[key];
      return next;
    });
  }

  // 套餐汇总统计：按套餐分组
  function getPaxGroups(paxList: PaxEntry[]): Record<string, PaxEntry[]> {
    const groups: Record<string, PaxEntry[]> = {};
    paxList.forEach(p => {
      if (!groups[p.package]) groups[p.package] = [];
      groups[p.package].push(p);
    });
    return groups;
  }

  // 判断某个 pax 是否已独立定制（customItems !== null && customItems !== undefined）
  function isPaxCustomized(p: PaxEntry): boolean {
    return p.customItems !== null && p.customItems !== undefined;
  }

  function saveDrawer() {
    const itemType = drawer.itemType;
    if (!itemType) return;
    let item: BookingItem;
    const keepId =
      drawer.editIdx >= 0 && drawer.editIdx < draftGroup.items.length
        ? draftGroup.items[drawer.editIdx].id
        : genItemId();

    if (itemType === 'checkup') {
      const paxListRaw = chkPax.filter((p) => p.name.trim());
      // 【A-1】角色设定总人数（0 表示未启用角色人数模式）
      const rolePaxTotal = roleCounts.male + roleCounts.female_married + roleCounts.female_single;
      // 名单人数至少 1（否则直接返回错误）
      if (paxListRaw.length === 0 && rolePaxTotal === 0) {
        setErr('请至少添加一名体检人员，或设置角色人数');
        return;
      }
      // 为每个 pax 嵌入最终快照，消除后续订单详情对项目库/套餐表的依赖
      const paxList = paxListRaw.map(p => {
        const finalItems = resolvePaxItemsEffective(p);
        return {
          ...p,
          finalItems,
          finalAmount: calcSinglePaxEffective(p),
        };
      });
      // 【A-2】金额口径：角色总人数>0 且已选套餐时用 roleBasedTotal，否则按名单逐人计算
      const amount = (selectedChkPkg && rolePaxTotal > 0 && roleBasedTotal > 0)
        ? roleBasedTotal
        : calcCheckupEffective(paxListRaw);
      // 【A-3】pax 人数：优先角色总人数，否则名单人数
      const displayPax = rolePaxTotal > 0 ? rolePaxTotal : paxList.length;
      item = {
        id: keepId,
        itemType,
        date: chkDate,
        startTime: chkTime,
        pax: displayPax,
        extra: {
          paxList,
          packageTotal: amount,
          // 【A-4】保存角色设定信息，供编辑时恢复
          selectedChkPkgId: selectedChkPkg || undefined,
          roleCounts: rolePaxTotal > 0 ? { ...roleCounts } : undefined,
          paxListCount: paxList.length,
        },
        amount,
      };
    } else if (itemType === 'lodging') {
      const sessions = lgSessions.filter(s =>
        s.dateCheckIn && s.dateCheckOut && daysBetween(s.dateCheckIn, s.dateCheckOut) >= 1
      );
      if (sessions.length === 0) {
        setErr('请至少添加一个房型并设置有效的日期（离店至少晚于入住 1 天）');
        return;
      }
      const newItems: BookingItem[] = sessions.map((s, i) => {
        const nights = daysBetween(s.dateCheckIn, s.dateCheckOut);
        const amt = calcLodgingAmount(s.lodgingType, s.rooms, nights, finalBizConfigForCalc);
        return {
          id: i === 0 ? keepId : (s.id && s.id.startsWith('lg_') ? s.id : genItemId()),
          itemType,
          date: s.dateCheckIn,
          startTime: s.arrivalTime,
          pax: s.rooms,
          extra: {
            lodgingType: s.lodgingType,
            dateCheckIn: s.dateCheckIn,
            dateCheckOut: s.dateCheckOut,
            arrivalTime: s.arrivalTime,
            nights,
          },
          amount: amt,
        };
      });
      setDraftGroup((g) => {
        const items = [...g.items];
        if (drawer.editIdx >= 0 && drawer.editIdx < items.length) {
          // 编辑：替换当前 idx，其他项一起插入
          if (newItems.length === 1) {
            items[drawer.editIdx] = newItems[0];
          } else {
            items.splice(drawer.editIdx, 1, ...newItems);
          }
        } else {
          items.push(...newItems);
        }
        return { ...g, items };
      });
      setErr('');
      closeDrawer();
      return;
    } else if (itemType === 'lunch' || itemType === 'dinner') {
      const sessions = mlSessions.filter((s) => s.date);
      if (sessions.length === 0) {
        setErr('请至少添加一场用餐');
        return;
      }
      const amount = sessions.reduce((s, x) => s + calcMealAmount(x.pricingMode, x.unitPrice, x.tables, x.perTable, x.pax), 0);
      item = {
        id: keepId,
        itemType,
        date: sessions[0].date,
        startTime: sessions[0].time,
        pax: sessions.reduce((s, x) => s + (x.pricingMode === 'per_person' ? 0 : (x.tables || 0)), 0),
        extra: { sessions: sessions as any },
        amount,
      };
    } else if (itemType === 'meeting') {
      const sessions = mtSessions.filter((s) => s.date);
      if (sessions.length === 0) {
        setErr('请至少添加一场会务');
        return;
      }
      const amount = sessions.reduce((s, x) => s + calcMeetingAmount(x.hall, x.slotType, finalBizConfigForCalc), 0);
      item = {
        id: keepId,
        itemType,
        date: sessions[0].date,
        startTime: sessions[0].startTime,
        pax: sessions.reduce((s, x) => s + x.pax, 0),
        extra: { sessions: sessions as any },
        amount,
      };
    } else if (itemType === 'wellness') {
      // wellness
      const sessions = wlSessions.filter((s) => s.date);
      if (sessions.length === 0) {
        setErr('请至少添加一场康乐');
        return;
      }
      const amount = sessions.reduce((s, x) => s + calcWellnessAmount(x.wellnessType, x.hours, finalBizConfigForCalc, isGuest), 0);
      item = {
        id: keepId,
        itemType,
        date: sessions[0].date,
        startTime: sessions[0].startTime,
        pax: sessions.reduce((s, x) => s + x.pax, 0),
        extra: { sessions: sessions as any },
        amount,
      };
    } else if (itemType === 'carpickup') {
      const sess = carSession;
      if (!sess.customers || sess.customers.length === 0) {
        setErr('请至少添加一位用车客户');
        return;
      }
      // 校验第一个客户的接客日期/时间必填
      const first = sess.customers[0];
      if (!first.pickupDate) {
        setErr('第一个客户的接客日期必填');
        return;
      }
      // 计算金额：手工覆盖优先，否则 单价×客户数
      const amount = sess.customAmount !== undefined && sess.customAmount !== null
        ? Number(sess.customAmount)
        : Math.max(0, sess.customers.length * Number(sess.pricePerCustomer || 0));
      // 会话的 date/startTime 取第一客户（画板展示用）
      const normalizedSess: CarpickupSession = {
        ...sess,
        date: first.pickupDate,
        startTime: first.pickupTime || '',
      };
      const totalPax = sess.customers.reduce((s, c) => s + Number(c.paxCount || 0), 0);
      item = {
        id: keepId,
        itemType,
        date: first.pickupDate,
        startTime: first.pickupTime || '',
        pax: totalPax,
        extra: { carpickup: normalizedSess },
        amount,
      };
    }

    setDraftGroup((g) => {
      const items = [...g.items];
      if (drawer.editIdx >= 0 && drawer.editIdx < items.length) {
        items[drawer.editIdx] = item;
      } else {
        items.push(item);
      }
      return { ...g, items };
    });
    setErr('');
    closeDrawer();
  }

  function deleteItem(idx: number) {
    setDraftGroup((g) => ({ ...g, items: g.items.filter((_, i) => i !== idx) }));
  }

  // ================================================
  // 整单导入 / 模板 / 清空
  // ================================================
  function downloadTemplate() {
    const lines = [
      '[SHEET:订单主表]',
      '客户名称,联系人,联系电话,销售员,付款方式,备注',
      '杭州锐捷科技,张总,13800138000,李慧,销售担保挂账,VIP客户',
      '',
      '[SHEET:体检名单]',
      '姓名,身份证号,手机号,性别,婚否,套餐',
      '张伟,3301198501011234,13800138000,男,是,B',
      '',
      '[SHEET:住宿]',
      '入住日期,离店日期,到达时间,房型,间数',
      '2026-08-10,2026-08-12,14:00,标准间,2',
      '',
      '[SHEET:用餐]',
      '类型,开始日期,结束日期,默认时间,桌数,每桌人数',
      '午餐,2026-08-10,2026-08-10,12:00,2,10',
      '',
      '[SHEET:会务]',
      '日期,开始时间,会议厅,时段,人数',
      '2026-08-10,09:00,四季厅,全天,80',
      '',
      '[SHEET:康乐]',
      '日期,开始时间,项目,小时,人数',
      '2026-08-10,15:00,棋牌室,4,4',
    ];
    downloadFile('订单导入模板.csv', lines.join('\n'));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleImportFile(f);
    e.target.value = '';
  }

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const sections = parseOrderImport(text);
        const warnings: string[] = [];
        const newItems: BookingItem[] = [];
        const customer = {
          customerName: '',
          contactName: '',
          contactPhone: '',
          salesPerson: '',
          payment: '',
          remark: '',
        };

        // 主表
        const mainRows = sections['订单主表'] || [];
        if (mainRows.length >= 2) {
          const get = colGetter(mainRows[0], mainRows[1]);
          customer.customerName = get('客户名称');
          customer.contactName = get('联系人');
          customer.contactPhone = get('联系电话');
          customer.salesPerson = get('销售员');
          customer.payment = get('付款方式');
          customer.remark = get('备注');
        } else {
          warnings.push('缺少 [SHEET:订单主表]');
        }

        // 体检名单
        const chkRows = sections['体检名单'] || [];
        if (chkRows.length >= 2) {
          const headers = chkRows[0];
          const paxList: PaxEntry[] = [];
          for (let i = 1; i < chkRows.length; i++) {
            const r = chkRows[i];
            if (!r[0]) continue;
            const get = colGetter(headers, r);
            // 本地 parse：优先 pkgNameToCode（动态配置），其次再兜底
            const raw = get('套餐');
            const v = (raw || '').trim();
            const up = v.toUpperCase();
            let pkgCode: string = finalPkgOptions[0]?.code || 'A';
            if (v) {
              if (['A', 'B', 'C', 'D'].includes(up[0])) pkgCode = up[0];
              else if (pkgNameToCode[v]) pkgCode = pkgNameToCode[v];
              else if (PACKAGE_NAME_MAP[v]) pkgCode = PACKAGE_NAME_MAP[v];
            }
            paxList.push({
              name: get('姓名'),
              idCard: get('身份证号'),
              phone: get('手机号'),
              gender: get('性别') === '女' ? '女' : '男',
              married: ['是', 'true', '1', '已婚', 'Y', 'y'].includes((get('婚否') || '').trim()),
              package: pkgCode,
            });
          }
          if (paxList.length) {
            const date = todayStr();
            const pkgTotal = calcCheckupAmount(paxList, finalBizConfigForCalc);
            const paxListWithSnap = paxList.map(p => ({
              ...p,
              finalItems: resolvePaxItems(p, finalBizConfigForCalc),
              finalAmount: calcSinglePaxAmount(p, finalBizConfigForCalc),
            }));
            newItems.push({
              id: genItemId(),
              itemType: 'checkup',
              date,
              startTime: '08:00',
              pax: paxListWithSnap.length,
              extra: { paxList: paxListWithSnap, packageTotal: pkgTotal },
              amount: pkgTotal,
            });
          }
        }

        // 住宿
        const lgRows = sections['住宿'] || [];
        for (let i = 1; i < lgRows.length; i++) {
          const r = lgRows[i];
          if (!r[0]) continue;
          const get = colGetter(lgRows[0], r);
          const checkIn = get('入住日期');
          const checkOut = get('离店日期');
          const arrivalTime = get('到达时间') || '14:00';
          const lodgingType = roomNameToCode[get('房型')] || LODGING_NAME_MAP[get('房型')] || 'standard';
          const rooms = parseInt(get('间数')) || 1;
          const nights = checkIn && checkOut ? Math.max(0, daysBetween(checkIn, checkOut)) : 0;
          newItems.push({
            id: genItemId(),
            itemType: 'lodging',
            date: checkIn,
            startTime: arrivalTime,
            pax: rooms,
            extra: { lodgingType, dateCheckIn: checkIn, dateCheckOut: checkOut, arrivalTime, nights },
            amount: calcLodgingAmount(lodgingType, rooms, nights, finalBizConfigForCalc),
          });
        }

        // 用餐
        const mlRows = sections['用餐'] || [];
        for (let i = 1; i < mlRows.length; i++) {
          const r = mlRows[i];
          if (!r[0]) continue;
          const get = colGetter(mlRows[0], r);
          const typeName = get('类型');
          const itemType: BizType = typeName.includes('晚') ? 'dinner' : 'lunch';
          const dateStart = get('开始日期');
          const dateEnd = get('结束日期') || dateStart;
          const defaultTime = get('默认时间') || (itemType === 'lunch' ? '12:00' : '18:00');
          const defaultTables = parseInt(get('桌数')) || 1;
          const defaultPerTable = parseInt(get('每桌人数')) || 10;
          // 生成每日 sessions（兼容旧格式：默认按桌计价，无单价）
          const n = dateStart && dateEnd ? Math.max(0, daysBetween(dateStart, dateEnd)) : 0;
          const sessions: MealSession[] = Array.from({ length: n + 1 }, (_, i) => ({
            date: fmt(addDays(parseDateLocal(dateStart), i)),
            time: defaultTime,
            mealType: 'standard',
            pricingMode: 'per_table' as MealPricingMode,
            unitPrice: 0,
            tables: defaultTables,
            perTable: defaultPerTable,
            pax: 0,
            remark: '',
          }));
          newItems.push({
            id: genItemId(),
            itemType,
            date: dateStart,
            startTime: defaultTime,
            pax: sessions.reduce((s, x) => s + x.tables * x.perTable, 0),
            extra: { sessions },
            amount: 0,
          });
        }

        // 会务
        const mtRows = sections['会务'] || [];
        const mtSess: MeetingSession[] = [];
        for (let i = 1; i < mtRows.length; i++) {
          const r = mtRows[i];
          if (!r[0]) continue;
          const get = colGetter(mtRows[0], r);
          const hall = hallNameToCode[get('会议厅')] || HALL_NAME_MAP[get('会议厅')] || 'siji';
          const slotName = get('时段');
          const slotType: 'half' | 'full' = slotName.includes('半') ? 'half' : 'full';
          mtSess.push({
            date: get('日期'),
            startTime: get('开始时间') || '09:00',
            hall,
            slotType,
            pax: parseInt(get('人数')) || 0,
          });
        }
        if (mtSess.length) {
          newItems.push({
            id: genItemId(),
            itemType: 'meeting',
            date: mtSess[0].date,
            startTime: mtSess[0].startTime,
            pax: mtSess.reduce((s, x) => s + x.pax, 0),
            extra: { sessions: mtSess as any },
            amount: mtSess.reduce((s, x) => s + calcMeetingAmount(x.hall, x.slotType, finalBizConfigForCalc), 0),
          });
        }

        // 康乐
        const wlRows = sections['康乐'] || [];
        const wlSess: WellnessSession[] = [];
        for (let i = 1; i < wlRows.length; i++) {
          const r = wlRows[i];
          if (!r[0]) continue;
          const get = colGetter(wlRows[0], r);
          const wellnessType = wellnessNameToCode[get('项目')] || WELLNESS_NAME_MAP[get('项目')] || 'mahjong';
          wlSess.push({
            date: get('日期'),
            startTime: get('开始时间') || '15:00',
            wellnessType,
            hours: parseInt(get('小时')) || 1,
            pax: parseInt(get('人数')) || 0,
          });
        }
        if (wlSess.length) {
          newItems.push({
            id: genItemId(),
            itemType: 'wellness',
            date: wlSess[0].date,
            startTime: wlSess[0].startTime,
            pax: wlSess.reduce((s, x) => s + x.pax, 0),
            extra: { sessions: wlSess as any },
            amount: wlSess.reduce((s, x) => s + calcWellnessAmount(x.wellnessType, x.hours, finalBizConfigForCalc, isGuest), 0),
          });
        }

        if (newItems.length === 0 && !customer.customerName) {
          setImportResult({ msg: '未识别到有效数据', warnings });
          return;
        }

        // 导入的销售员姓名尝试匹配 salesUsers 以补全 salesPersonId
        const matchedSalesUser = customer.salesPerson
          ? salesUsers.find((u) => (u.name || u.username || '') === customer.salesPerson)
          : undefined;

        setDraftGroup((g) => ({
          ...g,
          customerName: customer.customerName || g.customerName,
          contactName: customer.contactName || g.contactName,
          contactPhone: customer.contactPhone || g.contactPhone,
          salesPerson: customer.salesPerson || g.salesPerson,
          salesPersonId: matchedSalesUser?.id || g.salesPersonId,
          payment: customer.payment || g.payment,
          remark: customer.remark || g.remark,
          items: [...g.items, ...newItems],
        }));
        setImportResult({
          msg: `导入成功：新增 ${newItems.length} 个业务项目`,
          warnings,
        });
      } catch (e) {
        setImportResult({ msg: `导入失败：${(e as Error).message}`, warnings: [] });
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // 体检名单粘贴导入（列序：姓名/身份证/性别/手机/婚否/套餐）
  function doChkImport() {
    const lines = (chkPasteText || '').split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return;
    const paxList: PaxEntry[] = [];
    // 是否带表头：第1行含有「姓名」关键字则跳过首行
    let startIdx = lines[0] && (lines[0].includes('姓名') || (splitRow(lines[0])[0] || '').includes('姓名')) ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cells = splitRow(lines[i]);
      if (cells.length === 0) continue;
      // 新列序：姓名(0)/身份证(1)/性别(2)/手机(3)/婚否(4)/套餐(5)
      const name = cells[0] || '';
      const idCard = cells[1] || '';
      let genderRaw = cells[2] || '';
      const phone = cells[3] || '';
      const marriedRaw = cells[4] || '';
      const pkgRaw = cells[5] || '';
      // 解析套餐：优先使用已选中的套餐胶囊
      const v = (pkgRaw || '').trim();
      const up = v.toUpperCase();
      let pkgCode: string = selectedChkPkg
        || salesCapsules[0]?.id
        || finalPkgOptions[0]?.code
        || 'A';
      if (v) {
        // 匹配销售胶囊：用名称精确匹配
        const capMatch = salesCapsules.find((c: any) =>
          c.name === v || c.label === v || friendlyCapsuleName(c).replace(/\s*\(.*\)/, '') === v
        );
        if (capMatch) {
          pkgCode = capMatch.id;
        } else if (['A', 'B', 'C', 'D'].includes(up[0])) {
          pkgCode = up[0];
        } else if (pkgNameToCode[v]) {
          pkgCode = pkgNameToCode[v];
        } else if (PACKAGE_NAME_MAP[v]) {
          pkgCode = PACKAGE_NAME_MAP[v];
        } else {
          pkgCode = v; // 直接用 UUID/短码
        }
      }
      // 解析婚姻：支持 已婚/是/true/1/Y → 已婚；未婚/否/false/0/N → 未婚
      const mRaw = (marriedRaw || '').trim();
      const married = ['已婚', '是', 'true', '1', 'Y', 'y'].includes(mRaw);
      // 性别：显式值优先；否则从身份证号推断
      let gender: '男' | '女' | '' = '';
      if (genderRaw === '男' || genderRaw === '女') gender = genderRaw;
      if (!gender) {
        const meta = parseIdCardMeta(idCard);
        if (meta.gender) gender = meta.gender;
      }
      if (!gender) gender = '男';
      if (!name && !idCard) continue;
      paxList.push({
        name, idCard, phone, gender, married, package: pkgCode,
      });
    }
    if (paxList.length) {
      // 计算统计数据
      let male = 0, marriedFemale = 0, singleFemale = 0;
      for (const p of paxList) {
        if (p.gender === '男') male++;
        else if (p.gender === '女') {
          if (p.married) marriedFemale++;
          else singleFemale++;
        }
      }
      setChkImportPreview({ paxList, male, marriedFemale, singleFemale });
      setShowChkPaste(false);
      setShowImportPreview(true);
    }
  }

  // 确认导入（从预览弹窗确认后写入）
  function confirmChkImport() {
    const { paxList } = chkImportPreview;
    if (paxList.length) {
      setChkPax((prev) => [...prev.filter((p) => p.name.trim()), ...paxList]);
    }
    setShowImportPreview(false);
    setChkImportPreview({ paxList: [], male: 0, marriedFemale: 0, singleFemale: 0 });
    setChkPasteText('');
  }

  function exportChkTemplate() {
    const rows = chkPax
      .filter((p) => p.name.trim())
      .map((p) => [p.name, p.idCard, p.gender, p.phone, p.married ? '已婚' : '未婚', p.package]);
    const csv = toCSV(rows, ['姓名', '身份证号', '性别', '手机号', '婚否', '套餐']);
    downloadFile('体检名单.csv', csv);
  }

  function handleClear() {
    if (!confirm('确定清空所有内容吗？此操作不可撤销。')) return;
    setDraftGroup({
      id: '',
      customerName: '',
      contactName: '',
      contactPhone: '',
      salesPerson: '',
      salesPersonId: undefined,
      payment: PAYMENT_OPTIONS[0],
      remark: '',
      items: [],
      status: 'pending',
      createdAt: '',
    });
    setImportResult(null);
    setErr('');
  }

  // ================================================
  // 提交 / 草稿
  // ================================================
  const [saving, setSaving] = useState(false);

  function buildOrder(): BookingOrder {
    return {
      ...draftGroup,
      id: draftGroup.id || genOrderNo(),
      status: 'pending',
      createdAt: draftGroup.createdAt || new Date().toISOString(),
    };
  }

  async function handleSubmit() {
    if (!draftGroup.customerName.trim()) {
      setErr('请填写客户/单位名称');
      return;
    }
    if (!draftGroup.salesPersonId) {
      setErr('请先选择销售员');
      return;
    }
    if (draftGroup.items.length === 0) {
      setErr('请至少添加一个业务项目');
      return;
    }
    const order = buildOrder();
    setSaving(true);
    try {
      await onSaved(order);
      onClose();
    } catch {
      // 错误已由上层处理
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    const order = buildOrder();
    setSaving(true);
    try {
      await onSaved(order);
      onClose();
    } catch {
      // 错误已由上层处理
    } finally {
      setSaving(false);
    }
  }

  // ================================================
  // 渲染
  // ================================================
  const title = isEdit ? '编辑订单' : '新建订单';
  const lgNights = Math.max(0, daysBetween(lgIn, lgOut));
  const lgDateValid = lgIn && lgOut && daysBetween(lgIn, lgOut) >= 1;

  return (
    <div className="flex flex-col h-full text-gray-800">
      {/* 隐藏文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 页头 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ClipboardList size={18} className="text-green-600" />
          {title}
          {isCopy && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-600 font-normal">
              复制为新单
            </span>
          )}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className={btnGhost}>
            <Upload size={14} /> Excel导入
          </button>
          <button onClick={downloadTemplate} className={btnGhost}>
            <Download size={14} /> 下载模板
          </button>
          <button onClick={handleClear} className={btnGhost}>
            <Eraser size={14} /> 清空
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {/* 错误提示 */}
        {err && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr('')} className="text-red-600 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 导入结果 */}
        {importResult && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm">
            <CheckCircle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div>{importResult.msg}</div>
              {importResult.warnings.length > 0 && (
                <ul className="mt-1 text-xs text-amber-600 list-disc list-inside">
                  {importResult.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="text-emerald-600 hover:text-emerald-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 客户信息 */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-green-500 rounded-full" />
            客户信息
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>客户/单位名称 *</label>
              <input
                value={draftGroup.customerName}
                onChange={(e) => setDraftGroup((g) => ({ ...g, customerName: e.target.value }))}
                placeholder="请输入客户或单位名称"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>联系人</label>
              <input
                value={draftGroup.contactName}
                onChange={(e) => setDraftGroup((g) => ({ ...g, contactName: e.target.value }))}
                placeholder="请输入联系人"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>联系电话</label>
              <input
                value={draftGroup.contactPhone}
                onChange={(e) => setDraftGroup((g) => ({ ...g, contactPhone: e.target.value }))}
                placeholder="请输入联系电话"
                className={`${inputCls} font-mono`}
              />
            </div>
            <div>
              <label className={labelCls}>销售员 <span className="text-red-500">*</span></label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSalesPickerOpen((v) => !v)}
                  className={`${inputCls} text-left flex items-center justify-between ${draftGroup.salesPerson ? 'text-gray-900' : 'text-gray-400'} ${!draftGroup.salesPerson ? 'border-red-300 focus:border-red-500' : ''}`}
                >
                  <span className="truncate">{draftGroup.salesPerson || '点击选择销售员'}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {draftGroup.salesPerson && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraftGroup((g) => ({ ...g, salesPerson: '', salesPersonId: undefined }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            setDraftGroup((g) => ({ ...g, salesPerson: '', salesPersonId: undefined }));
                          }
                        }}
                        className="text-gray-400 hover:text-red-500"
                        title="清除"
                      >
                        <X size={14} />
                      </span>
                    )}
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${salesPickerOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {salesPickerOpen && (
                  <>
                    {/* 点击遮罩关闭 */}
                    <div className="fixed inset-0 z-10" onClick={() => setSalesPickerOpen(false)} />
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-56 overflow-y-auto">
                      {salesUsers.length === 0 ? (
                        <div className="text-center py-4 text-xs text-gray-400">
                          暂无销售员，请先在用户管理中为员工分配「销售员」角色
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {salesUsers.map((u) => {
                            const active = u.id === draftGroup.salesPersonId;
                            return (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => {
                                  setDraftGroup((g) => ({
                                    ...g,
                                    salesPerson: u.name || u.username || '',
                                    salesPersonId: u.id,
                                  }));
                                  setSalesPickerOpen(false);
                                }}
                                className={`px-3 py-2 rounded-md text-sm text-left transition-colors border ${
                                  active
                                    ? 'bg-green-50 border-green-500 text-green-700 font-medium'
                                    : 'bg-white border-gray-200 text-gray-700 hover:bg-green-50 hover:border-green-300 hover:text-green-700'
                                }`}
                                title={u.username ? `账号：${u.username}` : u.name}
                              >
                                <span className="truncate block">{u.name || u.username || '未命名'}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>付款方式</label>
              <select
                value={draftGroup.payment}
                onChange={(e) => setDraftGroup((g) => ({ ...g, payment: e.target.value }))}
                className={inputCls}
              >
                {PAYMENT_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>备注</label>
              <input
                value={draftGroup.remark}
                onChange={(e) => setDraftGroup((g) => ({ ...g, remark: e.target.value }))}
                placeholder="备注信息"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* 业务项目 */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <span className="w-1 h-4 bg-green-500 rounded-full" />
              业务项目
              <span className="text-xs text-gray-400 font-normal">
                （{draftGroup.items.length} 项）
              </span>
            </h2>
            <button onClick={openAdd} className={btnGold}>
              <Plus size={14} /> 添加业务项目
            </button>
          </div>

          {draftGroup.items.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <FileSpreadsheet size={32} className="mx-auto mb-2 opacity-40" />
              暂无业务项目，点击「添加业务项目」开始
            </div>
          ) : (
            <div className="space-y-2">
              {draftGroup.items.map((item, idx) => {
                const biz = BIZ_MAP[item.itemType];
                const sum = makeItemSummary(item, { getPackageInfo, getRoomInfo, getHallInfo, getWellnessInfo });
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 text-gray-800"
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ background: `${biz.color}20`, color: biz.color }}
                    >
                      {biz.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ background: `${biz.color}20`, color: biz.color }}
                        >
                          {biz.label}
                        </span>
                        <span className="text-sm font-medium font-mono truncate">
                          {sum.main}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{sum.sub}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-mono font-semibold text-green-700">
                        ¥{(item.amount || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {item.itemType === 'carpickup'
                          ? `${item.extra?.carpickup?.customers?.length || 0}位客户 · ${item.pax}人`
                          : item.itemType === 'lunch' || item.itemType === 'dinner'
                          ? `${item.pax}桌`
                          : `${biz.unit}×${item.pax}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(item, idx)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteItem(idx)}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* 底部汇总 */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200">
        <div className="px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-gray-500">订单总额</div>
            <div className="text-2xl font-bold font-mono text-green-600">
              ¥{totalAmount.toLocaleString()}
            </div>
          </div>
          <button onClick={handleSaveDraft} disabled={saving} className={btnGhost + (saving ? ' opacity-50 cursor-not-allowed' : '')}>
            <Save size={14} /> {saving ? '保存中...' : '保存草稿'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={14} /> {saving ? '提交中...' : '提交订单'}
          </button>
        </div>
      </div>

      {/* ================================================ */}
      {/* 抽屉 */}
      {/* ================================================ */}
      {drawer.open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeDrawer} />
          <div className="relative w-full sm:w-[620px] h-full bg-white border-l border-gray-200 shadow-2xl flex flex-col">
            {/* 抽屉头 */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200">
              {drawer.mode === 'form' && (
                <button
                  onClick={() => setDrawer((d) => ({ ...d, mode: 'select', itemType: null, editIdx: -1 }))}
                  className="text-gray-500 hover:text-gray-800 text-sm"
                >
                  ←
                </button>
              )}
              <h3 className="text-base font-medium text-gray-900 flex-1">
                {drawer.mode === 'select'
                  ? '选择业务类型'
                  : drawer.editIdx >= 0
                    ? `编辑${BIZ_MAP[drawer.itemType!].label}`
                    : `添加${BIZ_MAP[drawer.itemType!].label}`}
              </h3>
              <button onClick={closeDrawer} className="text-gray-500 hover:text-gray-800">
                <X size={18} />
              </button>
            </div>

            {/* 抽屉内容 */}
            <div className="flex-1 overflow-y-auto p-5">
              {drawer.mode === 'select' ? (
                <div className="grid grid-cols-2 gap-3">
                  {MANUAL_BIZ_TYPES.map((biz) => (
                    <button
                      key={biz.type}
                      onClick={() => selectBizType(biz.type)}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl bg-gray-50 border border-gray-200 hover:border-green-500 transition-colors"
                    >
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                        style={{ background: `${biz.color}25`, color: biz.color }}
                      >
                        {biz.icon}
                      </div>
                      <div className="text-sm font-medium text-gray-900">{biz.label}</div>
                      <div className="text-[10px] text-gray-400">单位：{biz.unit}</div>
                    </button>
                  ))}
                </div>
              ) : drawer.itemType === 'checkup' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>体检日期</label>
                      <input
                        type="date"
                        value={chkDate}
                        onChange={(e) => setChkDate(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>开始时间</label>
                      <input
                        type="time"
                        value={chkTime}
                        onChange={(e) => setChkTime(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                  </div>

                  {/* 套餐选择 */}
                  <div>
                    <label className={labelCls}>选择体检套餐</label>
                    {!draftGroup.salesPersonId ? (
                      <div className="text-[11px] text-red-500 bg-red-50 px-3 py-2 rounded border border-red-200">
                        ⚠ 请先选择销售员
                      </div>
                    ) : salesCapsules.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {salesCapsules.map((cap: any) => {
                          const isSelected = selectedChkPkg === cap.id;
                          const prices = cap.prices || {};
                          const maxPrice = Math.max(
                            Number(prices.male?.discount_price || 0),
                            Number(prices.female_married?.discount_price || 0),
                            Number(prices.female_single?.discount_price || 0)
                          );
                          return (
                            <button
                              key={cap.id}
                              type="button"
                              onClick={() => setSelectedChkPkg(isSelected ? '' : cap.id)}
                              className={`px-3 py-2 rounded-lg border text-left transition-all ${
                                isSelected
                                  ? 'border-green-500 bg-green-50 ring-2 ring-green-200'
                                  : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                              }`}
                            >
                              <div className="text-xs font-medium text-gray-800">
                                {friendlyCapsuleName(cap)}
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                ¥{Number(maxPrice).toLocaleString()} 起
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400 bg-gray-50 px-3 py-2 rounded">
                        该销售员暂无套餐
                      </div>
                    )}
                  </div>

                  {/* 按角色设置人数 */}
                  {selectedChkPkg && (
                    <div>
                      <label className={labelCls}>设置体检人数（按角色）</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { key: 'male', label: '男性', icon: '👨', color: 'blue' },
                          { key: 'female_married', label: '已婚女', icon: '👩‍💍', color: 'pink' },
                          { key: 'female_single', label: '未婚女', icon: '👩', color: 'purple' },
                        ] as const).map(({ key, label, icon, color }) => {
                          const price = getCapsulePriceByRole(selectedChkPkg, key);
                          const count = roleCounts[key];
                          const imported =
                            key === 'male' ? importedRoleCounts.male
                            : key === 'female_married' ? importedRoleCounts.female_married
                            : importedRoleCounts.female_single;
                          const bgMap: Record<string, string> = {
                            blue: 'bg-blue-50 border-blue-200',
                            pink: 'bg-pink-50 border-pink-200',
                            purple: 'bg-purple-50 border-purple-200',
                          };
                          const textMap: Record<string, string> = {
                            blue: 'text-blue-700',
                            pink: 'text-pink-700',
                            purple: 'text-purple-700',
                          };
                          return (
                            <div key={key} className={`border rounded-lg p-3 ${bgMap[color]}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm">{icon} {label}</span>
                                <span className={`text-xs font-medium ${textMap[color]}`}>
                                  ¥{price.toLocaleString()}
                                </span>
                              </div>
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setRoleCounts(rc => ({ ...rc, [key]: Math.max(0, rc[key] - 1) }))}
                                  className="w-7 h-7 rounded border border-gray-300 bg-white hover:bg-gray-100 text-sm"
                                >−</button>
                                <input
                                  type="number"
                                  min="0"
                                  value={count}
                                  onChange={(e) => setRoleCounts(rc => ({ ...rc, [key]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                  className="w-12 text-center border border-gray-200 rounded px-1 py-0.5 text-sm font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => setRoleCounts(rc => ({ ...rc, [key]: rc[key] + 1 }))}
                                  className="w-7 h-7 rounded border border-gray-300 bg-white hover:bg-gray-100 text-sm"
                                >+</button>
                              </div>
                              {imported > 0 && (
                                <div className="text-[10px] text-gray-500 text-center mt-1">
                                  已导入 {imported} 人
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* 角色汇总 */}
                      <div className="flex items-center justify-between mt-2 px-2">
                        <span className="text-xs text-gray-500">
                          合计 {roleCounts.male + roleCounts.female_married + roleCounts.female_single} 人
                        </span>
                        <span className="text-sm font-semibold text-green-600 font-mono">
                          ¥{roleBasedTotal.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      体检名单（{chkPax.filter((p) => p.name.trim()).length} 人）
                    </span>
                    <div className="flex gap-2">
                      {!draftGroup.salesPersonId ? (
                        <span className="text-[11px] text-red-500 bg-red-50 px-2 py-1 rounded">
                          ⚠ 请先选择销售员
                        </span>
                      ) : (
                        <>
                          <button onClick={() => { setChkPastePkg(selectedChkPkg || salesCapsules[0]?.id || ''); setShowChkPaste(true); }} className={btnGhost}>
                            <ClipboardList size={12} /> 粘贴解析
                          </button>
                          <button onClick={() => setChkPax((p) => [...p, emptyPax()])} className={btnGold}>
                            <Plus size={12} /> 添加
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium w-28">姓名</th>
                          <th className="px-2 py-2 text-left font-medium w-16">性别</th>
                          <th className="px-2 py-2 text-center font-medium w-14">婚否</th>
                          <th className="px-2 py-2 text-left font-medium">套餐</th>
                          <th className="px-2 py-2 text-center font-medium w-36">项目状态</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {chkPax.map((p, idx) => {
                          const customized = isPaxCustomized(p);
                          const paxDetailOpen = detailPaxIdx === idx;
                          return (
                            <>
                              <tr key={'r_' + idx} className="border-t border-gray-100">
                                <td className="px-1.5 py-1">
                                  <div className="flex items-center gap-1">
                                    <input
                                      value={p.name}
                                      onChange={(e) => updChkPax(idx, { name: e.target.value })}
                                      className={`${cellInput} w-20`}
                                      placeholder="姓名"
                                    />
                                    <button
                                      onClick={() => setDetailPaxIdx(paxDetailOpen ? null : idx)}
                                      className={`shrink-0 p-1 rounded transition-colors ${
                                        paxDetailOpen ? 'bg-green-100 text-green-600' : 'hover:bg-gray-100 text-gray-400'
                                      }`}
                                      title="展开/收起：身份证号、手机号"
                                    >
                                      {paxDetailOpen ? <ChevronDown size={13} /> : <ChevronDown size={13} className="rotate-[-90deg]" />}
                                    </button>
                                  </div>
                                </td>
                                <td className="px-1.5 py-1">
                                  <select
                                    value={p.gender}
                                    onChange={(e) =>
                                      updChkPax(idx, { gender: e.target.value as '男' | '女' })
                                    }
                                    className={cellInput}
                                  >
                                    <option value="男">男</option>
                                    <option value="女">女</option>
                                  </select>
                                </td>
                                <td className="px-1.5 py-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={p.married}
                                    onChange={(e) => updChkPax(idx, { married: e.target.checked })}
                                    className="accent-green-500"
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <select
                                    value={p.package}
                                    onChange={(e) => {
                                      updChkPax(idx, { package: e.target.value, customItems: null });
                                    }}
                                    className={cellInput}
                                  >
                                    <option value="">— 选套餐 —</option>
                                    {salesCapsules.length > 0
                                      ? salesCapsules.map((cap) => {
                                          const role = paxToRole(p.gender, p.married);
                                          const price = cap.prices?.[role]?.discount_price || 0;
                                          return (
                                            <option key={cap.id} value={cap.id}>
                                              {friendlyCapsuleName(cap)} · ¥{Number(price).toLocaleString()}
                                            </option>
                                          );
                                        })
                                      : finalPkgOptions.map((pkg) => (
                                          <option key={pkg.code} value={pkg.code}>
                                            {pkg.code} · ¥{Number(pkg.price || 0).toLocaleString()}
                                          </option>
                                        ))
                                    }
                                  </select>
                                  {salesCapsules.length === 0 && !capsulesLoading && draftGroup.salesPersonId && (
                                    <span className="text-[10px] text-amber-500 block mt-0.5">该销售员暂无套餐</span>
                                  )}
                                </td>
                                <td className="px-1.5 py-1 text-center">
                                  {p.name.trim() ? (
                                    <button
                                      onClick={() => setEditingPaxIdx(idx)}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                                        customized
                                          ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                                          : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                                      }`}
                                    >
                                      {customized ? (
                                        <>
                                          <span>✎</span>
                                          <span>已定制</span>
                                        </>
                                      ) : (
                                        <>
                                          <span className="text-[10px]">●</span>
                                          <span>标准</span>
                                        </>
                                      )}
                                      <span className={`mx-0.5 ${customized ? 'text-amber-400' : 'text-green-400'}`}>|</span>
                                      <span className="font-medium">编辑</span>
                                      <span className="font-mono text-[10px] opacity-60 ml-0.5">
                                        ¥{calcSinglePaxEffective(p).toLocaleString()}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="text-gray-300 text-[11px]">—</span>
                                  )}
                                </td>
                                <td className="px-1.5 py-1">
                                  <button
                                    onClick={() => setChkPax((prev) => prev.filter((_, i) => i !== idx))}
                                    className="text-red-400 hover:text-red-600"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                              {paxDetailOpen && (
                                <tr key={'d_' + idx} className="border-t border-dashed border-gray-100 bg-gray-50/60">
                                  <td colSpan={6} className="px-2 py-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
                                      <div>
                                        <label className="text-[10px] text-gray-400 mb-0.5 block">身份证号</label>
                                        <input
                                          value={p.idCard}
                                          onChange={(e) => updChkPax(idx, { idCard: e.target.value })}
                                          onBlur={(e) => {
                                            // 失焦时：如性别未显式指定，从身份证第17位推断
                                            const id = e.target.value.trim();
                                            if (id && id.length >= 17 && !chkPax[idx]?.gender) {
                                              const s17 = id.charAt(16);
                                              const n17 = parseInt(s17, 10);
                                              if (!isNaN(n17)) {
                                                updChkPax(idx, { gender: n17 % 2 === 1 ? '男' : '女' });
                                              }
                                            }
                                          }}
                                          className={`${inputCls} font-mono text-xs`}
                                          placeholder="18位身份证号，粘贴后自动推断性别"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-400 mb-0.5 block">手机号</label>
                                        <input
                                          value={p.phone}
                                          onChange={(e) => updChkPax(idx, { phone: e.target.value })}
                                          className={`${inputCls} font-mono text-xs`}
                                          placeholder="11位手机号"
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* 统计信息：已导入 vs 还需绑定 */}
                  {selectedChkPkg && (
                    <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      <span>
                        已导入 {importedRoleCounts.male + importedRoleCounts.female_married + importedRoleCounts.female_single} 人
                        （男{importedRoleCounts.male} / 婚{importedRoleCounts.female_married} / 未{importedRoleCounts.female_single}）
                      </span>
                      {(remainingRoleCounts.male > 0 || remainingRoleCounts.female_married > 0 || remainingRoleCounts.female_single > 0) ? (
                        <span className="text-amber-600">
                          还需绑定：男{remainingRoleCounts.male} / 婚{remainingRoleCounts.female_married} / 未{remainingRoleCounts.female_single}
                        </span>
                      ) : (
                        <span className="text-green-600">✓ 人数已匹配</span>
                      )}
                    </div>
                  )}
                  {/* 体检合计：按角色人数计算（与名单无关） */}
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-gray-500">体检合计（按设定人数）</span>
                    <span className="text-green-600 font-semibold font-mono text-base">
                      ¥{roleBasedTotal.toLocaleString()}
                    </span>
                  </div>
                  {/* 套餐汇总层：按套餐分组展示共享项目，支持批量修改；单人定制通过上方「编辑」弹窗调整 */}
                  {(() => {
                    const validPax = chkPax.filter(p => p.name.trim());
                    if (validPax.length === 0) return null;
                    const groups = getPaxGroups(validPax);
                    return (
                      <div className="space-y-3 mt-2">
                        <div className="text-xs text-gray-500 font-medium flex items-center justify-between">
                          <span>📦 套餐项目汇总（批量修改同步到所有「● 标准」人员；「✎ 已定制」需点击人员行单独调整）</span>
                          <span>共 {Object.keys(groups).length} 组 · {validPax.length} 人</span>
                        </div>
                        {Object.entries(groups).map(([pkgCode, paxGroup]) => {
                          const pkgInfo = getPackageInfo(pkgCode);
                          const sharedItems = getSharedItems(pkgCode);
                          const sharedEdited = hasSharedEdits(pkgCode);
                          return (
                            <PackageGroupSummary
                              key={pkgCode}
                              pkgCode={pkgCode}
                              pkgName={pkgInfo.name}
                              pkgPrice={Number(pkgInfo.price || 0)}
                              paxList={paxGroup}
                              sharedItems={sharedItems}
                              hasSharedEdits={sharedEdited}
                              isCustomizedFn={isPaxCustomized}
                              checkupItemsLib={checkupItemsLib}
                              singlePaxAmountFn={(items) =>
                                items.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0)
                              }
                              getPerPersonPrice={(p) => calcSinglePaxEffective(p)}
                              onAddItem={(ci) => addSharedItem(pkgCode, ci)}
                              onRemoveItem={(ii) => removeSharedItem(pkgCode, ii)}
                              onRemoveItemById={(id) => removeSharedItemById(pkgCode, id)}
                              onUpdateItemField={(ii, f, v) => updateSharedItemField(pkgCode, ii, f, v)}
                              onReset={() => resetSharedItems(pkgCode)}
                            />
                          );
                        })}
                      </div>
                    );
                  })()}
                  {/* 单人项目编辑弹窗 */}
                  {editingPaxIdx !== null && chkPax[editingPaxIdx] && (() => {
                    const pax = chkPax[editingPaxIdx];
                    const items = resolvePaxItemsEffective(pax);
                    const paxAmount = calcSinglePaxEffective(pax);
                    const hasCustom = isPaxCustomized(pax);
                    const pkgInfo = getPackageInfo(pax.package);
                    // 同步套餐共享版：把此人的 customItems 设为 null（回归共享版本）
                    const syncShared = () => {
                      setChkPax(prev => prev.map((pp, i) => i === editingPaxIdx ? { ...pp, customItems: null } : pp));
                    };
                    return (
                      <PaxItemsEditorModal
                        pax={pax}
                        paxAmount={paxAmount}
                        items={items}
                        hasCustom={hasCustom}
                        pkgName={pkgInfo.name}
                        pkgCode={pax.package}
                        checkupItemsLib={checkupItemsLib}
                        hasSharedEdits={hasSharedEdits(pax.package)}
                        onRemoveItem={(itemIdx) => removePaxItem(editingPaxIdx, itemIdx)}
                        onRemoveItemById={(id) => removePaxItemById(editingPaxIdx, id)}
                        onUpdateItemField={(itemIdx, field, val) => updatePaxItemField(editingPaxIdx, itemIdx, field, val)}
                        onReset={() => resetPaxItems(editingPaxIdx)}
                        onAddItem={(ci) => addItemToPax(editingPaxIdx, ci)}
                        onSyncShared={syncShared}
                        onClose={() => setEditingPaxIdx(null)}
                      />
                    );
                  })()}
                </div>
              ) : drawer.itemType === 'lodging' ? (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>默认日期/时间（点击添加房型时自动带入）</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <input
                          type="date"
                          value={lgIn}
                          onChange={(e) => setLgIn(e.target.value)}
                          className={`${inputCls} font-mono text-xs`}
                          title="默认入住日期"
                        />
                      </div>
                      <div>
                        <input
                          type="date"
                          value={lgOut}
                          onChange={(e) => setLgOut(e.target.value)}
                          className={`${inputCls} font-mono text-xs`}
                          title="默认离店日期"
                        />
                      </div>
                      <div>
                        <input
                          type="time"
                          value={lgArr}
                          onChange={(e) => setLgArr(e.target.value)}
                          className={`${inputCls} font-mono text-xs`}
                          title="默认到达时间"
                        />
                      </div>
                      <div>
                        <input
                          type="number"
                          min="1"
                          value={lgRooms}
                          onChange={(e) => setLgRooms(Math.max(1, parseInt(e.target.value) || 1))}
                          className={`${inputCls} font-mono text-xs`}
                          title="默认间数"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>房型（点击添加）</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {finalRoomOptions.map((rt) => {
                        const count = lgSessions.filter(s => s.lodgingType === rt.code).reduce((s, x) => s + x.rooms, 0);
                        return (
                          <button
                            key={rt.code}
                            onClick={() => {
                              const minOut = fmt(addDays(parseDateLocal(lgIn), 1));
                              const checkIn = lgIn || todayStr();
                              const checkOut = lgOut && parseDateLocal(lgOut) >= parseDateLocal(minOut) ? lgOut : minOut;
                              setLgSessions((prev) => [
                                ...prev,
                                {
                                  id: `lg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                  lodgingType: rt.code,
                                  dateCheckIn: checkIn,
                                  dateCheckOut: checkOut,
                                  arrivalTime: lgArr || '14:00',
                                  rooms: lgRooms || 1,
                                },
                              ]);
                            }}
                            className={`px-2 py-2 rounded-lg text-xs border transition-colors relative ${
                              count > 0
                                ? 'bg-green-500/15 border-green-500 text-green-600'
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            {count > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 bg-green-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-medium shadow">
                                {count}
                              </span>
                            )}
                            <div className="font-medium truncate">{rt.name}</div>
                            <div className="text-[10px] opacity-70 font-mono">
                              ¥{Number(rt.price || 0).toLocaleString()}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 已添加住宿明细 */}
                  {lgSessions.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium">房型</th>
                            <th className="px-2 py-2 text-left font-medium">入住</th>
                            <th className="px-2 py-2 text-left font-medium">离店</th>
                            <th className="px-2 py-2 text-left font-medium">到达</th>
                            <th className="px-2 py-2 text-left font-medium">间数</th>
                            <th className="px-2 py-2 text-left font-medium">晚数</th>
                            <th className="px-2 py-2 text-left font-medium">小计</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lgSessions.map((s, idx) => {
                            const nights = Math.max(0, daysBetween(s.dateCheckIn, s.dateCheckOut));
                            const valid = s.dateCheckIn && s.dateCheckOut && nights >= 1;
                            const info = getRoomInfo(s.lodgingType);
                            const amt = valid ? calcLodgingAmount(s.lodgingType, s.rooms, nights, finalBizConfigForCalc) : 0;
                            return (
                              <tr key={s.id} className="border-t border-gray-100">
                                <td className="px-1.5 py-1.5">
                                  <div className="font-medium text-gray-700">{info.name}</div>
                                  <div className="text-[10px] text-gray-400 font-mono">¥{info.price.toLocaleString()}/晚</div>
                                </td>
                                <td className="px-1.5 py-1.5">
                                  <input
                                    type="date"
                                    value={s.dateCheckIn}
                                    onChange={(e) => {
                                      const newIn = e.target.value;
                                      setLgSessions((prev) => prev.map((x, i) => {
                                        if (i !== idx) return x;
                                        let out = x.dateCheckOut;
                                        if (newIn && out) {
                                          const minOut = fmt(addDays(parseDateLocal(newIn), 1));
                                          if (parseDateLocal(out) < parseDateLocal(minOut)) out = minOut;
                                        }
                                        return { ...x, dateCheckIn: newIn, dateCheckOut: out };
                                      }));
                                    }}
                                    className={`${cellInput} w-32 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1.5">
                                  <input
                                    type="date"
                                    value={s.dateCheckOut}
                                    onChange={(e) =>
                                      setLgSessions((prev) => prev.map((x, i) =>
                                        i === idx ? { ...x, dateCheckOut: e.target.value } : x
                                      ))
                                    }
                                    className={`${cellInput} w-32 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1.5">
                                  <input
                                    type="time"
                                    value={s.arrivalTime}
                                    onChange={(e) =>
                                      setLgSessions((prev) => prev.map((x, i) =>
                                        i === idx ? { ...x, arrivalTime: e.target.value } : x
                                      ))
                                    }
                                    className={`${cellInput} w-20 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1.5">
                                  <input
                                    type="number"
                                    min="1"
                                    value={s.rooms}
                                    onChange={(e) =>
                                      setLgSessions((prev) => prev.map((x, i) =>
                                        i === idx ? { ...x, rooms: Math.max(1, parseInt(e.target.value) || 1) } : x
                                      ))
                                    }
                                    className={`${cellInput} w-14 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1.5 font-mono">
                                  <span className={valid ? 'text-green-600' : 'text-red-500'}>
                                    {valid ? `${nights}晚` : '⚠️ 无效'}
                                  </span>
                                </td>
                                <td className="px-1.5 py-1.5 font-mono text-green-600">¥{amt.toLocaleString()}</td>
                                <td className="px-1.5 py-1.5">
                                  <button
                                    onClick={() => setLgSessions((prev) => prev.filter((_, i) => i !== idx))}
                                    className="text-red-400 hover:text-red-600"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {lgSessions.length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                      👆 请点击上方房型胶囊块，添加住宿信息
                    </div>
                  )}
                </div>
              ) : drawer.itemType === 'lunch' || drawer.itemType === 'dinner' ? (
                <div className="space-y-3 relative">
                  {/* 顶部：用餐标准胶囊块（点击加一场） */}
                  <div>
                    <label className={labelCls}>用餐标准（点击添加场次）</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {finalMealOptions.map((m) => {
                        const count = mlSessions.filter(s => s.mealType === m.code).length;
                        return (
                          <button
                            key={m.code}
                            onClick={() => {
                              const info = getMealTypeInfo(m.code, bizConfig.mealTypes);
                              setMlSessions((prev) => [
                                ...prev,
                                {
                                  date: todayStr(),
                                  time: drawer.itemType === 'dinner' ? '18:00' : info.defaultTime,
                                  mealType: m.code,
                                  pricingMode: info.pricingMode,
                                  unitPrice: info.unitPrice,
                                  tables: info.defaultTables,
                                  perTable: info.defaultPerTable,
                                  pax: info.defaultPax,
                                  remark: '',
                                },
                              ]);
                            }}
                            className={`px-2 py-2 rounded-lg text-xs border transition-colors text-left ${
                              count > 0
                                ? 'bg-green-500/15 border-green-500 text-green-600'
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <div className="font-medium truncate flex items-center justify-between gap-1">
                              <span className="truncate">{m.name}</span>
                              {count > 0 && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500 text-white font-medium">
                                  +{count}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] opacity-70 font-mono">
                              {m.pricing_mode === 'per_person' ? `¥${Number(m.unit_price).toLocaleString()}/人` : `¥${Number(m.unit_price).toLocaleString()}/桌`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 场次：多张卡片 */}
                  {mlSessions.length > 0 ? (
                    <div className="space-y-3">
                      {mlSessions.map((s, idx) => {
                        const amt = calcMealAmount(s.pricingMode, s.unitPrice, s.tables, s.perTable, s.pax);
                        const mtInfo = getMealTypeInfo(s.mealType, bizConfig.mealTypes);
                        return (
                          <div
                            key={idx}
                            className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 shadow-sm relative"
                          >
                            {/* 卡片头部：场次号 + 删除 */}
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-gray-500">
                                场次 <span className="font-semibold text-gray-700">{idx + 1}</span>
                              </div>
                              <button
                                onClick={() => setMlSessions((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            {/* 日期 + 时间 */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-gray-400 mb-0.5 block">日期</label>
                                <input
                                  type="date"
                                  value={s.date}
                                  onChange={(e) =>
                                    setMlSessions((prev) => prev.map((x, i) =>
                                      i === idx ? { ...x, date: e.target.value } : x,
                                    ))
                                  }
                                  className={`${inputCls} font-mono w-full`}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-400 mb-0.5 block">时间</label>
                                <input
                                  type="time"
                                  value={s.time}
                                  onChange={(e) =>
                                    setMlSessions((prev) => prev.map((x, i) =>
                                      i === idx ? { ...x, time: e.target.value } : x,
                                    ))
                                  }
                                  className={`${inputCls} font-mono w-full`}
                                />
                              </div>
                            </div>

                            {/* 用餐标准：标签按钮 + 弹出面板 */}
                            <div>
                              <label className="text-[10px] text-gray-400 mb-0.5 block">用餐标准</label>
                              <button
                                onClick={() => setMlPickerOpen(idx)}
                                className="w-full text-left px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 transition-colors text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-7 h-7 shrink-0 rounded-md bg-orange-500/15 text-orange-600 flex items-center justify-center">
                                      🍱
                                    </span>
                                    <div className="min-w-0">
                                      <div className="font-medium text-gray-700 truncate">{mtInfo.name}</div>
                                      <div className="text-[10px] text-gray-400 font-mono">
                                        ¥{Number(s.unitPrice).toLocaleString()}/{s.pricingMode === 'per_person' ? '人' : '桌'}
                                        {s.unitPrice !== mtInfo.unitPrice && <span className="ml-1 text-amber-500">(已调整)</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <ChevronDown size={14} className="text-gray-400 shrink-0" />
                                </div>
                              </button>
                            </div>

                            {/* 计价模式 */}
                            <div>
                              <label className="text-[10px] text-gray-400 mb-0.5 block">计价模式</label>
                              <div className="flex gap-1.5">
                                {(['per_table', 'per_person'] as const).map((v) => (
                                  <button
                                    key={v}
                                    onClick={() =>
                                      setMlSessions((prev) => prev.map((x, i) =>
                                        i === idx ? { ...x, pricingMode: v } : x,
                                      ))
                                    }
                                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                                      s.pricingMode === v
                                        ? 'bg-green-500/15 border-green-500 text-green-600 font-medium'
                                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                    }`}
                                  >
                                    {v === 'per_table' ? '按桌计价' : '按人计价'}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* 单价 + 数量 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-gray-400 mb-0.5 block">
                                  单价（{s.pricingMode === 'per_person' ? '元/人' : '元/桌'}）
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={s.unitPrice}
                                  onChange={(e) =>
                                    setMlSessions((prev) => prev.map((x, i) =>
                                      i === idx ? { ...x, unitPrice: parseFloat(e.target.value) || 0 } : x,
                                    ))
                                  }
                                  className={`${inputCls} font-mono w-full`}
                                />
                              </div>
                              <div>
                                {s.pricingMode === 'per_table' ? (
                                  <>
                                    <label className="text-[10px] text-gray-400 mb-0.5 block">数量</label>
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        min="1"
                                        value={s.tables}
                                        onChange={(e) =>
                                          setMlSessions((prev) => prev.map((x, i) =>
                                            i === idx ? { ...x, tables: Math.max(1, parseInt(e.target.value) || 1) } : x,
                                          ))
                                        }
                                        className={`${inputCls} font-mono flex-1`}
                                      />
                                      <span className="text-gray-400 text-xs shrink-0">桌 ×</span>
                                      <input
                                        type="number"
                                        min="1"
                                        value={s.perTable}
                                        onChange={(e) =>
                                          setMlSessions((prev) => prev.map((x, i) =>
                                            i === idx ? { ...x, perTable: Math.max(1, parseInt(e.target.value) || 1) } : x,
                                          ))
                                        }
                                        className={`${inputCls} font-mono flex-1`}
                                      />
                                      <span className="text-gray-400 text-xs shrink-0">人</span>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <label className="text-[10px] text-gray-400 mb-0.5 block">用餐人数</label>
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="number"
                                        min="0"
                                        value={s.pax}
                                        onChange={(e) =>
                                          setMlSessions((prev) => prev.map((x, i) =>
                                            i === idx ? { ...x, pax: Math.max(0, parseInt(e.target.value) || 0) } : x,
                                          ))
                                        }
                                        className={`${inputCls} font-mono w-full`}
                                      />
                                      <span className="text-gray-400 text-xs shrink-0">人</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* 特殊要求 */}
                            <div>
                              <label className="text-[10px] text-gray-400 mb-0.5 block">特殊要求（忌口/偏好/分餐）</label>
                              <textarea
                                value={s.remark}
                                placeholder="例如：3份素食、1份清真、5份儿童餐、高血糖不要甜点..."
                                rows={2}
                                onChange={(e) =>
                                  setMlSessions((prev) => prev.map((x, i) =>
                                    i === idx ? { ...x, remark: e.target.value } : x,
                                  ))
                                }
                                className={`${inputCls} w-full text-xs resize-none`}
                              />
                            </div>

                            {/* 小计 */}
                            <div className="flex items-center justify-end pt-1 border-t border-gray-100">
                              <span className="text-xs text-gray-400 mr-2">小计</span>
                              <span className="font-mono font-semibold text-green-600 text-base">¥{amt.toLocaleString()}</span>
                            </div>

                            {/* 弹出面板 - 用餐标准选择器 */}
                            {mlPickerOpen === idx && (
                              <>
                                {/* 背景遮罩 */}
                                <div
                                  className="fixed inset-0 z-40 bg-black/20"
                                  onClick={() => setMlPickerOpen(null)}
                                />
                                {/* 面板主体 */}
                                <div
                                  className="absolute z-50 top-10 left-2 right-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 animate-in fade-in zoom-in-95 duration-100"
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-xs text-gray-500">选择用餐标准</div>
                                    <button
                                      onClick={() => setMlPickerOpen(null)}
                                      className="text-gray-400 hover:text-gray-600"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {finalMealOptions.map((m) => (
                                      <button
                                        key={m.code}
                                        onClick={() => {
                                          const info = getMealTypeInfo(m.code, bizConfig.mealTypes);
                                          setMlSessions((prev) => prev.map((x, i) =>
                                            i === idx ? {
                                              ...x,
                                              mealType: m.code,
                                              pricingMode: info.pricingMode,
                                              unitPrice: info.unitPrice,
                                            } : x,
                                          ));
                                          setMlPickerOpen(null);
                                        }}
                                        className={`px-2 py-2 rounded-lg text-xs border transition-colors text-left ${
                                          s.mealType === m.code
                                            ? 'bg-green-500/15 border-green-500 text-green-600 ring-2 ring-green-500/30'
                                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                                        }`}
                                      >
                                        <div className="font-medium truncate">{m.name}</div>
                                        <div className="text-[10px] opacity-70 font-mono">
                                          {m.pricing_mode === 'per_person' ? `¥${Number(m.unit_price).toLocaleString()}/人` : `¥${Number(m.unit_price).toLocaleString()}/桌`}
                                        </div>
                                        {s.mealType === m.code && (
                                          <div className="text-[10px] text-green-600 mt-0.5">✓ 当前选择</div>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                      👆 请点击上方用餐标准胶囊块，添加用餐场次
                    </div>
                  )}
                </div>
              ) : drawer.itemType === 'meeting' ? (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>会议厅（点击添加场次）</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {finalHallOptions.map((h) => {
                        const count = mtSessions.filter(s => s.hall === h.code).length;
                        return (
                          <button
                            key={h.code}
                            onClick={() =>
                              setMtSessions((prev) => [
                                ...prev,
                                {
                                  date: todayStr(),
                                  startTime: '09:00',
                                  hall: h.code,
                                  slotType: 'full' as const,
                                  pax: 20,
                                },
                              ])
                            }
                            className={`px-2 py-2 rounded-lg text-xs border transition-colors text-left ${
                              count > 0
                                ? 'bg-green-500/15 border-green-500 text-green-600'
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <div className="font-medium truncate flex items-center justify-between gap-1">
                              <span className="truncate">{h.name}</span>
                              {count > 0 && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500 text-white font-medium">
                                  +{count}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] opacity-70 font-mono">
                              容{h.capacity}人 · 半¥{Number(h.half_price || 0).toLocaleString()} / 全¥{Number(h.full_price || 0).toLocaleString()}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {mtSessions.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium">日期</th>
                            <th className="px-2 py-2 text-left font-medium">开始</th>
                            <th className="px-2 py-2 text-left font-medium">会议厅</th>
                            <th className="px-2 py-2 text-left font-medium">时段</th>
                            <th className="px-2 py-2 text-left font-medium">人数</th>
                            <th className="px-2 py-2 text-left font-medium">金额</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {mtSessions.map((s, idx) => (
                            <tr key={idx} className="border-t border-gray-100">
                              <td className="px-1.5 py-1">
                                <input
                                  type="date"
                                  value={s.date}
                                  onChange={(e) =>
                                    setMtSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, date: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-36 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="time"
                                  value={s.startTime}
                                  onChange={(e) =>
                                    setMtSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, startTime: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-20 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <div className="flex flex-wrap gap-1 max-w-[200px]">
                                  {finalHallOptions.map((h) => (
                                    <button
                                      key={h.code}
                                      onClick={() =>
                                        setMtSessions((prev) =>
                                          prev.map((x, idx0) =>
                                            idx0 === idx
                                              ? { ...x, hall: h.code }
                                              : x,
                                          ),
                                        )
                                      }
                                      className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                        s.hall === h.code
                                          ? 'bg-green-500/15 border-green-500 text-green-600'
                                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                      }`}
                                    >
                                      {h.name}
                                    </button>
                                  ))}
                                </div>
                              </td>
                              <td className="px-1.5 py-1">
                                <div className="flex gap-1">
                                  {(['half', 'full'] as const).map((v) => (
                                    <button
                                      key={v}
                                      onClick={() =>
                                        setMtSessions((prev) =>
                                          prev.map((x, idx0) =>
                                            idx0 === idx
                                              ? { ...x, slotType: v }
                                              : x,
                                          ),
                                        )
                                      }
                                      className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                                        s.slotType === v
                                          ? 'bg-green-500/15 border-green-500 text-green-600'
                                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                      }`}
                                    >
                                      {v === 'half' ? '半天' : '全天'}
                                    </button>
                                  ))}
                                </div>
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={s.pax}
                                  onChange={(e) =>
                                    setMtSessions((prev) =>
                                      prev.map((x, idx0) =>
                                        idx0 === idx ? { ...x, pax: parseInt(e.target.value) || 0 } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-16 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1 font-mono text-green-600">
                                ¥{calcMeetingAmount(s.hall, s.slotType, finalBizConfigForCalc).toLocaleString()}
                              </td>
                              <td className="px-1.5 py-1">
                                <button
                                  onClick={() =>
                                    setMtSessions((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="text-red-400 hover:text-red-600"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                      👆 请点击上方会议厅胶囊块，添加会务场次
                    </div>
                  )}
                </div>
              ) : drawer.itemType === 'wellness' ? (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>康乐项目（点击添加场次）</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {finalWellnessOptions.map((w) => {
                        const count = wlSessions.filter(s => s.wellnessType === w.code).length;
                        const free = Number(w.is_free) === 1;
                        const isPkg = w.pricing_mode === 'package';
                        // 套餐时长取 package_hours，按小时项目取 min_hours
                        const initHours = isPkg ? Number(w.package_hours) || 0 : (Number(w.min_hours) || 1);
                        // 入住/不住宿双档价（套餐模式直接显示一口价，按小时模式显示单价）
                        const pg = Number(w.price_guest || 0);
                        const pe = Number(w.price_external || 0);
                        const samePrice = pg === pe;
                        return (
                          <button
                            key={w.code}
                            onClick={() =>
                              setWlSessions((prev) => [
                                ...prev,
                                {
                                  date: todayStr(),
                                  startTime: '15:00',
                                  wellnessType: w.code,
                                  hours: initHours,
                                  pax: 2,
                                },
                              ])
                            }
                            className={`px-2 py-2 rounded-lg text-xs border transition-colors text-left ${
                              count > 0
                                ? 'bg-green-500/15 border-green-500 text-green-600'
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <div className="font-medium truncate flex items-center justify-between gap-1">
                              <span className="truncate flex items-center gap-1">
                                {w.name}
                                {free && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-600 font-medium shrink-0">
                                    免费
                                  </span>
                                )}
                                {isPkg && !free && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 font-medium shrink-0">
                                    套餐
                                  </span>
                                )}
                              </span>
                              {count > 0 && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500 text-white font-medium">
                                  +{count}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] opacity-70 font-mono">
                              {free ? '免费使用' : isPkg ? (
                                <>
                                  {w.package_hours ? `${w.package_hours}h · ` : ''}
                                  {samePrice
                                    ? `¥${pg.toLocaleString()}`
                                    : `¥${pg.toLocaleString()}/¥${pe.toLocaleString()}`}
                                  {w.time_window ? ` · ${w.time_window}` : ''}
                                </>
                              ) : `至少${w.min_hours || 0}h · ¥${Number(w.price || 0).toLocaleString()}/h`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {wlSessions.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium">日期</th>
                            <th className="px-2 py-2 text-left font-medium">开始</th>
                            <th className="px-2 py-2 text-left font-medium">项目</th>
                            <th className="px-2 py-2 text-left font-medium">小时</th>
                            <th className="px-2 py-2 text-left font-medium">人数</th>
                            <th className="px-2 py-2 text-left font-medium">金额</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {wlSessions.map((s, idx) => {
                            const w = getWellnessInfo(s.wellnessType);
                            return (
                              <tr key={idx} className="border-t border-gray-100">
                                <td className="px-1.5 py-1">
                                  <input
                                    type="date"
                                    value={s.date}
                                    onChange={(e) =>
                                      setWlSessions((prev) =>
                                        prev.map((x, idx0) =>
                                          idx0 === idx ? { ...x, date: e.target.value } : x,
                                        ),
                                      )
                                    }
                                    className={`${cellInput} w-36 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <input
                                    type="time"
                                    value={s.startTime}
                                    onChange={(e) =>
                                      setWlSessions((prev) =>
                                        prev.map((x, idx0) =>
                                          idx0 === idx ? { ...x, startTime: e.target.value } : x,
                                        ),
                                      )
                                    }
                                    className={`${cellInput} w-20 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                                    {finalWellnessOptions.map((w2) => (
                                      <button
                                        key={w2.code}
                                        onClick={() =>
                                          setWlSessions((prev) =>
                                            prev.map((x, idx0) =>
                                              idx0 === idx
                                                ? { ...x, wellnessType: w2.code }
                                                : x,
                                            ),
                                          )
                                        }
                                        className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                          s.wellnessType === w2.code
                                            ? 'bg-green-500/15 border-green-500 text-green-600'
                                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                        }`}
                                      >
                                        {w2.name}
                                      </button>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-1.5 py-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={s.hours}
                                    onChange={(e) =>
                                      setWlSessions((prev) =>
                                        prev.map((x, idx0) =>
                                          idx0 === idx ? { ...x, hours: parseInt(e.target.value) || 0 } : x,
                                        ),
                                      )
                                    }
                                    className={`${cellInput} w-14 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={s.pax}
                                    onChange={(e) =>
                                      setWlSessions((prev) =>
                                        prev.map((x, idx0) =>
                                          idx0 === idx ? { ...x, pax: parseInt(e.target.value) || 0 } : x,
                                        ),
                                      )
                                    }
                                    className={`${cellInput} w-14 font-mono`}
                                  />
                                </td>
                                <td className="px-1.5 py-1 font-mono text-green-600">
                                  {w.free ? (
                                    <span className="text-emerald-500">免费</span>
                                  ) : (
                                    `¥${calcWellnessAmount(s.wellnessType, s.hours, finalBizConfigForCalc, isGuest).toLocaleString()}`
                                  )}
                                </td>
                                <td className="px-1.5 py-1">
                                  <button
                                    onClick={() =>
                                      setWlSessions((prev) => prev.filter((_, i) => i !== idx))
                                    }
                                    className="text-red-400 hover:text-red-600"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                      👆 请点击上方康乐项目胶囊块，添加场次
                    </div>
                  )}
                </div>
              ) : drawer.itemType === 'carpickup' ? (
                <div className="space-y-3">
                  {/* 顶部配置：是否拼车 + 单价 + 总金额 */}
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-4 text-xs">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={carSession.shareRide}
                          onChange={(e) => setCarSession(prev => ({ ...prev, shareRide: e.target.checked }))}
                          className="accent-green-500 w-3.5 h-3.5"
                        />
                        <span className="text-gray-700">是否拼车</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">单价(¥/客户)</span>
                        <input
                          type="number"
                          value={carSession.pricePerCustomer}
                          onChange={(e) => setCarSession(prev => ({ ...prev, pricePerCustomer: Number(e.target.value) || 0 }))}
                          className={`${cellInput} w-20 font-mono text-right`}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">总金额(手工覆盖)</span>
                        <input
                          type="number"
                          value={carSession.customAmount ?? ''}
                          placeholder="留空=客户数×单价"
                          onChange={(e) => setCarSession(prev => ({
                            ...prev,
                            customAmount: e.target.value === '' ? undefined : Number(e.target.value) || 0
                          }))}
                          className={`${cellInput} w-32 font-mono text-right`}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      共 <span className="font-mono text-gray-700 font-medium">{carSession.customers.length}</span> 位客户
                      <span className="mx-1.5 text-gray-300">·</span>
                      预计总人数 <span className="font-mono text-gray-700 font-medium">{carSession.customers.reduce((s, c) => s + Number(c.paxCount || 0), 0)}</span>
                    </div>
                  </div>

                  {/* 客户Tab + 加/删客户 */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Tab 行 */}
                    <div className="flex items-center gap-1 p-2 border-b border-gray-200 bg-gray-50/50 flex-wrap">
                      {carSession.customers.map((c, idx) => {
                        const isActive = idx === carActiveCust;
                        const hasAny = c.contactName.trim() || c.contactPhone.trim() || c.paxCount > 0;
                        const title = hasAny
                          ? `${['一','二','三','四','五','六','七','八','九','十'][idx] || `客户${idx + 1}`} · ${c.contactName || '未命名'}`
                          : `客户${['一','二','三','四','五','六','七','八','九','十'][idx] || (idx + 1)} (空)`;
                        return (
                          <div key={idx} className="flex items-center shrink-0">
                            <button
                              onClick={() => setCarActiveCust(idx)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors border ${
                                isActive
                                  ? 'bg-green-500 border-green-500 text-white shadow-sm'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-600'
                              }`}
                              title={c.contactName || '客户'}
                            >
                              <span className="font-semibold">客户{['一','二','三','四','五','六','七','八','九','十'][idx] || (idx + 1)}</span>
                              {c.contactName.trim() && (
                                <>
                                  <span className={isActive ? 'text-green-100' : 'text-gray-300'}>·</span>
                                  <span className="max-w-12 truncate">{c.contactName}</span>
                                </>
                              )}
                              {c.paxCount > 0 && (
                                <span className={`font-mono ${isActive ? 'text-green-100' : 'text-gray-400'}`}>{c.paxCount}人</span>
                              )}
                            </button>
                            {carSession.customers.length > 1 && (
                              <button
                                onClick={() => {
                                  const del = idx;
                                  setCarSession(prev => {
                                    const next = prev.customers.filter((_, i) => i !== del);
                                    return { ...prev, customers: next };
                                  });
                                  setCarActiveCust(i => {
                                    if (carSession.customers.length - 1 === i) return Math.max(0, i - 1);
                                    if (idx <= i) return Math.max(0, i - 1);
                                    return i;
                                  });
                                }}
                                className="ml-1 w-4 h-4 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                title="删除该客户"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => {
                          const newCust: CarCustomer = {
                            contactName: '', contactPhone: '', paxCount: 0,
                            pickupDate: carSession.customers[0]?.pickupDate || todayStr(),
                            pickupTime: '', pickupRoute: '',
                            dropoffDate: carSession.customers[0]?.dropoffDate || todayStr(),
                            dropoffTime: '', dropoffRoute: '',
                          };
                          setCarSession(prev => ({ ...prev, customers: [...prev.customers, newCust] }));
                          setCarActiveCust(carSession.customers.length);
                        }}
                        className="inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-xs bg-white border border-dashed border-gray-300 text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors shrink-0"
                      >
                        <Plus size={11} /> 增加客户
                      </button>
                    </div>

                    {/* 当前客户编辑区 */}
                    {(() => {
                      const i = carActiveCust;
                      const cust = carSession.customers[i];
                      if (!cust) return null;
                      const patchCust = (patch: Partial<CarCustomer>) => {
                        setCarSession(prev => {
                          const next = [...prev.customers];
                          next[i] = { ...next[i], ...patch };
                          return { ...prev, customers: next };
                        });
                      };
                      const labelCls = 'text-[11px] text-gray-500 bg-gray-100 px-2 py-1 text-right whitespace-nowrap';
                      return (
                        <div className="p-3 text-xs">
                          {/* 负责人 + 联系电话 + 人数 */}
                          <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr] gap-y-px bg-gray-200 border border-gray-200 overflow-hidden rounded-lg">
                            <div className={labelCls}>客户负责人</div>
                            <div className="bg-white px-2 py-1">
                              <input
                                value={cust.contactName}
                                onChange={(e) => patchCust({ contactName: e.target.value })}
                                placeholder="如：孙老师"
                                className="w-full focus:outline-none text-[12px]"
                              />
                            </div>
                            <div className={labelCls}>联系方式:</div>
                            <div className="bg-white px-2 py-1 border-l border-gray-100">
                              <input
                                value={cust.contactPhone}
                                onChange={(e) => patchCust({ contactPhone: e.target.value })}
                                placeholder="手机号"
                                className="w-full focus:outline-none font-mono text-[12px]"
                              />
                            </div>
                            <div className={labelCls}>预计人数</div>
                            <div className="bg-white px-2 py-1 border-l border-gray-100">
                              <input
                                type="number"
                                min="0"
                                value={cust.paxCount || ''}
                                onChange={(e) => patchCust({ paxCount: Number(e.target.value) || 0 })}
                                placeholder="人数"
                                className="w-full focus:outline-none font-mono text-right text-[12px]"
                              />
                            </div>

                            {/* 接客日期/时间 + 接客行程(右侧rowspan) */}
                            <div className={labelCls}>接客日期</div>
                            <div className="bg-white px-2 py-1">
                              <input
                                type="date"
                                value={cust.pickupDate || ''}
                                onChange={(e) => patchCust({ pickupDate: e.target.value })}
                                className="w-full focus:outline-none font-mono text-[12px]"
                              />
                            </div>
                            <div className={labelCls + ' row-span-2'}>接客行程</div>
                            <div className="bg-white px-2 py-1 border-l border-gray-100 row-span-2 col-span-3">
                              <textarea
                                rows={3}
                                value={cust.pickupRoute || ''}
                                onChange={(e) => patchCust({ pickupRoute: e.target.value })}
                                placeholder={'例如：\n7:00重固镇政府 → 7:40画一（走高速）'}
                                className="w-full focus:outline-none text-[12px] text-gray-800 resize-y leading-relaxed"
                              />
                            </div>

                            <div className={labelCls}>接客时间</div>
                            <div className="bg-white px-2 py-1 border-t border-gray-100">
                              <input
                                value={cust.pickupTime || ''}
                                onChange={(e) => patchCust({ pickupTime: e.target.value })}
                                placeholder="如：7:00 或 体检结束后"
                                className="w-full focus:outline-none font-mono text-[12px]"
                              />
                            </div>

                            {/* 送客日期/时间 + 送客行程(右侧rowspan) */}
                            <div className={labelCls}>送客日期</div>
                            <div className="bg-white px-2 py-1 border-t border-gray-100">
                              <input
                                type="date"
                                value={cust.dropoffDate || ''}
                                onChange={(e) => patchCust({ dropoffDate: e.target.value })}
                                className="w-full focus:outline-none font-mono text-[12px]"
                              />
                            </div>
                            <div className={labelCls + ' row-span-2'}>送客行程</div>
                            <div className="bg-white px-2 py-1 border-t border-gray-100 border-l border-gray-100 row-span-2 col-span-3">
                              <textarea
                                rows={3}
                                value={cust.dropoffRoute || ''}
                                onChange={(e) => patchCust({ dropoffRoute: e.target.value })}
                                placeholder={'例如：原路送回\n或：17:30画一 → 18:10重固镇政府'}
                                className="w-full focus:outline-none text-[12px] text-gray-800 resize-y leading-relaxed"
                              />
                            </div>

                            <div className={labelCls}>送客时间</div>
                            <div className="bg-white px-2 py-1 border-t border-gray-100">
                              <input
                                value={cust.dropoffTime || ''}
                                onChange={(e) => patchCust({ dropoffTime: e.target.value })}
                                placeholder="如：体检结束后 或 17:30"
                                className="w-full focus:outline-none font-mono text-[12px]"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : null}
            </div>

            {/* 抽屉底部 */}
            {drawer.mode === 'form' && (
              <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-3">
                <div className="flex-1 text-sm">
                  <span className="text-gray-500">合计：</span>
                  <span className="text-green-600 font-mono font-semibold">
                    ¥{drawerAmount.toLocaleString()}
                  </span>
                </div>
                <button onClick={closeDrawer} className={btnGhost}>
                  取消
                </button>
                <button
                  onClick={saveDrawer}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors"
                >
                  <Save size={14} /> 保存
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 体检名单粘贴解析弹窗 */}
      {showChkPaste && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowChkPaste(false)} />
          <div className="relative w-full max-w-xl bg-white rounded-xl border border-gray-200 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-medium text-gray-900">📋 粘贴解析体检名单</h3>
              <button onClick={() => setShowChkPaste(false)} className="text-gray-500 hover:text-gray-800">
                <X size={18} />
              </button>
            </div>
            {/* 已选套餐提示 */}
            <div className={`mb-3 p-3 border rounded-lg ${selectedChkPkg ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              {selectedChkPkg ? (
                <>
                  <div className="text-xs text-gray-600 mb-1">
                    已选套餐（名单将自动使用此套餐）：
                  </div>
                  <div className="text-sm font-medium text-green-700">
                    {friendlyCapsuleName(capsuleMap[selectedChkPkg])}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-amber-600 font-medium">
                    ⚠ 请先在上方选择体检套餐
                  </div>
                  <div className="text-[11px] text-amber-500 mt-0.5">
                    未选择套餐时将使用默认套餐
                  </div>
                </>
              )}
            </div>
            {/* 格式说明 */}
            <div className="mb-3 text-xs text-gray-500 leading-relaxed space-y-1">
              <div>
                列序：
                <span className="text-gray-700 font-mono ml-1">姓名 / 身份证号 / 性别 / 手机 / 婚否</span>
                <span className="text-gray-400 ml-1">（套餐已在上方选择，无需再填）</span>
              </div>
              <div>
                分隔符：
                <span className="text-gray-700 ml-1">Tab / 逗号 / 空格 均可</span>
              </div>
              <div className="text-green-600">
                ✨ 粘贴后自动根据身份证号推断性别（第17位奇男偶女），婚姻支持「已婚/未婚/是/否」
              </div>
            </div>
            <textarea
              value={chkPasteText}
              onChange={(e) => setChkPasteText(e.target.value)}
              rows={10}
              placeholder={'示例（从Excel/WPS复制）：\n张伟\t3301198501011234\t男\t13800138000\t已婚\n李芳\t310110199205058888\t女\t13900139000\t未婚\n王敏 320104198812125566 女 13800138000 已婚'}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono focus:outline-none focus:border-green-500"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowChkPaste(false)} className={btnGhost}>
                取消
              </button>
              <button onClick={doChkImport} className={btnGold}>
                <ClipboardList size={14} /> 解析导入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 解析结果预览弹窗 */}
      {showImportPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowImportPreview(false)} />
          <div className="relative w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-gray-900">
                ✅ 解析成功
                <span className="ml-2 text-sm text-gray-500">共 {chkImportPreview.paxList.length} 人</span>
              </h3>
              <button onClick={() => setShowImportPreview(false)} className="text-gray-500 hover:text-gray-800">
                <X size={18} />
              </button>
            </div>
            {/* 统计卡片 */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">👨</div>
                <div className="text-xl font-bold text-blue-700">{chkImportPreview.male}</div>
                <div className="text-[11px] text-blue-600">男性</div>
              </div>
              <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">👩‍💍</div>
                <div className="text-xl font-bold text-pink-700">{chkImportPreview.marriedFemale}</div>
                <div className="text-[11px] text-pink-600">已婚女</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">👩</div>
                <div className="text-xl font-bold text-purple-700">{chkImportPreview.singleFemale}</div>
                <div className="text-[11px] text-purple-600">未婚女</div>
              </div>
            </div>
            {/* 人员列表（可折叠） */}
            <ImportPreviewDetails paxList={chkImportPreview.paxList} />
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
              <button onClick={() => { setShowImportPreview(false); }} className={btnGhost}>
                返回修改
              </button>
              <button onClick={confirmChkImport} className={btnGold}>
                <CheckCircle size={14} /> 确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
