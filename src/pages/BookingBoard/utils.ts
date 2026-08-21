import type { BookingOrder, BookingItem, BizType, RenderCard, PaxEntry, PackageRow, RoomTypeRow, MeetingHallRow, WellnessTypeRow, CustomPackageItem, MealPricingMode } from './types';
import { BIZ_MAP } from './constants';
import { scopeVisible } from '../CheckupTemplates/roleVisibility';

// 为兼容旧调用保留硬编码兜底常量（仅后端无数据时使用）
const FALLBACK_PACKAGES: Record<string, { name: string; price: number }> = {
  A: { name: '基础体检套餐', price: 588 },
  B: { name: '综合体检套餐', price: 1288 },
  C: { name: '深度体检套餐', price: 2888 },
  D: { name: 'VIP体检套餐',   price: 5888 },
};
const FALLBACK_ROOMS: Record<string, { name: string; price: number }> = {
  standard: { name: '标准间',   price: 480 }, bigbed:   { name: '大床房',   price: 520 },
  suite:    { name: '套房',     price: 880 }, vipsuite: { name: 'VIP套房',  price: 1880 },
};
const FALLBACK_HALLS: Record<string, { name: string; capacity: number; halfPrice: number; fullPrice: number }> = {
  siji:     { name: '四季厅', capacity: 80,  halfPrice: 2000, fullPrice: 3500 },
  shanshui: { name: '山水厅', capacity: 40,  halfPrice: 1200, fullPrice: 2200 },
  qingquan: { name: '清泉厅', capacity: 20,  halfPrice: 600,  fullPrice: 1100 },
  wanghu:   { name: '望湖厅', capacity: 120, halfPrice: 3000, fullPrice: 5800 },
};
const FALLBACK_WELLNESS: Record<string, { name: string; minHours: number; price: number; free: boolean; pricingMode?: 'per_hour' | 'package'; packageHours?: number; priceGuest?: number; priceExternal?: number }> = {
  mahjong:     { name: '棋牌室',   minHours: 4, price: 80,  free: false, pricingMode: 'package', packageHours: 4, priceGuest: 200, priceExternal: 250 },
  fishing:     { name: '钓鱼',     minHours: 2, price: 60,  free: false, pricingMode: 'package', packageHours: 12, priceGuest: 200, priceExternal: 250 },
  ktv:         { name: 'KTV大包',  minHours: 2, price: 120, free: false, pricingMode: 'package', packageHours: 3, priceGuest: 688, priceExternal: 688 },
  ktv_small:   { name: 'KTV小包',  minHours: 2, price: 120, free: false, pricingMode: 'package', packageHours: 3, priceGuest: 488, priceExternal: 488 },
  swimming:    { name: '游泳池',   minHours: 0, price: 0,   free: true },
  gym:         { name: '健身房',   minHours: 0, price: 0,   free: true },
  billiards:   { name: '台球室',   minHours: 0, price: 0,   free: true },
  tabletennis: { name: '乒乓房',   minHours: 0, price: 0,   free: true },
};

const FALLBACK_MEALS: Record<string, { name: string; pricingMode: MealPricingMode; unitPrice: number; defaultTime: string }> = {
  work:     { name: '工作餐',     pricingMode: 'per_person', unitPrice: 30,  defaultTime: '12:00' },
  standard: { name: '标准桌餐',   pricingMode: 'per_table',  unitPrice: 500, defaultTime: '12:00' },
  premium:  { name: '豪华桌餐',   pricingMode: 'per_table',  unitPrice: 1200, defaultTime: '12:00' },
  buffet:   { name: '自助餐',     pricingMode: 'per_person', unitPrice: 128, defaultTime: '12:00' },
};

// ================================================
// 日期工具
// ================================================
export function pad(n: number): string { return String(n).padStart(2, '0'); }

export function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function todayStr(): string { return fmt(new Date()); }

export function daysBetween(d1: string, d2: string): number {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 周一为起始
  d.setDate(d.getDate() + diff);
  return d;
}

export function getWeekDates(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function parseDate(s: string): Date {
  return new Date(s);
}

export function groupTotal(g: BookingOrder): number {
  return g.items.reduce((sum, it) => sum + (it.amount || 0), 0);
}

// ================================================
// 金额计算（优先使用后端动态配置，缺失时降级到兜底常量）
// ================================================
interface BizConfigInput {
  packages?: PackageRow[];
  roomTypes?: RoomTypeRow[];
  meetingHalls?: MeetingHallRow[];
  wellnessTypes?: WellnessTypeRow[];
}

function buildMap<T extends { code: string }>(rows?: T[]): Record<string, T> {
  return (rows || []).reduce((acc, r) => { acc[r.code] = r; return acc; }, {} as Record<string, T>);
}

// 根据 pax 的性别/婚姻计算角色
function paxEntryToRole(p: PaxEntry): 'male' | 'female_married' | 'female_single' {
  if (p.gender === '男') return 'male';
  return p.married ? 'female_married' : 'female_single';
}

// 获取一个 pax 的最终体检项目列表（考虑 customItems 定制）
// 修复：按 pax 角色过滤项目，确保只返回该角色适用的项目
export function resolvePaxItems(p: PaxEntry, config?: BizConfigInput): CustomPackageItem[] {
  const role = paxEntryToRole(p);
  // 有定制则直接用定制（customItems 应已按角色过滤过）
  if (p.customItems && p.customItems.length > 0) {
    return p.customItems.filter(it =>
      scopeVisible({ name: it.item_name_snapshot || '', applicable_roles: undefined }, role)
    );
  }
  const pkgMap = buildMap(config?.packages);
  const row = pkgMap[p.package];
  if (row && row.items && row.items.length > 0) {
    return row.items
      .filter((i: any) => {
        // 优先用 item 自带的 role 字段精确过滤
        if (i.role && i.role !== 'common') {
          return i.role === role;
        }
        // 公共项目或无 role 字段：用 scopeVisible 关键词判断
        return scopeVisible({ name: i.item_name_snapshot || '', applicable_roles: undefined }, role);
      })
      .map(i => ({
        item_id: i.item_id,
        item_name_snapshot: i.item_name_snapshot,
        item_price: Number(i.item_price || 0),
        quantity: Number(i.quantity || 1),
        remark: (i as any).remark || '',
        __temporary: false,
      }));
  }
  // 兜底：找不到套餐，显示为一个占位项目
  return [{
    item_id: '',
    item_name_snapshot: `套餐 ${p.package}`,
    item_price: FALLBACK_PACKAGES[p.package]?.price || 0,
    quantity: 1,
    __temporary: false,
  }];
}

// 计算单人最终金额（按 customItems 优先，否则按套餐定价）
export function calcSinglePaxAmount(p: PaxEntry, config?: BizConfigInput): number {
  if (p.customItems && p.customItems.length > 0) {
    return p.customItems.reduce((s, i) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
  }
  const pkgMap = buildMap(config?.packages);
  const row = pkgMap[p.package];
  if (row) {
    const explicitPrice = Number(row.price);
    if (explicitPrice > 0) return explicitPrice;
    const autoTotal = (row.items || []).reduce((s: number, i: any) => s + Number(i.item_price || 0) * Number(i.quantity || 1), 0);
    if (autoTotal > 0) return autoTotal;
  }
  const fb = FALLBACK_PACKAGES[p.package];
  return fb?.price || 0;
}

export function calcCheckupAmount(paxList: PaxEntry[], config?: BizConfigInput): number {
  return paxList.reduce((sum, p) => sum + calcSinglePaxAmount(p, config), 0);
}

export function calcLodgingAmount(lodgingType: string, rooms: number, nights: number, config?: BizConfigInput, customPrice?: number): number {
  const row = buildMap(config?.roomTypes)[lodgingType];
  const basePrice = row ? Number(row.price) : (FALLBACK_ROOMS[lodgingType]?.price || 0);
  // customPrice 允许显式 0 元（免费接待），只有 undefined/null/NaN 才退回标准价
  const useCustom = customPrice !== undefined && customPrice !== null && !Number.isNaN(Number(customPrice));
  const price = useCustom ? Number(customPrice) : basePrice;
  return (price || 0) * Math.max(0, rooms) * Math.max(0, nights);
}

export function calcMeetingAmount(hall: string, slotType: 'half' | 'full', config?: BizConfigInput): number {
  const row = buildMap(config?.meetingHalls)[hall];
  if (row) return slotType === 'half' ? Number(row.half_price || 0) : Number(row.full_price || 0);
  const f = FALLBACK_HALLS[hall];
  if (!f) return 0;
  return slotType === 'half' ? f.halfPrice : f.fullPrice;
}

export function calcWellnessAmount(type: string, hours: number, config?: BizConfigInput, isGuest?: boolean): number {
  const row = buildMap(config?.wellnessTypes)[type];
  let minHours = 0; let price = 0; let free = false;
  let pricingMode: 'per_hour' | 'package' = 'per_hour';
  let priceGuest = 0; let priceExternal = 0;
  if (row) {
    minHours = Number(row.min_hours || 0);
    price = Number(row.price || 0);
    free = Number(row.is_free) === 1;
    pricingMode = (row.pricing_mode as 'per_hour' | 'package') || 'per_hour';
    priceGuest = Number(row.price_guest || 0);
    priceExternal = Number(row.price_external || 0);
  } else {
    const f = FALLBACK_WELLNESS[type];
    if (f) {
      minHours = f.minHours; price = f.price; free = f.free;
      pricingMode = f.pricingMode || 'per_hour';
      priceGuest = f.priceGuest || 0;
      priceExternal = f.priceExternal || 0;
    }
  }
  if (free) return 0;
  // 套餐模式：每个 session 按一口价（入住/不住宿）
  if (pricingMode === 'package') {
    const unitPrice = isGuest ? priceGuest : priceExternal;
    // 多小时套餐以一次session计价（与 hours 无关），保留对小时数为0兜底
    return unitPrice;
  }
  // 按小时模式：保留原逻辑 price × max(hours, min_hours)
  // 若配置了双档价且非0，优先用双档价
  if (priceGuest > 0 || priceExternal > 0) {
    const unitPrice = isGuest ? (priceGuest || price) : (priceExternal || price);
    return unitPrice * Math.max(hours, minHours);
  }
  return price * Math.max(hours, minHours);
}

// 计算单个康乐session在套餐模式下的展示用时长（package 模式取 package_hours）
export function getWellnessDisplayHours(type: string, hours: number, config?: BizConfigInput): number {
  const row = buildMap(config?.wellnessTypes)[type];
  if (row && row.pricing_mode === 'package') {
    return Number(row.package_hours || hours || 0);
  }
  const f = FALLBACK_WELLNESS[type];
  if (f && f.pricingMode === 'package') {
    return f.packageHours || hours || 0;
  }
  return hours;
}

export function calcMealAmount(
  pricingMode: MealPricingMode,
  unitPrice: number,
  tables: number,
  perTable: number,
  pax: number,
): number {
  if (pricingMode === 'per_table') {
    return (Number(unitPrice) || 0) * Math.max(0, Number(tables) || 0);
  }
  // per_person
  const actualPax = Number(pax) || (Number(tables) || 0) * (Number(perTable) || 0);
  return (Number(unitPrice) || 0) * Math.max(0, actualPax);
}

// ================================================
// 早餐派生
// ================================================
export function deriveBreakfastSessions(group: BookingOrder): { date: string; startTime: string; pax: number; source: { checkup?: number; lodging?: number } }[] {
  const dayMap: Record<string, { checkupPax?: number; lodging?: number }> = {};

  // 体检当天：早餐人数 = 体检人数
  group.items.filter(it => it.itemType === 'checkup').forEach(it => {
    const d = it.date;
    if (!dayMap[d]) dayMap[d] = {};
    dayMap[d].checkupPax = (dayMap[d].checkupPax || 0) + it.pax;
  });

  return Object.entries(dayMap)
    .map(([date, v]) => ({
      date,
      startTime: '07:30',
      pax: v.checkupPax || 0,
      source: { checkup: v.checkupPax },
    }))
    .filter(s => s.pax > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ================================================
// 住宿按晚展开（画板渲染用）
// ================================================
export function expandLodgingNights(item: BookingItem): { date: string; label: string; isCheckIn: boolean }[] {
  if (item.itemType !== 'lodging' || !item.extra.dateCheckIn || !item.extra.dateCheckOut) {
    return [{ date: item.date, label: '', isCheckIn: true }];
  }
  const nights = item.extra.nights || daysBetween(item.extra.dateCheckIn, item.extra.dateCheckOut);
  const result: { date: string; label: string; isCheckIn: boolean }[] = [];
  for (let i = 0; i < nights; i++) {
    const d = fmt(addDays(parseDate(item.extra.dateCheckIn), i));
    result.push({ date: d, label: i === 0 ? (item.extra.arrivalTime || '') : '续住', isCheckIn: i === 0 });
  }
  return result;
}

// ================================================
// 画板渲染：获取 item 在画板上的日期范围
// ================================================
export function getItemDateRange(item: BookingItem): { dates: string[] } {
  if (item.itemType === 'lodging' && item.extra.dateCheckIn && item.extra.dateCheckOut) {
    const nights = item.extra.nights || daysBetween(item.extra.dateCheckIn, item.extra.dateCheckOut);
    return { dates: Array.from({ length: nights }, (_, i) => fmt(addDays(parseDate(item.extra.dateCheckIn), i))) };
  }
  if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    return { dates: (item.extra.sessions || []).map(s => s.date) };
  }
  if (item.itemType === 'meeting') {
    return { dates: (item.extra.sessions || []).map(s => s.date) };
  }
  if (item.itemType === 'wellness') {
    return { dates: (item.extra.sessions || []).map(s => s.date) };
  }
  return { dates: [item.date] };
}

// ================================================
// 过滤+展开 items（含早餐派生、住宿按晚展开）
// ================================================
export interface FlatItem {
  item: BookingItem;
  group: BookingOrder;
  date: string;
  isCheckInNight?: boolean;
}

export function flattenItems(orders: BookingOrder[], bizFilter: Set<BizType>, statusFilter: Set<string>): FlatItem[] {
  const result: FlatItem[] = [];

  for (const group of orders) {
    if (!statusFilter.has(group.status)) continue;

    // 收集该订单所有展开后的 items
    const expanded: { item: BookingItem; date: string }[] = [];

    for (const item of group.items) {
      if (item.itemType === 'lodging') {
        expandLodgingNights(item).forEach(n => {
          expanded.push({ item, date: n.date });
        });
      } else if (item.itemType === 'lunch' || item.itemType === 'dinner' || item.itemType === 'meeting' || item.itemType === 'wellness') {
        (item.extra.sessions || []).forEach(s => {
          expanded.push({ item, date: s.date });
        });
      } else if (item.itemType === 'checkup') {
        expanded.push({ item, date: item.date });
      } else if (item.itemType === 'carpickup') {
        expanded.push({ item, date: item.date });
      }
    }

    // 早餐派生
    if (bizFilter.has('breakfast')) {
      const breakfastSessions = deriveBreakfastSessions(group);
      for (const bs of breakfastSessions) {
        const fakeItem: BookingItem = {
          id: `${group.id}_breakfast`,
          itemType: 'breakfast',
          date: bs.date,
          startTime: bs.startTime,
          pax: bs.pax,
          extra: { derived: true, source: bs.source },
          amount: 0,
        };
        expanded.push({ item: fakeItem, date: bs.date });
      }
    }

    // 按业务筛选
    for (const e of expanded) {
      if (bizFilter.has(e.item.itemType)) {
        result.push({ item: e.item, group, date: e.date });
      }
    }
  }

  return result;
}

// ================================================
// 连续日期合并算法
// ================================================
export function mergeConsecutiveItems(flatItems: FlatItem[], weekDates: Date[]): { items: FlatItem[]; startCol: number; endCol: number }[] {
  const weekStrs = weekDates.map(d => fmt(d));

  // 按 item.id 分组
  const byItem = new Map<string, FlatItem[]>();
  for (const fi of flatItems) {
    const key = fi.item.id;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key)!.push(fi);
  }

  const merged: { items: FlatItem[]; startCol: number; endCol: number }[] = [];

  for (const [, items] of byItem) {
    // 按日期排序
    items.sort((a, b) => a.date.localeCompare(b.date));

    // 找出在画板范围内的列索引
    const cols = items.map(fi => weekStrs.indexOf(fi.date)).filter(c => c >= 0);
    if (cols.length === 0) continue;

    const startCol = Math.min(...cols);
    const endCol = Math.max(...cols);

    if (items.length > 1 && endCol > startCol) {
      merged.push({ items, startCol, endCol });
    } else {
      merged.push({ items, startCol, endCol: startCol });
    }
  }

  return merged;
}

// ================================================
// 分轨道算法
// ================================================
export function assignTracks(merged: { items: FlatItem[]; startCol: number; endCol: number }[]): { items: FlatItem[]; startCol: number; endCol: number; track: number }[] {
  const tracks: { startCol: number; endCol: number }[][] = [];
  const result: { items: FlatItem[]; startCol: number; endCol: number; track: number }[] = [];

  // 按起始列排序
  const sorted = [...merged].sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);

  for (const m of sorted) {
    let placed = false;
    for (let t = 0; t < tracks.length; t++) {
      const conflict = tracks[t].some(c => !(m.endCol < c.startCol || m.startCol > c.endCol));
      if (!conflict) {
        tracks[t].push({ startCol: m.startCol, endCol: m.endCol });
        result.push({ ...m, track: t });
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push([{ startCol: m.startCol, endCol: m.endCol }]);
      result.push({ ...m, track: tracks.length - 1 });
    }
  }

  return result;
}

// ================================================
// 团队颜色（基于订单ID哈希）
// ================================================
const TEAM_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

export function grpColor(gid: string): string {
  let hash = 0;
  for (let i = 0; i < gid.length; i++) {
    hash = ((hash << 5) - hash) + gid.charCodeAt(i);
    hash |= 0;
  }
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length];
}

// ================================================
// CSV 解析/生成
// ================================================
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    // 支持 Tab 分隔
    if (line.includes('\t')) {
      rows.push(line.split('\t').map(c => c.trim()));
      continue;
    }
    // 支持引号转义的 CSV
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cells.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

export function toCSV(rows: string[][], headers: string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map(c => {
      if (c.includes(',') || c.includes('"') || c.includes('\n')) {
        return `"${c.replace(/"/g, '""')}"`;
      }
      return c;
    }).join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

export function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ================================================
// 生成项目ID
// ================================================
let _itemSeq = 0;
export function genItemId(): string {
  _itemSeq++;
  return `IT${pad(_itemSeq).padStart(4, '0')}`;
}

let _orderSeq = 0;
export function genOrderNo(): string {
  _orderSeq++;
  return `OG${pad(_orderSeq).padStart(4, '0')}`;
}
