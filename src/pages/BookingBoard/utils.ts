import type { BookingOrder, BookingItem, BizType, RenderCard, PaxEntry, PackageRow, RoomTypeRow, MeetingHallRow, WellnessTypeRow } from './types';
import { BIZ_MAP } from './constants';

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
const FALLBACK_WELLNESS: Record<string, { name: string; minHours: number; price: number; free: boolean }> = {
  mahjong:     { name: '棋牌室',   minHours: 4, price: 80,  free: false },
  fishing:     { name: '钓鱼',     minHours: 2, price: 60,  free: false },
  ktv:         { name: 'KTV',      minHours: 2, price: 120, free: false },
  swimming:    { name: '游泳池',   minHours: 0, price: 0,   free: true },
  gym:         { name: '健身房',   minHours: 0, price: 0,   free: true },
  billiards:   { name: '台球室',   minHours: 0, price: 0,   free: true },
  tabletennis: { name: '乒乓房',   minHours: 0, price: 0,   free: true },
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

export function calcCheckupAmount(paxList: PaxEntry[], config?: BizConfigInput): number {
  const pkgMap = buildMap(config?.packages);
  return paxList.reduce((sum, p) => {
    const row = pkgMap[p.package];
    const price = row ? Number(row.price) : (FALLBACK_PACKAGES[p.package]?.price || 0);
    return sum + (price || 0);
  }, 0);
}

export function calcLodgingAmount(lodgingType: string, rooms: number, nights: number, config?: BizConfigInput): number {
  const row = buildMap(config?.roomTypes)[lodgingType];
  const price = row ? Number(row.price) : (FALLBACK_ROOMS[lodgingType]?.price || 0);
  return (price || 0) * Math.max(0, rooms) * Math.max(0, nights);
}

export function calcMeetingAmount(hall: string, slotType: 'half' | 'full', config?: BizConfigInput): number {
  const row = buildMap(config?.meetingHalls)[hall];
  if (row) return slotType === 'half' ? Number(row.half_price || 0) : Number(row.full_price || 0);
  const f = FALLBACK_HALLS[hall];
  if (!f) return 0;
  return slotType === 'half' ? f.halfPrice : f.fullPrice;
}

export function calcWellnessAmount(type: string, hours: number, config?: BizConfigInput): number {
  const row = buildMap(config?.wellnessTypes)[type];
  let minHours = 0; let price = 0; let free = false;
  if (row) {
    minHours = Number(row.min_hours || 0);
    price = Number(row.price || 0);
    free = Number(row.is_free) === 1;
  } else {
    const f = FALLBACK_WELLNESS[type];
    if (f) { minHours = f.minHours; price = f.price; free = f.free; }
  }
  if (free) return 0;
  return price * Math.max(hours, minHours);
}

// ================================================
// 早餐派生
// ================================================
export function deriveBreakfastSessions(group: BookingOrder): { date: string; startTime: string; pax: number; source: { checkup?: number; lodging?: number } }[] {
  const dayMap: Record<string, { checkupPax?: number; lodgingPax?: number }> = {};

  // 体检当天
  group.items.filter(it => it.itemType === 'checkup').forEach(it => {
    const d = it.date;
    if (!dayMap[d]) dayMap[d] = {};
    dayMap[d].checkupPax = (dayMap[d].checkupPax || 0) + it.pax;
  });

  // 住宿期间（入住次日 → 离店日）
  group.items.filter(it => it.itemType === 'lodging').forEach(it => {
    if (!it.extra.dateCheckIn || !it.extra.dateCheckOut) return;
    const nights = it.extra.nights || daysBetween(it.extra.dateCheckIn, it.extra.dateCheckOut);
    for (let i = 1; i <= nights; i++) {
      const d = fmt(addDays(parseDate(it.extra.dateCheckIn), i));
      if (!dayMap[d]) dayMap[d] = {};
      dayMap[d].lodgingPax = (dayMap[d].lodgingPax || 0) + it.pax;
    }
  });

  return Object.entries(dayMap)
    .map(([date, v]) => ({
      date,
      startTime: '07:30',
      pax: Math.max(v.checkupPax || 0, v.lodgingPax || 0),
      source: { checkup: v.checkupPax, lodging: v.lodgingPax },
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
