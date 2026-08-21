import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Calendar, X, ArrowLeftRight, Download, Upload, FileText, Star, Edit2, ChevronDown, AlertCircle, Settings, Trash2, Users, ClipboardList } from 'lucide-react';
import type { BookingOrder, BookingItem, BizType, OrderStatus, PaxEntry, CustomPackageItem } from './types';
import {
  BUSINESS,
  BIZ_MAP,
  STATUS_MAP,
  LODGING_TYPES,
  MEETING_HALLS,
  WELLNESS_TYPES,
  hexAlpha,
} from './constants';
import {
  fmt,
  addDays,
  getWeekStart,
  getWeekDates,
  todayStr,
  groupTotal,
  flattenItems,
  mergeConsecutiveItems,
  assignTracks,
  getItemDateRange,
  type FlatItem,
} from './utils';
import { bookingApi, type BookingApiOrder } from '../../lib/api';
import { checkupApi } from '@/pages/CheckupTemplates/api';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/Toast';
import CreateFormRaw from './Create';
import BizConfigModal from './BizConfigModal';

const ROLE_LABEL: Record<string, string> = {
  male: '男性', female_married: '已婚女', female_single: '未婚女',
};
function paxToRole(gender?: string, married?: any): 'male' | 'female_married' | 'female_single' {
  if (gender === '男') return 'male';
  return married ? 'female_married' : 'female_single';
}
function maskIdCard(id: string): string {
  if (!id) return '-';
  const s = String(id);
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}
// 销售套餐胶囊名称兜底：识别 UUID/纯ID 等自动生成名，生成友好名
function friendlyCapsuleName(cap: any): string {
  if (!cap) return '未设置套餐';
  const raw = String(cap.name || cap.code || '').trim();
  if (!raw) return cap.code ? `${cap.code}套餐` : '体检套餐';
  const ugly = [
    /^套餐\s*[0-9a-fA-F-]{8,}$/, /^[0-9a-fA-F]{8}-[0-9a-fA-F-]+$/,
    /^[0-9]+$/, /^[Pp]KG[_-]?\w+$/, /^[Pp]ackage[_-]?\w+$/, /^[0-9a-fA-F]{12,}$/,
  ].some(p => p.test(raw));
  if (!ugly) return raw;
  if (cap.code) return `${cap.code}套餐`;
  return '体检套餐';
}

const CreateForm = CreateFormRaw as unknown as React.FC<{
  mode: 'create' | 'edit' | 'copy';
  order?: BookingOrder;
  onClose: () => void;
  onSaved: (order: BookingOrder) => Promise<void> | void;
}>;

// ================================================
// 本地类型 & 常量
// ================================================
interface BoardCard {
  item: BookingItem;
  group: BookingOrder;
  startCol: number;
  endCol: number;
  track: number;
  isMerged: boolean;
  flatItems: FlatItem[];
}

const ALL_BIZ: BizType[] = BUSINESS.map(b => b.type);
const ALL_STATUS: OrderStatus[] = ['pending', 'reviewing', 'confirmed', 'rejected', 'completed'];
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ================================================
// 后端订单 → 前端订单适配
// 后端字段：orderNo, paymentMethod, rejectionReason, rejectedByName
// 前端字段：id(显示用orderNo), payment, rejectReason, rejectedBy
// ================================================
function adaptOrder(apiOrder: BookingApiOrder): BookingOrder {
  return {
    id: apiOrder.orderNo || apiOrder.id,
    customerName: apiOrder.customerName || '',
    contactName: apiOrder.contactName || '',
    contactPhone: apiOrder.contactPhone || '',
    salesPerson: apiOrder.salesPerson || '',
    salesPersonId: apiOrder.salesPersonId || '',
    payment: apiOrder.paymentMethod || '',
    remark: apiOrder.remark || '',
    items: (apiOrder.items || []).map((it: any) => ({
      ...it,
      extra: it.extra || {},
    })),
    status: (apiOrder.status as OrderStatus) || 'pending',
    createdAt: apiOrder.createdAt || '',
    confirmedAt: apiOrder.confirmedAt,
    rejectedBy: apiOrder.rejectedByName || apiOrder.rejectedBy || '',
    rejectReason: apiOrder.rejectionReason || '',
  };
}

// 会话多类型 session 取值辅助（ItemExtra.sessions 在类型上声明为 MealSession[]，
// 但实际也会承载 MeetingSession / WellnessSession，这里仅做受控断言）
type MeetingSess = { date: string; startTime: string; hall: keyof typeof MEETING_HALLS; slotType: 'half' | 'full'; pax: number };
type WellnessSess = { date: string; startTime: string; wellnessType: keyof typeof WELLNESS_TYPES; hours: number; pax: number };

function meetingSession(item: BookingItem): MeetingSess | undefined {
  return item.extra.sessions?.[0] as unknown as MeetingSess | undefined;
}
function wellnessSession(item: BookingItem): WellnessSess | undefined {
  return item.extra.sessions?.[0] as unknown as WellnessSess | undefined;
}

// ================================================
// 工具函数
// ================================================
function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
}

function rowMinHeight(cards: BoardCard[]): number {
  const maxTrack = cards.length ? Math.max(...cards.map(c => c.track)) : -1;
  return Math.max(120, (maxTrack + 1) * 96 + 16);
}

// 卡片摘要文本（用于跨天合并卡）
function cardSummary(item: BookingItem, days: number): string {
  const parts: string[] = [];
  if (item.itemType === 'checkup') {
    // 第5期：优先使用 finalAmount 快照计算金额，避免依赖常量套餐定价
    const paxList: PaxEntry[] = item.extra.paxList || [];
    // 统计各套餐人数（仅用于概览标签，finalItems 才是权威数据）
    const pkgCounts: Record<string, number> = {};
    let snapTotal = 0;
    let itemCount = 0;
    paxList.forEach((p: any) => {
      pkgCounts[p.package] = (pkgCounts[p.package] || 0) + 1;
      if (typeof p.finalAmount === 'number') snapTotal += p.finalAmount;
      if (Array.isArray(p.finalItems)) itemCount += p.finalItems.length;
    });
    parts.push(`${item.pax}人`);
    if (itemCount > 0) parts.push(`${itemCount}项`);
    const displayAmount = snapTotal > 0 ? snapTotal : (item.amount || 0);
    if (displayAmount) parts.push(`¥${displayAmount.toLocaleString()}`);
  } else if (item.itemType === 'lodging') {
    const lt = LODGING_TYPES[item.extra.lodgingType || 'standard'] || { name: item.extra.lodgingType || '标准间', price: 0 };
    parts.push(lt.name, `${item.pax}间`);
    if (item.extra.nights) parts.push(`${item.extra.nights}晚`);
    if (item.amount) parts.push(`¥${item.amount}`);
  } else if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    parts.push(BIZ_MAP[item.itemType].label);
    const mealSess = item.extra.sessions || [];
    const tblCount = mealSess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? 0 : (x.tables || 0)), 0);
    const paxCount = mealSess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? (x.pax || 0) : 0), 0);
    if (tblCount > 0) parts.push(`${tblCount}桌`);
    if (paxCount > 0) parts.push(`${paxCount}人`);
    if (days > 1) parts.push(`${days}天`);
  } else if (item.itemType === 'meeting') {
    const s = meetingSession(item);
    if (s) parts.push((MEETING_HALLS[s.hall] || { name: s.hall }).name);
    parts.push(`${item.pax}人`);
    if (days > 1) parts.push(`${days}天`);
    if (item.amount) parts.push(`¥${item.amount}`);
  } else if (item.itemType === 'wellness') {
    const s = wellnessSession(item);
    if (s) {
      parts.push((WELLNESS_TYPES[s.wellnessType] || { name: s.wellnessType }).name, `${s.hours}时`);
    }
    parts.push(`${item.pax}人`);
    if (item.amount) parts.push(`¥${item.amount}`);
  } else if (item.itemType === 'breakfast') {
    parts.push('早餐', `${item.pax}人`);
    if (days > 1) parts.push(`${days}天`);
  } else if (item.itemType === 'carpickup') {
    parts.push(BIZ_MAP.carpickup.label, `${item.pax}人`);
    const sess = item.extra?.carpickup;
    if (sess?.customers?.length) parts.push(`${sess.customers.length}位客户`);
    if (sess?.shareRide) parts.push('拼车');
    if (item.amount) parts.push(`¥${item.amount}`);
  } else {
    parts.push(BIZ_MAP[item.itemType].label, `${item.pax}${BIZ_MAP[item.itemType].unit}`);
  }
  return parts.join(' · ');
}

// 详情弹窗中显示的日期范围
function itemDateRange(item: BookingItem): string {
  if (item.itemType === 'lodging' && item.extra.dateCheckIn && item.extra.dateCheckOut) {
    const nights = item.extra.nights ? ` (${item.extra.nights}晚)` : '';
    return `${item.extra.dateCheckIn} → ${item.extra.dateCheckOut}${nights}`;
  }
  const dates = (item.extra.sessions || []).map(s => s.date);
  const uniq = Array.from(new Set(dates.length ? dates : [item.date]));
  return uniq.length > 1
    ? `${uniq[0]} → ${uniq[uniq.length - 1]} (${uniq.length}天)`
    : uniq[0];
}

// 详情弹窗中显示的项目细节
function itemDetail(item: BookingItem): string {
  if (item.itemType === 'checkup') {
    // 第5期：优先基于 finalItems / finalAmount 快照展示，不再依赖 CHECKUP_PACKAGES 常量
    const paxList: any[] = item.extra.paxList || [];
    if (paxList.length === 0) return '—';
    let snapTotal = 0;
    let totalItems = 0;
    let customCount = 0;
    paxList.forEach(p => {
      if (typeof p.finalAmount === 'number') snapTotal += p.finalAmount;
      if (Array.isArray(p.finalItems)) {
        totalItems += p.finalItems.length;
        // 如果有 customItems 或 finalItems 与套餐不同，标记为"已定制"
        if (p.customItems && p.customItems.length > 0) customCount++;
      }
    });
    const parts: string[] = [`${paxList.length}人`];
    if (totalItems > 0) parts.push(`${totalItems}项`);
    if (customCount > 0) parts.push(`${customCount}人已定制`);
    if (snapTotal > 0) parts.push(`人均¥${Math.round(snapTotal / paxList.length).toLocaleString()}`);
    return parts.join(' · ');
  }
  if (item.itemType === 'lodging') return (LODGING_TYPES[item.extra.lodgingType || 'standard'] || { name: item.extra.lodgingType || '标准间' }).name;
  if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    const mealSess = item.extra.sessions || [];
    const tblCount = mealSess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? 0 : (x.tables || 0)), 0);
    const perTable = mealSess.find((x: any) => x.pricingMode === 'per_table')?.perTable || 0;
    const paxCount = mealSess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? (x.pax || 0) : 0), 0);
    const parts: string[] = [];
    if (tblCount > 0) parts.push(`${tblCount}桌 × ${perTable}人/桌`);
    if (paxCount > 0) parts.push(`${paxCount}人`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }
  if (item.itemType === 'meeting') {
    const s = meetingSession(item);
    if (s) return `${(MEETING_HALLS[s.hall] || { name: s.hall }).name} · ${s.slotType === 'half' ? '半天' : '全天'}`;
  }
  if (item.itemType === 'wellness') {
    const s = wellnessSession(item);
    if (s) return `${(WELLNESS_TYPES[s.wellnessType] || { name: s.wellnessType }).name} · ${s.hours}小时`;
  }
  if (item.itemType === 'breakfast') {
    const src = item.extra.source;
    if (src) return `派生(体检${src.checkup || 0}/住宿${src.lodging || 0})`;
  }
  if (item.itemType === 'carpickup') {
    const sess = item.extra?.carpickup;
    if (!sess) return '—';
    const parts: string[] = [`${sess.customers?.length || 1}位客户`];
    if (item.pax) parts.push(`共${item.pax}人`);
    if (sess.shareRide) parts.push('拼车');
    if (sess.pricePerCustomer) parts.push(`¥${sess.pricePerCustomer}/客户`);
    if (sess.remark) parts.push(sess.remark);
    return parts.join(' · ');
  }
  return '';
}

// ================================================
// 甘特卡片
// ================================================
function GanttCard({
  card,
  bizColor,
  onClick,
}: {
  card: BoardCard;
  bizColor: string;
  onClick: () => void;
}) {
  const { item, group, startCol, endCol, track, isMerged } = card;
  const left = `calc(${(startCol / 7) * 100}% + 4px)`;
  const width = `calc(${((endCol - startCol + 1) / 7) * 100}% - 8px)`;
  const top = `${track * 96}px`;
  const status = STATUS_MAP[group.status];
  const days = endCol - startCol + 1;
  const cardBg = hexAlpha(bizColor, 0.06);
  const borderCol = hexAlpha(bizColor, 0.35);

  if (isMerged) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="absolute text-left rounded-lg shadow-sm hover:shadow-md transition-all overflow-hidden hover:-translate-y-0.5"
        style={{
          left,
          width,
          top,
          height: '88px',
          background: cardBg,
          border: `1.5px solid ${borderCol}`,
          borderLeft: `4px solid ${bizColor}`,
        }}
      >
        <div
          className="flex items-center justify-between px-2.5 py-0.5"
          style={{ borderBottom: `1px solid ${hexAlpha(bizColor, 0.25)}`, background: hexAlpha(bizColor, 0.08) }}
        >
          <span className="text-[10px] font-medium text-gray-700">
            {BIZ_MAP[item.itemType].label}
          </span>
          <span className="text-[10px] flex items-center gap-0.5 font-medium" style={{ color: bizColor }}>
            <ArrowLeftRight size={10} /> {days}天
          </span>
        </div>
        <div className="px-2.5 py-1">
          <div className="text-xs font-bold text-gray-900 truncate">{group.customerName}</div>
          <div className="text-[11px] text-gray-700 truncate">{cardSummary(item, days)}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
            <span className="text-[10px] text-gray-600 truncate">{group.remark?.trim() || '—'}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute text-left rounded-lg shadow-sm hover:shadow-md transition-all overflow-hidden hover:-translate-y-0.5"
      style={{
        left,
        width,
        top,
        height: '88px',
        background: cardBg,
        border: `1.5px solid ${borderCol}`,
        borderLeft: `4px solid ${bizColor}`,
      }}
    >
      <div className="px-2.5 py-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-gray-600">
            {item.startTime}
            {item.endTime ? `-${item.endTime}` : ''}
          </span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
        </div>
        <div className="text-xs font-bold text-gray-900 truncate mt-0.5">{group.customerName}</div>
        <div className="text-[11px] text-gray-700 truncate">
          {item.itemType === 'lunch' || item.itemType === 'dinner' ? (() => {
            const sess = item.extra.sessions || [];
            const tbl = sess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? 0 : (x.tables || 0)), 0);
            const paxPp = sess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? (x.pax || 0) : 0), 0);
            const qty = tbl > 0 ? `${tbl}桌` : (paxPp > 0 ? `${paxPp}人` : `${item.pax}${BIZ_MAP[item.itemType].unit}`);
            return `${qty}${item.amount ? ` · ¥${item.amount}` : ''}`;
          })() : (
            <>
              {item.pax}
              {BIZ_MAP[item.itemType].unit}
              {item.amount ? ` · ¥${item.amount}` : ''}
            </>
          )}
        </div>
        <div className="text-[10px] text-gray-500 truncate">{group.remark?.trim() || '—'}</div>
      </div>
    </button>
  );
}

// ================================================
// 甘特板业务行
// ================================================
function BizRow({
  biz,
  cards,
  weekDates,
  todayKey,
  onCardClick,
}: {
  biz: (typeof BUSINESS)[number];
  cards: BoardCard[];
  weekDates: Date[];
  todayKey: string;
  onCardClick: (g: BookingOrder) => void;
}) {
  const height = rowMinHeight(cards);
  const laneBg = hexAlpha(biz.color, 0.08);
  return (
    <div className="flex border-b border-gray-200 min-w-[1110px]" style={{ minHeight: `${height}px` }}>
      {/* 左侧固定栏 */}
      <div
        className="w-[200px] flex-shrink-0 sticky left-0 z-10 flex items-center gap-2.5 px-3 border-r border-gray-200"
        style={{ background: laneBg, borderLeft: `4px solid ${biz.color}` }}
      >
        <span className="text-xl leading-none flex-shrink-0">{biz.icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-800 truncate">{biz.label}</div>
          <div className="text-[11px] text-gray-500">{cards.length} 项</div>
        </div>
      </div>
      {/* 右侧日历区 */}
      <div className="relative flex-1">
        {/* 背景日格 */}
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))' }}
        >
          {weekDates.map((d, i) => {
            const ds = fmt(d);
            const isToday = ds === todayKey;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={i}
                className="border-r border-gray-200"
                style={{
                  background: isToday
                    ? '#ecfdf5'
                    : isWeekend
                      ? '#f9fafb'
                      : '#fafbfc',
                }}
              />
            );
          })}
        </div>
        {/* 卡片覆盖层 */}
        <div className="absolute inset-0">
          {cards.map((card, idx) => (
            <GanttCard
              key={`${card.item.id}-${idx}`}
              card={card}
              bizColor={biz.color}
              onClick={() => onCardClick(card.group)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================
// 详情弹窗
// ================================================
function TimelineItem({
  label,
  time,
  state,
  note,
}: {
  label: string;
  time: string;
  state: 'done' | 'active' | 'danger';
  note?: string;
}) {
  const dot =
    state === 'danger' ? 'bg-red-500' : state === 'active' ? 'bg-blue-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-gray-700">{label}</span>
      <span className="text-gray-400 font-mono ml-auto">{time}</span>
      {note && <span className="text-red-500 text-[11px]">（{note}）</span>}
    </div>
  );
}

function DetailModal({
  order,
  onClose,
  onCopy,
  onEdit,
  canOperate,
  onSetTemplate,
}: {
  order: BookingOrder;
  onClose: () => void;
  onCopy: () => void;
  onEdit: () => void;
  canOperate: boolean;
  onSetTemplate: (orderId: string, customerName: string) => void;
}) {
  const canEdit = canOperate &&
    (order.status === 'pending' || order.status === 'reviewing' || order.status === 'confirmed');
  const total = groupTotal(order);
  const status = STATUS_MAP[order.status];
  const toast = useToast();
  // 全部业务展开（不再只体检）
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // 体检：加载当前销售员的销售胶囊，用于回显套餐名 + 角色定价
  const [salesCapsules, setSalesCapsules] = useState<any[]>([]);
  const [capsulesLoading, setCapsulesLoading] = useState(false);
  // 业务配置（用于 code→中文名反查，以及体检套餐 items 导出）
  const [bizCfg, setBizCfg] = useState<any>({
    packages: [], roomTypes: [], meetingHalls: [], wellnessTypes: [], mealTypes: [],
  });
  const [bizCfgLoading, setBizCfgLoading] = useState(false);

  useEffect(() => {
    const sid = order.salesPersonId;
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
  }, [order.salesPersonId]);

  useEffect(() => {
    let mounted = true;
    setBizCfgLoading(true);
    (async () => {
      try {
        const cfg = await bookingApi.getConfig();
        if (!mounted) return;
        setBizCfg({
          packages: cfg.packages || [],
          roomTypes: cfg.roomTypes || [],
          meetingHalls: cfg.meetingHalls || [],
          wellnessTypes: cfg.wellnessTypes || [],
          mealTypes: cfg.mealTypes || [],
        });
      } catch {
        // 失败保持空数组，用 code 兜底展示
      } finally { if (mounted) setBizCfgLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const capsuleMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const c of salesCapsules) m[c.id] = c;
    return m;
  }, [salesCapsules]);

  // 体检套餐模板缓存（胶囊id→{ template, loading }）
  const [tplCache, setTplCache] = useState<Record<string, { loading?: boolean; template?: any; error?: boolean }>>({});
  function loadTemplateForCapsule(capId: string, cap: any): Promise<any> {
    return new Promise(async (resolve) => {
      const cached = tplCache[capId];
      if (cached && cached.template) return resolve(cached.template);
      if (cached && cached.loading) {
        // 轮询等待
        let tryLeft = 20;
        const tick = () => {
          const c = tplCache[capId];
          if (c && c.template) return resolve(c.template);
          if (c && c.error) return resolve(null);
          if (tryLeft-- <= 0) return resolve(null);
          setTimeout(tick, 200);
        };
        return tick();
      }
      setTplCache(prev => ({ ...prev, [capId]: { loading: true } }));
      let tpl: any = null;
      // 销售胶囊已自带 prices（三角色折扣价），但不含 items。
      // 用胶囊自身 id 作为 packageId，调 preview 端点获取完整模板（仅需登录，不做严格权限检查）
      if (cap?.id) {
        try {
          const res = await checkupApi.preview(cap.id);
          if (res?.ok) tpl = res.data;
        } catch { /* 忽略 */ }
      }
      // 兜底：如果模板接口没返回，尝试从胶囊自身字段取（极少数场景）
      if (!tpl && cap && (cap.items_by_role || cap.role_items || (cap.items && cap.items.length))) {
        tpl = {
          id: cap.id,
          name: cap.name,
          code: cap.code,
          items_by_role: cap.items_by_role,
          role_items: cap.role_items,
          items: cap.items,
          role_plans: {
            male: { discount_price: cap.prices?.male?.discount_price || 0 },
            female_married: { discount_price: cap.prices?.female_married?.discount_price || 0 },
            female_single: { discount_price: cap.prices?.female_single?.discount_price || 0 },
          },
        };
      }
      setTplCache(prev => ({ ...prev, [capId]: { template: tpl || null, loading: false, error: !tpl } }));
      resolve(tpl || null);
    });
  }

  function toggleExpand(id: string) {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ======== 导出：体检名单（xlsx，不脱敏，用于导入体检系统） ========
  async function exportCheckupPax(item: BookingItem, packageName: string) {
    const paxList: any[] = (item.extra as any).paxList || [];
    if (paxList.length === 0) { toast.warn('暂无体检名单可导出'); return; }
    try {
      const XLSX = (await import('xlsx')) as any;
      const header = ['序号', '姓名', '性别', '婚否', '身份证号', '手机号', '角色', '套餐', '单人价(元)', '备注'];
      const rows: any[][] = paxList.map((p, i) => {
        const role = paxToRole(p.gender, p.married);
        const cap = capsuleMap[p.package] || null;
        const price = Number(cap?.prices?.[role]?.discount_price || (typeof p.finalAmount === 'number' ? p.finalAmount : 0) || 0);
        return [
          i + 1,
          p.name || '',
          p.gender || '',
          p.married ? '已婚' : '未婚',
          { t: 's', v: String(p.idCard || '') }, // 强制文本，避免18位科学计数
          { t: 's', v: String(p.phone || '') },
          ROLE_LABEL[role] || role,
          packageName,
          price,
          (p.remark ?? ''),
        ];
      });
      const aoa = [header, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // 设置身份证/手机号列宽 + 文本格式
      ws['!cols'] = [
        { wch: 6 }, { wch: 12 }, { wch: 6 }, { wch: 6 },
        { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 24 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '体检名单');
      const dateTag = (item.date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
      XLSX.writeFile(wb, `${order.id}_${order.customerName || '订单'}_体检名单_${dateTag}.xlsx`);
      toast.success(`已导出 ${paxList.length} 人体检名单`);
    } catch (e: any) {
      toast.error('导出失败：' + (e?.message || String(e)));
    }
  }

  // ======== 导出/查看：三角色套餐项目（xlsx，用于导入体检系统） ========
  // 直接查看：内嵌 Sub-Modal（不要 PDF）
  const [viewingPkg, setViewingPkg] = useState<{ capId: string; loading: boolean; sheets?: any[]; error?: string; autoExport?: boolean } | null>(null);
  useEffect(() => {
    // 「导出套餐.xlsx」按钮用：加载完成后自动下载并关闭弹窗
    if (viewingPkg && viewingPkg.autoExport && viewingPkg.sheets) {
      exportCheckupPackageExcel();
      setViewingPkg(null);
    }
    if (viewingPkg && viewingPkg.autoExport && viewingPkg.error) {
      toast.error('套餐数据加载失败，无法导出：' + viewingPkg.error);
      setViewingPkg(null);
    }
  }, [viewingPkg?.sheets, viewingPkg?.error, viewingPkg?.autoExport]);
  async function viewCheckupPackage(capId: string, cap: any, fallbackPackageCodeName: string, opts?: { autoExport?: boolean }) {
    setViewingPkg({ capId, loading: true, autoExport: !!opts?.autoExport });
    try {
      const tpl = await loadTemplateForCapsule(capId, cap);
      const displayRoles: Array<'male' | 'female_married' | 'female_single'> = ['male', 'female_married', 'female_single'];
      const sheets = displayRoles.map(role => {
        let items: any[] = [];
        if (tpl?.items_by_role && typeof tpl.items_by_role === 'object') {
          const common: any[] = Array.isArray(tpl.items_by_role.common) ? tpl.items_by_role.common : [];
          const roleItems: any[] = Array.isArray(tpl.items_by_role[role]) ? tpl.items_by_role[role] : [];
          items = [...common, ...roleItems];
        } else if (tpl?.role_items && typeof tpl.role_items === 'object') {
          items = (tpl.role_items[role]?.items) || [];
        } else if (tpl?.items && Array.isArray(tpl.items)) {
          const all: any[] = tpl.items;
          items = all.filter((it: any) => it.role === 'common' || it.role === role);
        } else if (cap?.items && Array.isArray(cap.items)) {
          const all: any[] = cap.items;
          items = all.filter((it: any) => (!it.role) || it.role === 'common' || it.role === role);
        }
        const discountPrice = Number(cap?.prices?.[role]?.discount_price || tpl?.role_price_capsule?.[role]?.discount_price || tpl?.role_plans?.[role]?.discount_price || 0);
        const CATEGORY_ORDER = ['体格检查', '实验室', '影像检查', '功能检查', '肿瘤筛查', '妇科专项', '特色加项'];
        items.sort((a, b) => {
          const sa = (Number(a.sort_order ?? 0) || 0) - (Number(b.sort_order ?? 0) || 0);
          if (sa !== 0) return sa;
          const ca = CATEGORY_ORDER.indexOf(a.category || '') >>> 0;
          const cb = CATEGORY_ORDER.indexOf(b.category || '') >>> 0;
          return ca - cb;
        });
        return {
          role,
          label: ROLE_LABEL[role] || role,
          discountPrice,
          items: items.map(i => ({
            category: i.category || '—',
            name: i.item_name_snapshot || i.name || '—',
            price: Number(i.item_price || i.default_price || i.price || 0),
            qty: Number(i.quantity || 1),
            remark: (i.remark ?? ''),
          })),
        };
      });
      setViewingPkg({ capId, loading: false, sheets, autoExport: !!opts?.autoExport });
    } catch (e: any) {
      setViewingPkg({ capId, loading: false, error: e?.message || '套餐详情加载失败', autoExport: !!opts?.autoExport });
    }
  }
  async function exportCheckupPackageExcel() {
    if (!viewingPkg?.sheets) return;
    try {
      const XLSX = (await import('xlsx')) as any;
      const wb = XLSX.utils.book_new();
      for (const sheet of viewingPkg.sheets) {
        const header = ['序号', '分类', '项目名称', '单价(元)', '数量', '小计(元)', '备注'];
        const rawTotal = sheet.items.reduce((s: number, it: any) => s + it.price * it.qty, 0);
        const rows: any[][] = sheet.items.map((it: any, i: number) => [
          i + 1, it.category, it.name, it.price, it.qty, Math.round(it.price * it.qty * 100) / 100, it.remark || '',
        ]);
        rows.push([
          '', '', '合计（原价）', '', '', rawTotal, '',
        ]);
        rows.push([
          '', '', `合计（折扣·${sheet.label}）`, '', '', sheet.discountPrice, '胶囊折后价',
        ]);
        const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
        ws['!cols'] = [
          { wch: 6 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, { wch: 20 },
        ];
        const safeName = sheet.label.length > 20 ? sheet.label.slice(0, 20) : sheet.label;
        XLSX.utils.book_append_sheet(wb, ws, safeName);
      }
      const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const capName = viewingPkg.capId && capsuleMap[viewingPkg.capId] ? friendlyCapsuleName(capsuleMap[viewingPkg.capId]) : '体检套餐';
      XLSX.writeFile(wb, `${order.id}_${order.customerName || '订单'}_${capName}_${dateTag}.xlsx`);
      toast.success('体检套餐 Excel 已导出');
    } catch (e: any) {
      toast.error('导出失败：' + (e?.message || String(e)));
    }
  }

  // ======== 反查 helpers（mealTypes/rooms/halls/wellness/packages） ========
  function mealName(code: string): string {
    const f = (bizCfg.mealTypes || []).find((m: any) => m.code === code);
    return f?.name || code;
  }
  function roomName(code: string): string {
    const f = (bizCfg.roomTypes || []).find((m: any) => m.code === code);
    return f?.name || (LODGING_TYPES[code as keyof typeof LODGING_TYPES]?.name) || code;
  }
  function hallName(code: string): string {
    const f = (bizCfg.meetingHalls || []).find((m: any) => m.code === code);
    return f?.name || (MEETING_HALLS[code as keyof typeof MEETING_HALLS]?.name) || code;
  }
  function wellnessName(code: string): string {
    const f = (bizCfg.wellnessTypes || []).find((m: any) => m.code === code);
    return f?.name || (WELLNESS_TYPES[code as keyof typeof WELLNESS_TYPES]?.name) || code;
  }
  function wellnessPrice(code: string, forGuest: boolean): number {
    const f = (bizCfg.wellnessTypes || []).find((m: any) => m.code === code);
    if (!f) return 0;
    if (Number(f.is_free) === 1) return 0;
    return Number(forGuest ? (f.price_guest || f.price || 0) : (f.price_external || f.price || 0));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] text-gray-500">订单号</div>
            <div className="text-lg font-bold font-mono text-gray-900">{order.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-[11px]"
              style={{ color: status.color, background: status.bg }}
            >
              {status.label}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* 客户 & 联系信息 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-gray-500">客户名称</div>
              <div className="text-sm text-gray-800 font-medium">{order.customerName}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">联系人 / 电话</div>
              <div className="text-sm text-gray-800 font-mono">
                {order.contactName} {order.contactPhone}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">销售人员</div>
              <div className="text-sm text-gray-800">{order.salesPerson}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">付款方式</div>
              <div className="text-sm text-gray-800">{order.payment}</div>
            </div>
          </div>

          {/* 状态时间线 */}
          <div>
            <div className="text-[11px] text-gray-500 mb-2">状态时间线</div>
            <div className="space-y-1.5">
              <TimelineItem label="提交订单" time={order.createdAt} state="done" />
              {order.status === 'pending' && (
                <TimelineItem label="待确认" time="等待中" state="active" />
              )}
              {(order.status === 'reviewing' ||
                order.status === 'confirmed' ||
                order.status === 'completed') && (
                <TimelineItem label="待审核 → 审核通过" time="已审核" state="done" />
              )}
              {order.status === 'rejected' && (
                <TimelineItem
                  label="已驳回"
                  time={order.rejectedBy || '审核人'}
                  state="danger"
                  note={order.rejectReason}
                />
              )}
              {(order.status === 'confirmed' || order.status === 'completed') && (
                <TimelineItem
                  label="已确认"
                  time={order.confirmedAt || '已确认'}
                  state="done"
                />
              )}
              {order.status === 'completed' && (
                <TimelineItem label="已完成" time="已完结" state="done" />
              )}
            </div>
          </div>

          {/* 业务项目表格 */}
          <div>
            <div className="text-[11px] text-gray-500 mb-2">
              业务项目（{order.items.length}）
            </div>
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">业务</th>
                    <th className="px-2 py-1.5 text-left font-medium">日期</th>
                    <th className="px-2 py-1.5 text-left font-medium">时间</th>
                    <th className="px-2 py-1.5 text-right font-medium">数量</th>
                    <th className="px-2 py-1.5 text-right font-medium">金额</th>
                    <th className="px-2 py-1.5 text-left font-medium">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map(it => {
                    const biz = BIZ_MAP[it.itemType];
                    const isCheckup = it.itemType === 'checkup';
                    const paxList: any[] = (it.extra as any).paxList || [];
                    const hasContent = (() => {
                      switch (it.itemType) {
                        case 'checkup': return true; // 总有摘要/导出
                        case 'lodging': return true;
                        case 'breakfast': return true;
                        case 'lunch':
                        case 'dinner':
                          return Array.isArray(it.extra.sessions) && it.extra.sessions.length > 0;
                        case 'meeting':
                        case 'wellness':
                          return Array.isArray(it.extra.sessions) && it.extra.sessions.length > 0;
                        case 'carpickup':
                          return !!(it.extra as any).carpickup;
                        default: return false;
                      }
                    })();
                    const expanded = expandedItems.has(it.id);
                    // 计算快照合计金额（用于对比 item.amount 是否一致）
                    let snapTotal = 0;
                    paxList.forEach((p: any) => { if (typeof p.finalAmount === 'number') snapTotal += p.finalAmount; });
                    const displayAmount = snapTotal > 0 ? snapTotal : (it.amount || 0);

                    const savedPkgId = (it.extra as any)?.selectedChkPkgId;
                    // 注意：fromBackend 递归转换会把 female_married → femaleMarried
                    // 这里统一做一次归一化，把 camelCase key 转回 snake_case
                    const rawCounts = (it.extra as any)?.roleCounts;
                    const savedCounts = (() => {
                      if (!rawCounts) return undefined;
                      const norm: any = {};
                      for (const key of Object.keys(rawCounts)) {
                        // camelCase → snake_case：femaleMarried → female_married
                        const normalized = key.replace(/([A-Z])/g, (_m, c) => '_' + c.toLowerCase());
                        norm[normalized] = Number(rawCounts[key]) || 0;
                      }
                      // 兜底：如果转换后为空（理论上不会），直接用原值
                      if (!norm.female_married && !norm.female_single && !norm.male) {
                        norm.male = Number(rawCounts.male) || 0;
                        norm.female_married = Number(rawCounts.female_married ?? rawCounts.femaleMarried) || 0;
                        norm.female_single = Number(rawCounts.female_single ?? rawCounts.femaleSingle) || 0;
                      }
                      return norm as { male?: number; female_married?: number; female_single?: number };
                    })();
                    const firstPkg = savedPkgId || paxList.find((p: any) => p?.package)?.package || '';
                    const cap = capsuleMap[firstPkg] || null;
                    const packageName = friendlyCapsuleName(cap) || (firstPkg ? `套餐${firstPkg}` : '未设置');

                    const roleOrder: Array<'male' | 'female_married' | 'female_single'> = ['male', 'female_married', 'female_single'];
                    const importedCounts = roleOrder.reduce((acc, k) => { acc[k] = 0; return acc; }, {} as Record<string, number>);
                    const paxByRole: Record<string, any[]> = { male: [], female_married: [], female_single: [] };
                    paxList.forEach((p: any) => {
                      const r = paxToRole(p.gender, p.married);
                      importedCounts[r] = (importedCounts[r] || 0) + 1;
                      paxByRole[r].push(p);
                    });
                    const getPrice = (role: 'male' | 'female_married' | 'female_single') =>
                      Number(cap?.prices?.[role]?.discount_price || 0);
                    const prices = { male: getPrice('male'), female_married: getPrice('female_married'), female_single: getPrice('female_single') };
                    const hasRoleSetting = savedCounts && roleOrder.some(k => Number(savedCounts[k] || 0) > 0);
                    const roleTotal = roleOrder.reduce((s, k) => s + Number(savedCounts?.[k] || 0) * prices[k], 0);
                    const displayRoleTotal = roleTotal > 0 ? roleTotal : displayAmount;

                    return (
                      <>
                        <tr
                          key={it.id}
                          className={`border-t border-gray-200 ${hasContent ? 'cursor-pointer hover:bg-gray-50/60' : ''}`}
                          onClick={() => hasContent && toggleExpand(it.id)}
                        >
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <span style={{ color: biz.color }}>{biz.icon}</span>{' '}
                            <span className="text-gray-700">{biz.label}</span>
                            {hasContent && (
                              <ChevronDown
                                size={12}
                                className={`inline-block ml-1 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                              />
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-gray-600">{itemDateRange(it)}</td>
                          <td className="px-2 py-1.5 font-mono text-gray-600">
                            {it.startTime}
                            {it.endTime ? `-${it.endTime}` : ''}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-700">
                            {it.itemType === 'lunch' || it.itemType === 'dinner' ? (() => {
                              const sess = it.extra.sessions || [];
                              const tbl = sess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? 0 : (x.tables || 0)), 0);
                              const paxPp = sess.reduce((s: number, x: any) => s + (x.pricingMode === 'per_person' ? (x.pax || 0) : 0), 0);
                              if (tbl > 0) return `${tbl}桌`;
                              if (paxPp > 0) return `${paxPp}人`;
                              return `${it.pax}${biz.unit}`;
                            })() : (
                              <>
                                {it.pax}
                                {biz.unit}
                              </>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-700">
                            {displayAmount ? `¥${displayAmount.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-2 py-1.5 text-gray-500">{itemDetail(it) || '-'}</td>
                        </tr>
                        {/* 统一展开区：所有业务共用同一结构，高度上限内容内滚 */}
                        {hasContent && expanded && (
                          <tr key={`${it.id}_detail`} className="bg-gray-50/70 border-t-0">
                            <td colSpan={6} className="px-3 py-2">
                              <div className="max-h-[60vh] overflow-y-auto">
                                {/* ============= 体检：三块（摘要+名单导出+套餐查看/导出）============= */}
                                {isCheckup && (
                                  <div className="space-y-3">
                                    {/* 块1：三角色摘要（含设定/已导/待绑/角色胶囊姓名条）*/}
                                    <div className="p-3 bg-sky-50 rounded-lg border border-sky-100">
                                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-white border border-sky-200 text-sky-700">
                                            <ClipboardList size={11} /> 体检套餐
                                          </span>
                                          <span className="text-sm font-semibold text-gray-800 truncate">{packageName}</span>
                                          {capsulesLoading && <span className="text-[10px] text-gray-400">加载中…</span>}
                                        </div>
                                        <span className="text-xs font-mono text-green-700 font-semibold whitespace-nowrap">
                                          合计 ¥{displayRoleTotal.toLocaleString()}
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                                        {roleOrder.map(k => {
                                          const setN = Number(savedCounts?.[k] || 0);
                                          const importedN = importedCounts[k] || 0;
                                          const remain = hasRoleSetting ? Math.max(0, setN - importedN) : 0;
                                          const sub = (hasRoleSetting ? setN : importedN) * prices[k];
                                          const list = paxByRole[k] || [];
                                          return (
                                            <div key={k} className="bg-white border border-sky-100 rounded p-2">
                                              <div className="flex items-center justify-between mb-1">
                                                <span className="text-gray-700 font-medium">{ROLE_LABEL[k]}</span>
                                                <span className="text-gray-500 font-mono">¥{prices[k].toLocaleString()}/人</span>
                                              </div>
                                              <div className="grid grid-cols-3 gap-1 text-center font-mono">
                                                <div className="bg-gray-50 rounded px-1 py-0.5">
                                                  <div className="text-[9px] text-gray-400">设定</div>
                                                  <div className="text-gray-800">{hasRoleSetting ? setN : '-'}</div>
                                                </div>
                                                <div className="bg-gray-50 rounded px-1 py-0.5">
                                                  <div className="text-[9px] text-gray-400">已导</div>
                                                  <div className="text-gray-800">{importedN}</div>
                                                </div>
                                                <div className="bg-amber-50 rounded px-1 py-0.5">
                                                  <div className="text-[9px] text-amber-500">待绑</div>
                                                  <div className="text-amber-700">{remain}</div>
                                                </div>
                                              </div>
                                              {/* 姓名横滑清单（不占垂直空间）*/}
                                              {list.length > 0 && (
                                                <div className="mt-2 -mx-1 px-1">
                                                  <div className="flex gap-1 overflow-x-auto whitespace-nowrap pb-0.5">
                                                    {list.map((p, i) => (
                                                      <span
                                                        key={i}
                                                        title={`${p.name || ''}  ${p.gender || ''} · 身份证 ${p.idCard || ''} · 手机 ${p.phone || ''}`}
                                                        className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100"
                                                      >
                                                        {p.name || `第${i + 1}人`}
                                                      </span>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                              <div className="text-right mt-1 text-green-700 font-mono font-medium">
                                                小计 ¥{sub.toLocaleString()}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {/* 块2 & 块3：导出按钮组（名单 + 查看/导出套餐）*/}
                                    <div className="p-3 bg-white rounded-lg border border-gray-200">
                                      <div className="text-[11px] text-gray-500 mb-2 font-medium">数据导出 / 查看（导入体检系统使用）</div>
                                      <div className="flex flex-wrap gap-2 items-center">
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); exportCheckupPax(it, packageName); }}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 font-medium"
                                        >
                                          <Download size={12} /> 导出体检名单.xlsx
                                          <span className="text-[10px] ml-1 text-sky-500 bg-white px-1 rounded border border-sky-200">{paxList.length}人</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            viewCheckupPackage(cap?.id || firstPkg, cap, packageName);
                                          }}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium"
                                        >
                                          <FileText size={12} /> 查看体检套餐（三角色）
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // 直接导出 Excel：autoExport = true → 后台加载 → 自动下载并关闭 loading 层
                                            viewCheckupPackage(cap?.id || firstPkg, cap, packageName, { autoExport: true });
                                          }}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 font-medium"
                                        >
                                          <Download size={12} /> 导出体检套餐.xlsx
                                          <span className="text-[10px] ml-1 text-green-600 bg-white px-1 rounded border border-green-200">3角色</span>
                                        </button>
                                      </div>
                                      {/* 兜底提示：胶囊未加载时说明 */}
                                      {!cap && firstPkg && !capsulesLoading && (
                                        <div className="mt-2 text-[10px] text-amber-600">
                                          提示：未获取到 {firstPkg} 对应的销售胶囊，套餐查看/导出将以 pax 最终项目快照兜底（如有名单数据）。
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* ============= 住宿：入住详情 ============= */}
                                {it.itemType === 'lodging' && (
                                  <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                                    <div className="text-[11px] text-purple-600 font-semibold mb-2 flex items-center gap-1">
                                      <span>🛏</span> 住宿详情
                                    </div>
                                    <div className="bg-white rounded p-2.5 border border-purple-100">
                                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div><span className="text-gray-400">房型：</span><span className="font-medium text-gray-800">{roomName(it.extra.lodgingType || 'standard')}</span></div>
                                        <div><span className="text-gray-400">入住：</span><span className="font-mono text-gray-800">{it.extra.dateCheckIn || '-'} {it.extra.arrivalTime ? ` ${it.extra.arrivalTime}` : ''}</span></div>
                                        <div><span className="text-gray-400">间数：</span><span className="font-medium text-gray-800">{it.pax} 间</span></div>
                                        <div><span className="text-gray-400">离店：</span><span className="font-mono text-gray-800">{it.extra.dateCheckOut || '-'}（{it.extra.nights || 0}晚）</span></div>
                                        <div>
                                          <span className="text-gray-400">每间每晚：</span>
                                          {('customPrice' in it.extra && (it.extra as any).customPrice !== undefined) ? (
                                            <span className="font-mono text-gray-800">
                                              ¥{Number((it.extra as any).customPrice).toLocaleString()}
                                              <span className="text-[9px] text-purple-600 border border-purple-200 rounded px-1 ml-1">议价</span>
                                            </span>
                                          ) : (
                                            <span className="font-mono text-gray-800">
                                              ¥{Number(((bizCfg.roomTypes||[]).find((r:any)=>r.code===it.extra.lodgingType)?.price) || (LODGING_TYPES[it.extra.lodgingType as keyof typeof LODGING_TYPES]?.price) || 0).toLocaleString()}
                                            </span>
                                          )}
                                        </div>
                                        <div><span className="text-gray-400">小计：</span><span className="font-mono font-semibold text-green-700">¥{(it.amount||0).toLocaleString()}</span></div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* ============= 早餐（派生）============= */}
                                {it.itemType === 'breakfast' && (
                                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                                    <div className="text-[11px] text-amber-600 font-semibold mb-2 flex items-center gap-1">
                                      <span>🌅</span> 早餐（派生业务）
                                    </div>
                                    <div className="bg-white rounded p-2.5 border border-amber-100 text-[11px]">
                                      <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="bg-gray-50 rounded py-1.5">
                                          <div className="text-gray-400 text-[10px]">来源-体检</div>
                                          <div className="font-mono text-gray-800 text-sm font-semibold">{(it.extra as any).source?.checkup ?? 0} 人</div>
                                        </div>
                                        <div className="bg-gray-50 rounded py-1.5">
                                          <div className="text-gray-400 text-[10px]">来源-住宿</div>
                                          <div className="font-mono text-gray-800 text-sm font-semibold">{(it.extra as any).source?.lodging ?? 0} 间</div>
                                        </div>
                                        <div className="bg-green-50 rounded py-1.5">
                                          <div className="text-green-600 text-[10px]">合计金额</div>
                                          <div className="font-mono text-green-700 text-sm font-semibold">¥{(it.amount||0).toLocaleString()}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* ============= 午餐 / 晚餐 ============= */}
                                {(it.itemType === 'lunch' || it.itemType === 'dinner') && (
                                  <div className={`p-3 rounded-lg border ${it.itemType === 'lunch' ? 'bg-red-50 border-red-100' : 'bg-pink-50 border-pink-100'}`}>
                                    <div className={`text-[11px] font-semibold mb-2 flex items-center gap-1 ${it.itemType === 'lunch' ? 'text-red-600' : 'text-pink-600'}`}>
                                      <span>{it.itemType === 'lunch' ? '🍽' : '🌙'}</span> {BIZ_MAP[it.itemType].label}场次明细
                                    </div>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-[11px] bg-white rounded border border-gray-100">
                                        <thead className="bg-gray-50 text-gray-500">
                                          <tr>
                                            <th className="px-2 py-1 text-left">#</th>
                                            <th className="px-2 py-1 text-left">日期</th>
                                            <th className="px-2 py-1 text-left">时间</th>
                                            <th className="px-2 py-1 text-left">用餐标准</th>
                                            <th className="px-2 py-1 text-left">计费</th>
                                            <th className="px-2 py-1 text-right">数量</th>
                                            <th className="px-2 py-1 text-right">单价</th>
                                            <th className="px-2 py-1 text-right">小计</th>
                                            <th className="px-2 py-1 text-left">备注</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(it.extra.sessions as any[] || []).map((s, i) => {
                                            const isPerTable = s.pricingMode === 'per_table';
                                            const qtyLabel = isPerTable ? `${s.tables || 0}桌 × ${s.perTable || 0}人/桌` : `${s.pax || 0}人`;
                                            const sub = isPerTable
                                              ? Number(s.tables || 0) * Number(s.unitPrice || 0)
                                              : Number(s.pax || 0) * Number(s.unitPrice || 0);
                                            return (
                                              <tr key={i} className="border-t border-gray-50">
                                                <td className="px-2 py-1 text-gray-400 font-mono">{i + 1}</td>
                                                <td className="px-2 py-1 font-mono text-gray-700">{s.date || '-'}</td>
                                                <td className="px-2 py-1 font-mono text-gray-700">{s.time || '-'}</td>
                                                <td className="px-2 py-1 text-gray-800 font-medium">{mealName(s.mealType)}</td>
                                                <td className="px-2 py-1 text-gray-500">{isPerTable ? '按桌' : '按人'}</td>
                                                <td className="px-2 py-1 text-right text-gray-700">{qtyLabel}</td>
                                                <td className="px-2 py-1 text-right font-mono text-gray-600">¥{Number(s.unitPrice||0).toLocaleString()}</td>
                                                <td className="px-2 py-1 text-right font-mono text-green-700">¥{sub.toLocaleString()}</td>
                                                <td className="px-2 py-1 text-gray-500">{s.remark || '-'}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                        <tfoot>
                                          <tr className="bg-gray-50 border-t border-gray-100">
                                            <td colSpan={7} className="px-2 py-1 text-right text-gray-500">合计</td>
                                            <td className="px-2 py-1 text-right font-mono font-semibold text-green-700">¥{(it.amount||0).toLocaleString()}</td>
                                            <td></td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {/* ============= 会务 ============= */}
                                {it.itemType === 'meeting' && (
                                  <div className="p-3 bg-teal-50 rounded-lg border border-teal-100">
                                    <div className="text-[11px] text-teal-600 font-semibold mb-2 flex items-center gap-1">
                                      <span>📊</span> 会议场次明细
                                    </div>
                                    <table className="w-full text-[11px] bg-white rounded border border-gray-100">
                                      <thead className="bg-gray-50 text-gray-500">
                                        <tr>
                                          <th className="px-2 py-1 text-left">#</th>
                                          <th className="px-2 py-1 text-left">日期</th>
                                          <th className="px-2 py-1 text-left">时段</th>
                                          <th className="px-2 py-1 text-left">会议室</th>
                                          <th className="px-2 py-1 text-center">场型</th>
                                          <th className="px-2 py-1 text-right">人数</th>
                                          <th className="px-2 py-1 text-right">单价</th>
                                          <th className="px-2 py-1 text-right">小计</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(it.extra.sessions as any[] || []).map((s, i) => {
                                          const row = (bizCfg.meetingHalls || []).find((r: any) => r.code === s.hall);
                                          const unitPrice = s.slotType === 'full'
                                            ? Number(row?.full_price || (MEETING_HALLS[s.hall as keyof typeof MEETING_HALLS]?.fullPrice) || 0)
                                            : Number(row?.half_price || (MEETING_HALLS[s.hall as keyof typeof MEETING_HALLS]?.halfPrice) || 0);
                                          return (
                                            <tr key={i} className="border-t border-gray-50">
                                              <td className="px-2 py-1 text-gray-400 font-mono">{i + 1}</td>
                                              <td className="px-2 py-1 font-mono text-gray-700">{s.date || '-'}</td>
                                              <td className="px-2 py-1 font-mono text-gray-700">{s.startTime || '-'}</td>
                                              <td className="px-2 py-1 text-gray-800 font-medium">{hallName(s.hall)}</td>
                                              <td className="px-2 py-1 text-center text-gray-500">{s.slotType === 'full' ? '全天' : '半天'}</td>
                                              <td className="px-2 py-1 text-right text-gray-700">{s.pax || 0}</td>
                                              <td className="px-2 py-1 text-right font-mono text-gray-600">¥{unitPrice.toLocaleString()}</td>
                                              <td className="px-2 py-1 text-right font-mono text-green-700">¥{unitPrice.toLocaleString()}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                      <tfoot>
                                        <tr className="bg-gray-50 border-t border-gray-100">
                                          <td colSpan={7} className="px-2 py-1 text-right text-gray-500">合计</td>
                                          <td className="px-2 py-1 text-right font-mono font-semibold text-green-700">¥{(it.amount||0).toLocaleString()}</td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                )}

                                {/* ============= 康乐 ============= */}
                                {it.itemType === 'wellness' && (
                                  <div className="p-3 bg-lime-50 rounded-lg border border-lime-100">
                                    <div className="text-[11px] text-lime-700 font-semibold mb-2 flex items-center gap-1">
                                      <span>🎯</span> 康乐场次明细
                                    </div>
                                    <table className="w-full text-[11px] bg-white rounded border border-gray-100">
                                      <thead className="bg-gray-50 text-gray-500">
                                        <tr>
                                          <th className="px-2 py-1 text-left">#</th>
                                          <th className="px-2 py-1 text-left">日期</th>
                                          <th className="px-2 py-1 text-left">时间</th>
                                          <th className="px-2 py-1 text-left">康乐项目</th>
                                          <th className="px-2 py-1 text-right">时长</th>
                                          <th className="px-2 py-1 text-right">人数</th>
                                          <th className="px-2 py-1 text-right">单价</th>
                                          <th className="px-2 py-1 text-right">小计</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(it.extra.sessions as any[] || []).map((s, i) => {
                                          const forGuest = !!order.items.some(x => x.itemType === 'lodging');
                                          const p = wellnessPrice(s.wellnessType, forGuest);
                                          const mode = (bizCfg.wellnessTypes || []).find((r: any) => r.code === s.wellnessType)?.pricing_mode
                                            || (WELLNESS_TYPES[s.wellnessType as keyof typeof WELLNESS_TYPES]?.pricingMode) || 'per_hour';
                                          const unit = Number(s.hours || 0);
                                          const unitPrice = mode === 'package' ? p : (p * unit);
                                          const qty = Number(s.pax || 1);
                                          const sub = unitPrice * qty;
                                          return (
                                            <tr key={i} className="border-t border-gray-50">
                                              <td className="px-2 py-1 text-gray-400 font-mono">{i + 1}</td>
                                              <td className="px-2 py-1 font-mono text-gray-700">{s.date || '-'}</td>
                                              <td className="px-2 py-1 font-mono text-gray-700">{s.startTime || '-'}</td>
                                              <td className="px-2 py-1 text-gray-800 font-medium">{wellnessName(s.wellnessType)}</td>
                                              <td className="px-2 py-1 text-right text-gray-700">{unit}h</td>
                                              <td className="px-2 py-1 text-right text-gray-700">{qty}</td>
                                              <td className="px-2 py-1 text-right font-mono text-gray-600">
                                                ¥{unitPrice.toLocaleString()}
                                                {forGuest && <span className="text-[9px] text-lime-600 ml-1">住客</span>}
                                              </td>
                                              <td className="px-2 py-1 text-right font-mono text-green-700">¥{sub.toLocaleString()}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                      <tfoot>
                                        <tr className="bg-gray-50 border-t border-gray-100">
                                          <td colSpan={7} className="px-2 py-1 text-right text-gray-500">合计</td>
                                          <td className="px-2 py-1 text-right font-mono font-semibold text-green-700">¥{(it.amount||0).toLocaleString()}</td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                )}

                                {/* ============= 用车 ============= */}
                                {it.itemType === 'carpickup' && (
                                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <div className="text-[11px] text-gray-600 font-semibold mb-2 flex items-center gap-1">
                                      <span>🚗</span> 用车详情
                                    </div>
                                    {(() => {
                                      const c = (it.extra as any).carpickup;
                                      if (!c) return <div className="text-[11px] text-gray-400">无详情</div>;
                                      const customers: any[] = c.customers || [];
                                      const total = c.customAmount ?? customers.length * Number(c.pricePerCustomer || 0);
                                      return (
                                        <div className="space-y-2">
                                          <div className="flex items-center justify-between bg-white rounded p-2.5 border border-gray-100 text-[11px]">
                                            <div className="flex items-center gap-3">
                                              <span className={`px-2 py-0.5 rounded ${c.shareRide ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-sky-50 text-sky-700 border border-sky-100'}`}>
                                                {c.shareRide ? '拼车' : '专车'}
                                              </span>
                                              <span className="text-gray-500">客户数 <span className="font-mono text-gray-800">{customers.length}</span> 位</span>
                                              <span className="text-gray-500">单价 <span className="font-mono text-gray-800">¥{Number(c.pricePerCustomer||0).toLocaleString()}/客户</span></span>
                                              {c.customAmount !== undefined && (
                                                <span className="text-[10px] text-purple-600 border border-purple-200 rounded px-1">议价覆盖</span>
                                              )}
                                            </div>
                                            <span className="font-mono font-semibold text-green-700">¥{Number(total||0).toLocaleString()}</span>
                                          </div>
                                          <div className="space-y-1.5">
                                            {customers.map((cu, i) => (
                                              <div key={i} className="bg-white rounded p-2.5 border border-gray-100">
                                                <div className="flex items-center justify-between mb-1 text-[11px]">
                                                  <span className="font-semibold text-gray-800">客户 {i + 1}: {cu.contactName || '-'}</span>
                                                  <span className="text-gray-500">
                                                    {cu.contactPhone}{cu.paxCount ? ` · ${cu.paxCount}人` : ''}
                                                  </span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                                                  <div className="bg-lime-50 rounded px-2 py-1">
                                                    <div className="text-lime-600 font-medium mb-0.5">接 · {cu.pickupDate || '-'} {cu.pickupTime || ''}</div>
                                                    <div className="text-gray-600 whitespace-pre-wrap leading-snug">{cu.pickupRoute || '-'}</div>
                                                  </div>
                                                  <div className="bg-rose-50 rounded px-2 py-1">
                                                    <div className="text-rose-600 font-medium mb-0.5">送 · {cu.dropoffDate || '-'} {cu.dropoffTime || ''}</div>
                                                    <div className="text-gray-600 whitespace-pre-wrap leading-snug">{cu.dropoffRoute || '-'}</div>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                          {c.remark && <div className="text-[11px] text-gray-500 bg-white rounded p-2 border border-gray-100">备注：{c.remark}</div>}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                )}
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
          </div>

          {/* 金额 */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <div className="text-xs text-gray-500">订单总额</div>
            <div className="text-lg font-bold font-mono text-gray-900">
              ¥{total.toLocaleString()}
            </div>
          </div>

          {/* 备注 */}
          {order.remark && (
            <div>
              <div className="text-[11px] text-gray-500">备注</div>
              <div className="text-xs text-gray-700 bg-gray-50 rounded p-2">{order.remark}</div>
            </div>
          )}
        </div>

        {/* ===== 体检套餐查看：内嵌 Sub-Modal（同尺寸类），不要 PDF ===== */}
        {viewingPkg && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/40 rounded-lg"
            onClick={(e) => { e.stopPropagation(); /* 点击遮罩关闭 */ setViewingPkg(null); }}
          >
            <div
              className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 头部（与订单弹窗结构完全一致，保证观感统一）*/}
              <div className="flex items-start justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-500">体检套餐详情（内嵌查看）</div>
                  <div className="text-base font-bold text-gray-900 truncate">
                    {viewingPkg.capId && capsuleMap[viewingPkg.capId]
                      ? friendlyCapsuleName(capsuleMap[viewingPkg.capId])
                      : (viewingPkg.capId || '体检套餐')}
                    <span className="ml-2 text-[10px] text-gray-400 font-normal">订单 {order.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); exportCheckupPackageExcel(); }}
                    disabled={!viewingPkg.sheets}
                    className="px-2.5 py-1 text-[11px] rounded bg-green-500 hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed font-medium inline-flex items-center gap-1"
                  >
                    <Download size={12} /> 导出三角色 Excel
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setViewingPkg(null); }}
                    className="text-gray-400 hover:text-gray-600 p-1"
                    aria-label="关闭"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="px-5 py-3 space-y-3">
                {viewingPkg.loading && (
                  <div className="text-[11px] text-gray-500">正在加载三角色项目清单…</div>
                )}
                {viewingPkg.error && !viewingPkg.loading && (
                  <div className="p-3 rounded bg-red-50 border border-red-100 text-[11px] text-red-600">
                    {viewingPkg.error}。您仍可点击「导出三角色Excel」获取已有数据。
                  </div>
                )}
                {viewingPkg.sheets && viewingPkg.sheets.map((sh: any, i: number) => {
                  const rawTotal = sh.items.reduce((s: number, it: any) => s + it.price * it.qty, 0);
                  return (
                    <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className={`flex items-center justify-between px-3 py-1.5 ${
                        sh.role === 'male' ? 'bg-blue-50 border-b border-blue-100'
                        : sh.role === 'female_married' ? 'bg-pink-50 border-b border-pink-100'
                        : 'bg-purple-50 border-b border-purple-100'
                      }`}>
                        <div className="font-semibold text-xs">
                          {sh.role === 'male' ? '👨' : sh.role === 'female_married' ? '👩‍💍' : '👩'} {sh.label}
                          <span className="ml-2 text-[10px] text-gray-500 font-normal">共 {sh.items.length} 项</span>
                        </div>
                        <div className="text-[11px] text-right">
                          <div className="text-gray-500">原价合计 <span className="font-mono text-gray-700">¥{rawTotal.toLocaleString()}</span></div>
                          <div className="font-mono font-semibold text-green-700">折扣合计 ¥{Number(sh.discountPrice||0).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="overflow-x-auto max-h-[50vh]">
                        <table className="w-full text-[11px]">
                          <thead className="bg-gray-50 text-gray-500 sticky top-0 z-[1]">
                            <tr>
                              <th className="px-2 py-1 text-left w-10">#</th>
                              <th className="px-2 py-1 text-left w-24">分类</th>
                              <th className="px-2 py-1 text-left">项目</th>
                              <th className="px-2 py-1 text-right w-20">单价</th>
                              <th className="px-2 py-1 text-center w-14">数量</th>
                              <th className="px-2 py-1 text-right w-20">小计</th>
                              <th className="px-2 py-1 text-left">备注</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sh.items.length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-2 py-3 text-center text-gray-400 text-[11px]">暂无项目</td>
                              </tr>
                            )}
                            {sh.items.map((it: any, idx: number) => (
                              <tr key={idx} className="border-t border-gray-50">
                                <td className="px-2 py-1 text-gray-400 font-mono">{idx + 1}</td>
                                <td className="px-2 py-1 text-gray-500">{it.category}</td>
                                <td className="px-2 py-1 text-gray-800">{it.name}</td>
                                <td className="px-2 py-1 text-right font-mono text-gray-600">¥{Number(it.price||0).toLocaleString()}</td>
                                <td className="px-2 py-1 text-center text-gray-700">{it.qty}</td>
                                <td className="px-2 py-1 text-right font-mono text-gray-700">
                                  ¥{Math.round(Number(it.price||0) * Number(it.qty||0) * 100) / 100}
                                </td>
                                <td className="px-2 py-1 text-gray-500">{it.remark || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white">
          {canOperate && (
            <>
              <button
                type="button"
                onClick={onCopy}
                className="px-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              >
                复制为新单
              </button>
              <button
                type="button"
                onClick={() => onSetTemplate(order.id, order.customerName || '')}
                className="px-3 py-1.5 text-xs rounded border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 font-medium flex items-center gap-1"
              >
                <Star size={12} /> 设为模板
              </button>
            </>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 text-xs rounded bg-green-500 hover:bg-green-600 text-white font-medium"
            >
              修改此单
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================
// 主页面
// ================================================
export default function BookingBoard() {
  const toast = useToast();
  const [orders, setOrders] = useState<BookingOrder[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [bizFilter, setBizFilter] = useState<Set<BizType>>(() => new Set(ALL_BIZ));
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set(ALL_STATUS));
  const [selectedOrder, setSelectedOrder] = useState<BookingOrder | null>(null);
  const [mobileDate, setMobileDate] = useState<string>(() => todayStr());
  const [createDrawer, setCreateDrawer] = useState<null | { mode: 'create' | 'edit' | 'copy'; order?: BookingOrder }>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  // 新建下拉菜单
  const [showNewMenu, setShowNewMenu] = useState(false);
  // 从模板创建弹窗
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  // 设为模板弹窗
  const [showSetTemplate, setShowSetTemplate] = useState<null | string>(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  // 通用确认弹窗（替代原生 confirm）
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  // orderNo → backend UUID 映射（编辑/状态操作时需要 UUID 调后端）
  const orderUuidMap = useRef<Record<string, string>>({});
  // 业务常量配置弹窗
  const [bizConfigOpen, setBizConfigOpen] = useState(false);

  // 权限：仅 admin / booker 可执行写操作（新建/编辑/复制/导入/模板等），其他角色仅查看
  const authUser = useAuthStore(s => s.user);
  const isBookingOperator = (() => {
    if (!authUser) return false;
    const role = authUser.role;
    const roles = authUser.roles || [];
    // roles 可能是字符串数组或对象数组
    const roleCodes = roles.map((r: any) => (typeof r === 'string' ? r : r?.code)).filter(Boolean);
    return role === 'admin' || role === 'booker' || roleCodes.includes('admin') || roleCodes.includes('booker');
  })();

  // 统一的加载订单函数（切周 / 修复数据后刷新都复用）
  const loadOrders = useCallback(async (ws?: Date) => {
    const start = ws || weekStart;
    const weekStartStr = fmt(start);
    try {
      const { data } = await bookingApi.getOrders({ weekStart: weekStartStr });
      const map: Record<string, string> = {};
      const adapted = data.map(apiOrder => {
        const displayId = apiOrder.orderNo || apiOrder.id;
        map[displayId] = apiOrder.id;
        return adaptOrder(apiOrder);
      });
      orderUuidMap.current = map;
      setOrders(adapted);
    } catch (e) {
      console.error('[BookingBoard] 加载订单失败:', e);
      setOrders([]);
    }
  }, [weekStart]);

  // 切换周时从后端加载订单数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadOrders(weekStart);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    setMobileDate(fmt(weekStart));
    return () => { cancelled = true; };
  }, [weekStart, loadOrders]);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const todayKey = todayStr();

  // 画板数据：每个业务一行
  const boardData = useMemo(() => {
    const byBiz: Record<BizType, BoardCard[]> = {} as Record<BizType, BoardCard[]>;
    for (const biz of ALL_BIZ) byBiz[biz] = [];

    const flat = flattenItems(orders, bizFilter, statusFilter);
    for (const biz of ALL_BIZ) {
      const bizFlat = flat.filter(f => f.item.itemType === biz);
      const merged = mergeConsecutiveItems(bizFlat, weekDates);
      const tracked = assignTracks(merged);
      byBiz[biz] = tracked.map(t => ({
        item: t.items[0].item,
        group: t.items[0].group,
        startCol: t.startCol,
        endCol: t.endCol,
        track: t.track,
        isMerged: t.items.length > 1 && t.endCol > t.startCol,
        flatItems: t.items,
      }));
    }
    return byBiz;
  }, [orders, bizFilter, statusFilter, weekDates]);

  // 识别待完善草稿（没有任何 items 的 pending 订单）
  const draftOrders = useMemo(() => {
    return orders.filter(o =>
      o.status === 'pending' &&
      (!o.items || o.items.length === 0)
    );
  }, [orders]);

  // 加载模板列表（加载完模板后自动刷新一次订单列表，确保后端自动修复后的历史订单立即回显）
  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const list = await bookingApi.getTemplates();
      setTemplates(list);
      // 后端在 GET /templates 里会自动修复 is_template=1 的历史数据 → 需要刷新订单看到
      await loadOrders();
    } catch (e) {
      console.error('加载模板失败:', e);
    } finally {
      setTplLoading(false);
    }
  }, [loadOrders]);

  // 应用模板创建新单
  const handleApplyTemplate = (tpl: any) => {
    setConfirmDialog({
      open: true,
      title: '从模板创建订单',
      message: `确定从模板「${tpl.templateName || '未命名模板'}」创建订单吗？\n\n日期会自动偏移到本周。`,
      confirmText: '创建',
      cancelText: '取消',
      confirmColor: 'green',
      onConfirm: async () => {
        try {
          const created = await bookingApi.applyTemplate(tpl.id);
          const adapted = adaptOrder(created);
          orderUuidMap.current[adapted.id] = created.id;
          setOrders(prev => [...prev, adapted]);
          setShowTemplatePicker(false);
          // 直接进入编辑模式
          setCreateDrawer({ mode: 'edit', order: adapted });
        } catch (e) {
          toast.error('创建失败: ' + (e as Error).message);
        }
      },
    });
  };

  // 确认设为模板（克隆模式：原订单不变，生成副本为模板）
  const handleConfirmSetTemplate = async () => {
    const orderId = showSetTemplate;
    const name = templateNameInput.trim();
    if (!orderId || !name) { toast.error('请输入模板名称'); return; }
    try {
      await bookingApi.setTemplate(orderUuidMap.current[orderId] || orderId, name);
      toast.success('已生成模板副本，原订单仍保留在订单列表中');
      setShowSetTemplate(null);
      setTemplateNameInput('');
      await loadTemplates(); // 仅刷新模板列表（订单还在，不需要刷新订单列表）
    } catch (e) {
      toast.error('设置失败: ' + (e as Error).message);
    }
  };

  // 删除模板副本（不影响来源订单本身）
  const handleUnsetTemplate = (tplId: string) => {
    setConfirmDialog({
      open: true,
      title: '删除模板副本',
      message: '确定删除该模板？\n\n⚠️ 仅删除模板副本，不影响来源的普通订单本身。',
      confirmText: '删除模板',
      cancelText: '取消',
      confirmColor: 'red',
      onConfirm: async () => {
        try {
          await bookingApi.unsetTemplate(tplId);
          toast.success('模板已删除');
          await loadTemplates();
        } catch (e) {
          toast.error('操作失败: ' + (e as Error).message);
        }
      },
    });
  };

  // 统计卡片
  const stats = useMemo(() => {
    const total = orders.length;
    const pending = orders.filter(o => o.status === 'pending').length;
    const reviewing = orders.filter(o => o.status === 'reviewing').length;
    const confirmed = orders.filter(o => o.status === 'confirmed').length;
    const amount = orders.reduce((s, o) => s + groupTotal(o), 0);
    return { total, pending, reviewing, confirmed, amount };
  }, [orders]);

  // 每日订单数（用于表头）
  const dayOrderCount = useMemo(() => {
    const counts: Record<string, number> = {};
    weekDates.forEach(d => { counts[fmt(d)] = 0; });
    for (const o of orders) {
      const touched = new Set<string>();
      o.items.forEach(it => getItemDateRange(it).dates.forEach(d => touched.add(d)));
      touched.forEach(d => { if (counts[d] !== undefined) counts[d]++; });
    }
    return counts;
  }, [orders, weekDates]);

  const statCards = useMemo(
    () => [
      { label: '总订单数', value: String(stats.total), color: '#1a5c3a' },
      { label: '待确认', value: String(stats.pending), color: STATUS_MAP.pending.color },
      { label: '待审核', value: String(stats.reviewing), color: STATUS_MAP.reviewing.color },
      { label: '已确认', value: String(stats.confirmed), color: STATUS_MAP.confirmed.color },
      { label: '总金额', value: `¥${stats.amount.toLocaleString()}`, color: '#1a5c3a' },
    ],
    [stats],
  );

  // 移动端当天的卡片（按业务分组）
  const mobileDayGroups = useMemo(() => {
    return BUSINESS.map(biz => {
      const cards = boardData[biz.type].filter(c => c.flatItems.some(fi => fi.date === mobileDate));
      return { biz, cards };
    }).filter(g => g.cards.length > 0);
  }, [boardData, mobileDate]);

  // 操作
  const goPrevWeek = useCallback(() => setWeekStart(s => addDays(s, -7)), []);
  const goNextWeek = useCallback(() => setWeekStart(s => addDays(s, 7)), []);
  const goToday = useCallback(() => setWeekStart(getWeekStart(new Date())), []);

  // 前端 BookingOrder → 后端 payload（payment → paymentMethod）
  function toPayload(order: BookingOrder) {
    return {
      customerName: order.customerName,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      salesPerson: order.salesPerson,
      salesPersonId: order.salesPersonId,
      paymentMethod: order.payment,
      remark: order.remark,
      items: order.items,
    };
  }

  // 保存订单（新建/编辑/复制）
  const handleSave = useCallback(async (newOrder: BookingOrder) => {
    setSaving(true);
    try {
      if (createDrawer?.mode === 'edit' && createDrawer.order) {
        const uuid = orderUuidMap.current[createDrawer.order.id];
        if (!uuid) throw new Error('找不到订单UUID，请刷新后重试');
        const updated = await bookingApi.updateOrder(uuid, toPayload(newOrder));
        const adapted = adaptOrder(updated);
        orderUuidMap.current[adapted.id] = updated.id;
        setOrders(prev => prev.map(o => o.id === createDrawer.order!.id ? adapted : o));
      } else {
        // create 或 copy 都走新建
        const created = await bookingApi.createOrder(toPayload(newOrder));
        const adapted = adaptOrder(created);
        orderUuidMap.current[adapted.id] = created.id;
        setOrders(prev => [...prev, adapted]);
      }
      // 成功后由 Create.tsx 调用 onClose 关闭抽屉
    } catch (e) {
      console.error('[BookingBoard] 保存失败:', e);
      toast.error('保存失败: ' + (e as Error).message);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [createDrawer]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
        {/* ============ 顶部栏 ============ */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">预订调度画板</h1>
            <div className="text-xs text-gray-500 mt-0.5">康养中心 · 7天预订调度</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={goPrevWeek}
              className="p-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              aria-label="上一周"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="px-3 py-1.5 text-sm bg-white rounded border border-gray-200 text-gray-800 font-mono min-w-[180px] text-center">
              {formatWeekRange(weekStart)}
            </div>
            <button
              type="button"
              onClick={goNextWeek}
              className="p-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              aria-label="下一周"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="px-3 py-1.5 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-1"
            >
              <Calendar size={12} /> 今天
            </button>
            {isBookingOperator && (
              <>
                <button
                  type="button"
                  onClick={() => setBizConfigOpen(true)}
                  className="px-3 py-1.5 text-xs rounded border border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100 font-medium flex items-center gap-1"
                >
                  <Settings size={12} /> 业务配置
                </button>
                <a
                  href="/templates/预订订单导入模板.xlsx"
                  download="预订订单导入模板.xlsx"
                  className="px-3 py-1.5 text-xs rounded border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium flex items-center gap-1"
                >
                  <Download size={12} /> 下载模板
                </a>
                <button
                  type="button"
                  onClick={() => setShowImport(true)}
                  className="px-3 py-1.5 text-xs rounded border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100 font-medium flex items-center gap-1"
                >
                  <Upload size={12} /> 导入Excel
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowNewMenu(s => !s)}
                    className="px-3 py-1.5 text-xs rounded bg-green-500 hover:bg-green-600 text-white font-medium flex items-center gap-1 shadow-sm"
                  >
                    <Plus size={12} /> 新建订单 <ChevronDown size={12} />
                  </button>
                  {showNewMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowNewMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-1 overflow-hidden">
                        <button
                          onClick={() => { setShowNewMenu(false); setCreateDrawer({ mode: 'create' }); }}
                          className="w-full px-4 py-2 text-xs text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <FileText size={14} className="text-gray-500" /> 空白新建
                        </button>
                        <div className="border-t border-gray-100 my-1" />
                        <button
                          onClick={() => {
                            setShowNewMenu(false);
                            setShowTemplatePicker(true);
                            loadTemplates();
                          }}
                          className="w-full px-4 py-2 text-xs text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Star size={14} className="text-yellow-500" /> 从模板创建
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ============ 待完善草稿卡片区 ============ */}
        {draftOrders.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={16} className="text-amber-600" />
              <span className="text-sm font-medium text-amber-800">待完善草稿（{draftOrders.length}）</span>
              <span className="text-xs text-amber-600">—— 这些订单没有业务项目，因此不会出现在画板日历中</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {draftOrders.map(o => (
                <div
                  key={o.id}
                  className="bg-white rounded-lg border border-amber-200 p-3 hover:shadow-md hover:border-amber-400 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => isBookingOperator ? setCreateDrawer({ mode: 'edit', order: o }) : setSelectedOrder(o)}
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">{o.id}</div>
                      <div className="text-xs text-gray-600 font-medium mt-0.5 truncate">👥 {o.customerName || '（未填客户名）'}</div>
                      <div className="text-[11px] text-gray-400 mt-1 truncate">
                        {o.salesPerson ? `销售：${o.salesPerson}` : '未填销售'} · {o.createdAt?.slice(0, 10) || '今天'}
                      </div>
                    </div>
                    {isBookingOperator && (
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        <button
                          type="button"
                          title="编辑草稿"
                          onClick={(e) => { e.stopPropagation(); setCreateDrawer({ mode: 'edit', order: o }); }}
                          className="p-1 rounded text-amber-500 hover:bg-amber-100"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          title="删除草稿"
                          onClick={(e) => {
                            e.stopPropagation();
                            const orderId = o.id;
                            const uuid = orderUuidMap.current[orderId] || orderId;
                            setConfirmDialog({
                              open: true,
                              title: '删除草稿订单',
                              message: `确定删除草稿「${orderId}」吗？\n客户：${o.customerName || '（未填客户名）'}\n\n⚠️ 删除后不可恢复。`,
                              confirmText: '确定删除',
                              cancelText: '取消',
                              confirmColor: 'red',
                              onConfirm: async () => {
                                try {
                                  await bookingApi.deleteOrder(uuid);
                                  setOrders(prev => prev.filter(x => x.id !== orderId));
                                } catch (err) {
                                  toast.error('删除失败: ' + (err as Error).message);
                                }
                              },
                            });
                          }}
                          className="p-1 rounded text-gray-400 hover:bg-red-100 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============ 统计卡片 ============ */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          {statCards.map((c, i) => (
            <div
              key={i}
              className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
              style={{ borderLeft: `4px solid ${c.color}` }}
            >
              <div className="text-sm text-gray-500">{c.label}</div>
              <div className="text-2xl font-bold font-mono text-gray-900 mt-1 truncate">
                {c.value}
              </div>
            </div>
          ))}
        </div>

        {/* ============ 筛选栏 ============ */}
        <div className="bg-white rounded-lg p-4 border border-gray-200 mb-5 space-y-3 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-600 w-12 font-medium">业务</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {BUSINESS.map(biz => {
                const active = bizFilter.has(biz.type);
                return (
                  <button
                    key={biz.type}
                    type="button"
                    onClick={() => setBizFilter(s => toggleInSet(s, biz.type))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border-2 transition-all ${
                      active
                        ? 'text-white border-transparent shadow-sm'
                        : 'text-gray-600 border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                    style={active ? { background: biz.color, borderColor: biz.color } : undefined}
                  >
                    <span>{biz.icon}</span>
                    <span>{biz.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-600 w-12 font-medium">状态</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ALL_STATUS.map(st => {
                const cfg = STATUS_MAP[st];
                const active = statusFilter.has(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(s => toggleInSet(s, st))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all ${
                      active
                        ? 'text-white border-transparent shadow-sm'
                        : 'text-gray-600 border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                    style={active ? { background: cfg.color, borderColor: cfg.color } : undefined}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ============ 甘特画板（桌面端 ≥980px） ============ */}
        <div className="hidden min-[980px]:block">
          {loading && (
            <div className="text-center text-gray-500 text-sm py-6 bg-white rounded-lg border border-gray-200 mb-3">
              <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
              加载中...
            </div>
          )}
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <div className="min-w-[1110px]">
              {/* 表头 */}
              <div className="flex bg-white border-b-2 border-gray-200">
                <div className="w-[200px] flex-shrink-0 sticky left-0 z-30 bg-white px-4 py-3 border-r border-gray-200">
                  <div className="text-xs font-medium text-gray-600">业务 / 日期</div>
                </div>
                <div
                  className="grid flex-1"
                  style={{ gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))' }}
                >
                  {weekDates.map((d, i) => {
                    const ds = fmt(d);
                    const isToday = ds === todayKey;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <div
                        key={i}
                        className="px-2 py-3 text-center border-r border-gray-200"
                        style={{ background: isToday ? '#ecfdf5' : 'transparent' }}
                      >
                        <div className="text-xs text-gray-500 font-medium">
                          {WEEKDAY_LABELS[d.getDay()]}
                        </div>
                        <div
                          className={`text-base font-mono font-bold mt-0.5 ${
                            isToday
                              ? 'text-green-600'
                              : isWeekend
                                ? 'text-gray-500'
                                : 'text-gray-800'
                          }`}
                        >
                          {d.getMonth() + 1}/{d.getDate()}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5 font-medium">{dayOrderCount[ds] || 0} 单</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 业务行 */}
              {BUSINESS.map(biz => (
                <BizRow
                  key={biz.type}
                  biz={biz}
                  cards={boardData[biz.type]}
                  weekDates={weekDates}
                  todayKey={todayKey}
                  onCardClick={setSelectedOrder}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ============ 移动端列表（<980px） ============ */}
        <div className="block min-[980px]:hidden">
          {/* 日期选择器 */}
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
            {weekDates.map((d, i) => {
              const ds = fmt(d);
              const selected = mobileDate === ds;
              const isToday = ds === todayKey;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMobileDate(ds)}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg border text-center min-w-[64px] ${
                    selected
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="text-[10px] text-gray-500">{WEEKDAY_LABELS[d.getDay()]}</div>
                  <div
                    className={`text-sm font-mono ${
                      isToday ? 'text-green-600 font-bold' : 'text-gray-700'
                    }`}
                  >
                    {d.getMonth() + 1}/{d.getDate()}
                  </div>
                  <div className="text-[10px] text-gray-500">{dayOrderCount[ds] || 0}单</div>
                </button>
              );
            })}
          </div>

          {/* 按业务分组的列表 */}
          {mobileDayGroups.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-10 bg-white rounded-lg border border-gray-200">
              当日暂无预订
            </div>
          ) : (
            <div className="space-y-3">
              {mobileDayGroups.map(({ biz, cards }) => (
                <div
                  key={biz.type}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm"
                >
                  <div
                    className="px-3 py-2.5 flex items-center gap-2"
                    style={{ background: hexAlpha(biz.color, 0.08), borderLeft: `4px solid ${biz.color}` }}
                  >
                    <span className="text-base">{biz.icon}</span>
                    <span className="text-sm font-semibold text-gray-800">{biz.label}</span>
                    <span className="text-[11px] text-gray-500 ml-auto">{cards.length} 项</span>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {cards.map(card => {
                      const { item, group, isMerged } = card;
                      const status = STATUS_MAP[group.status];
                      return (
                        <button
                          key={item.id + card.startCol}
                          type="button"
                          onClick={() => setSelectedOrder(group)}
                          className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                          style={{ background: hexAlpha(biz.color, 0.04) }}
                        >
                          <span
                            className="w-1.5 self-stretch rounded-full flex-shrink-0"
                            style={{ background: biz.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900 truncate">
                                {group.customerName}
                              </span>
                              <span
                                className="px-2 py-0.5 rounded text-[11px] font-medium flex-shrink-0"
                                style={{ color: status.color, background: status.bg }}
                              >
                                {status.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                              {item.startTime}
                              {item.endTime ? `-${item.endTime}` : ''} · {item.pax}
                              {biz.unit} · {group.remark?.trim() || '—'}
                            </div>
                          </div>
                          {isMerged && (
                            <span
                              className="text-[10px] flex items-center gap-0.5 flex-shrink-0"
                              style={{ color: biz.color }}
                            >
                              <ArrowLeftRight size={10} /> {card.endCol - card.startCol + 1}天
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ 详情弹窗 ============ */}
      {selectedOrder && (
        <DetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onCopy={() => { setCreateDrawer({ mode: 'copy', order: selectedOrder }); setSelectedOrder(null); }}
          onEdit={() => { setCreateDrawer({ mode: 'edit', order: selectedOrder }); setSelectedOrder(null); }}
          canOperate={isBookingOperator}
          onSetTemplate={(orderId, customerName) => {
            setShowSetTemplate(orderId);
            setTemplateNameInput(customerName);
          }}
        />
      )}

      {/* ============ 业务常量配置弹窗 ============ */}
      <BizConfigModal open={bizConfigOpen} onClose={() => setBizConfigOpen(false)} />

      {/* ============ Create 抽屉 ============ */}
      {createDrawer && (
        <div className="fixed inset-0 z-50" onClick={() => setCreateDrawer(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[720px] bg-white shadow-xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {createDrawer.mode === 'create' ? '新建订单' : createDrawer.mode === 'edit' ? '编辑订单' : '复制为新单'}
              </h2>
              <button onClick={() => setCreateDrawer(null)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CreateForm
                mode={createDrawer.mode}
                order={createDrawer.order}
                onClose={() => setCreateDrawer(null)}
                onSaved={handleSave}
              />
            </div>
          </div>
        </div>
      )}

      {/* ============ 导入 Excel 对话框 ============ */}
        {showImport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowImport(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">导入 Excel 建单</h3>
                <button onClick={() => setShowImport(false)} className="p-1 rounded hover:bg-gray-100">
                  <X size={18} />
                </button>
              </div>
              <div className="px-5 py-4">
                {!importPreview ? (
                  <div className="space-y-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                      <div className="font-medium mb-1">📋 使用说明</div>
                      <ul className="list-disc list-inside space-y-1 text-blue-700">
                        <li>请先下载标准模板，按格式填写后上传</li>
                        <li>模板包含 6 个工作表：运营任务单、体检人员名单、男性体检套餐、女性体检套餐、营运附件单、营运用车申请单</li>
                        <li>系统将自动解析客户信息、项目明细和费用</li>
                      </ul>
                    </div>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-orange-400 transition-colors">
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        id="excel-upload"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setImportFile(f);
                            handleParseExcel(f);
                          }
                        }}
                      />
                      <label htmlFor="excel-upload" className="cursor-pointer">
                        <Upload className="mx-auto mb-2 text-gray-400" size={48} />
                        <div className="text-sm text-gray-600 mb-2">点击选择 Excel 文件</div>
                        <div className="text-xs text-gray-400">支持 .xlsx / .xls 格式</div>
                      </label>
                    </div>
                    {importParsing && (
                      <div className="text-center text-sm text-gray-500">
                        <span className="inline-block w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                        正在解析...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="font-medium text-green-800 mb-2">✅ 解析成功预览</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><span className="text-gray-500">客户名称：</span><span className="font-medium">{importPreview.customerName || '-'}</span></div>
                        <div><span className="text-gray-500">销售人员：</span><span className="font-medium">{importPreview.salesPerson || '-'}</span></div>
                        <div><span className="text-gray-500">抵店日期：</span><span className="font-medium">{importPreview.checkinDate || '-'}</span></div>
                        <div><span className="text-gray-500">离店日期：</span><span className="font-medium">{importPreview.checkoutDate || '-'}</span></div>
                        <div><span className="text-gray-500">预估人数：</span><span className="font-medium">{importPreview.totalPeople || '-'}</span></div>
                        <div><span className="text-gray-500">项目数量：</span><span className="font-medium">{importPreview.items?.length || 0} 项</span></div>
                        <div><span className="text-gray-500">预估金额：</span><span className="font-medium text-orange-600">¥{importPreview.totalAmount || 0}</span></div>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="px-3 py-2 text-left">业务类型</th>
                            <th className="px-3 py-2 text-left">日期</th>
                            <th className="px-3 py-2 text-left">说明</th>
                            <th className="px-3 py-2 text-right">金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(importPreview.items || []).slice(0, 20).map((item: any, idx: number) => (
                            <tr key={idx} className="border-t border-gray-100">
                              <td className="px-3 py-2">{BIZ_MAP[item.itemType as BizType]?.label || item.itemType}</td>
                              <td className="px-3 py-2">{item.date || '-'}</td>
                              <td className="px-3 py-2 text-gray-500 truncate max-w-[200px]">{item.remark || item.extra?.description || '-'}</td>
                              <td className="px-3 py-2 text-right font-medium">¥{item.amount || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(importPreview.items?.length || 0) > 20 && (
                        <div className="text-center text-xs text-gray-400 py-2">
                          仅预览前 20 项，共 {importPreview.items.length} 项
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        onClick={() => { setImportPreview(null); setImportFile(null); }}
                        className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        重新选择
                      </button>
                      <button
                        onClick={handleConfirmImport}
                        disabled={saving}
                        className="px-4 py-2 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium disabled:opacity-50"
                      >
                        {saving ? '创建中...' : '确认导入建单'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ 从模板创建订单弹窗 ============ */}
        {showTemplatePicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowTemplatePicker(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Star size={18} className="text-yellow-500" /> 从模板创建订单
                </h3>
                <button onClick={() => setShowTemplatePicker(false)} className="p-1 rounded hover:bg-gray-100">
                  <X size={18} />
                </button>
              </div>
              <div className="px-5 py-4 overflow-y-auto flex-1">
                {tplLoading ? (
                  <div className="text-center py-10 text-gray-500 text-sm">
                    <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                    加载中...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="text-center py-10">
                    <FileText size={40} className="mx-auto text-gray-300 mb-3" />
                    <div className="text-sm text-gray-500 mb-1">暂无订单模板</div>
                    <div className="text-xs text-gray-400">进入订单详情 → 点击【⭐ 设为模板】即可快速创建模板</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {templates.map(tpl => (
                      <div
                        key={tpl.id}
                        className="border border-gray-200 rounded-lg p-4 hover:border-yellow-400 hover:shadow-md transition-all group bg-white"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Star size={16} className="text-yellow-500 fill-yellow-400" />
                            <span className="text-sm font-semibold text-gray-900">{tpl.templateName || '未命名模板'}</span>
                          </div>
                          <button
                            title="删除模板副本（不影响来源订单本身）"
                            onClick={(e) => { e.stopPropagation(); handleUnsetTemplate(tpl.id); }}
                            className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            删除模板
                          </button>
                        </div>
                        <div className="text-xs text-gray-500 mb-1">原客户：{tpl.customerName || '-'}</div>
                        <div className="text-xs text-gray-500 mb-3">
                          模板单号 <span className="font-mono text-[11px] text-gray-600">{tpl.orderNo}</span>
                          <span className="mx-1.5 text-gray-300">|</span>
                          共 {tpl.items?.length || 0} 项业务
                          <span className="mx-1.5 text-gray-300">|</span>
                          金额 <span className="text-orange-600 font-medium">¥{tpl.totalAmount || 0}</span>
                        </div>
                        {tpl.items && tpl.items.length > 0 && (
                          <div className="bg-gray-50 rounded p-2 mb-3 flex flex-wrap gap-1">
                            {tpl.items.slice(0, 6).map((it: any, idx: number) => (
                              <span
                                key={idx}
                                className="text-[10px] px-1.5 py-0.5 rounded text-white"
                                style={{ background: BIZ_MAP[it.itemType as BizType]?.color || '#999' }}
                              >
                                {BIZ_MAP[it.itemType as BizType]?.label || it.itemType}
                              </span>
                            ))}
                            {tpl.items.length > 6 && (
                              <span className="text-[10px] px-1.5 py-0.5 text-gray-500">+{tpl.items.length - 6} 项</span>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => handleApplyTemplate(tpl)}
                          className="w-full mt-2 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium flex items-center justify-center gap-1"
                        >
                          <Plus size={12} /> 用此模板创建
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ 设为模板弹窗 ============ */}
        {showSetTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowSetTemplate(null)}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Star size={18} className="text-yellow-500" /> 设为订单模板
                </h3>
                <button onClick={() => setShowSetTemplate(null)} className="p-1 rounded hover:bg-gray-100">
                  <X size={18} />
                </button>
              </div>
              <div className="px-5 py-5 space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 space-y-1">
                  <div className="font-medium">✅ 克隆模式：原订单保持不变</div>
                  <div>• 将生成一条新的模板副本，用于快速下单；</div>
                  <div>• 您当前的订单仍保留在订单列表里；</div>
                  <div>• 通过【新建订单 → 从模板创建】可快速复制生成新订单。</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">模板名称 <span className="text-red-500">*</span></label>
                  <input
                    autoFocus
                    type="text"
                    value={templateNameInput}
                    onChange={e => setTemplateNameInput(e.target.value)}
                    placeholder="如：体检团标准A、企业团餐套餐B 等"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowSetTemplate(null)}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmSetTemplate}
                    className="px-4 py-2 text-sm rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white font-medium"
                  >
                    确定设为模板
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============ 通用确认弹窗 ============ */}
        {confirmDialog && confirmDialog.open && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={() => setConfirmDialog(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">
                  {confirmDialog.title}
                </h3>
              </div>
              <div className="px-5 py-4">
                <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                  {confirmDialog.message}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                >
                  {confirmDialog.cancelText || '取消'}
                </button>
                <button
                  onClick={async () => {
                    const fn = confirmDialog.onConfirm;
                    setConfirmDialog(null);
                    try {
                      await fn();
                    } catch (e) {
                      // 错误由 onConfirm 内部处理
                    }
                  }}
                  className={`px-4 py-1.5 text-sm rounded-lg text-white font-medium ${
                    confirmDialog.confirmColor === 'red'
                      ? 'bg-red-500 hover:bg-red-600'
                      : confirmDialog.confirmColor === 'yellow'
                        ? 'bg-yellow-500 hover:bg-yellow-600'
                        : 'bg-green-500 hover:bg-green-600'
                  }`}
                >
                  {confirmDialog.confirmText || '确定'}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  // ============================================================
  // Excel 解析处理
  // ============================================================
  async function handleParseExcel(file: File) {
    setImportParsing(true);
    try {
      const XLSX = (await import('xlsx')) as any;
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      const result: any = {
        customerName: '',
        customerContact: '',
        salesPerson: '',
        checkinDate: '',
        checkoutDate: '',
        totalPeople: 0,
        paymentMethod: '',
        totalAmount: 0,
        items: [],
      };

      // Sheet 1: 运营任务单
      const sheet1 = wb.Sheets['运营任务单'];
      if (sheet1) {
        const data1 = XLSX.utils.sheet_to_json(sheet1, { header: 1 });
        for (const row of data1) {
          const joined = row.join(' ');
          if (!result.customerName && joined.includes('客户名称')) {
            result.customerName = String(row[1] || '').trim();
          }
          if (!result.salesPerson && joined.includes('销售人员')) {
            result.salesPerson = String(row[7] || '').trim();
          }
          if (!result.checkinDate && joined.includes('抵店日期')) {
            result.checkinDate = String(row[1] || '').trim();
            result.checkoutDate = String(row[3] || '').trim();
            result.totalPeople = parseInt(String(row[5] || '0')) || 0;
          }
          if (!result.paymentMethod && joined.includes('付款方式')) {
            result.paymentMethod = String(row[3] || '').trim();
            result.totalAmount = parseInt(String(row[1] || '0').replace(/[^0-9]/g, '')) || 0;
          }
          // 健康事业部体检接待
          if (joined.includes('体检接待')) {
            const remark = String(row[2] || '');
            const match = remark.match(/男[:：]?(\d+)\D+(\d+)/);
            const femaleMatch = remark.match(/女[:：]?(\d+)\D+(\d+)/);
            result.items.push({
              itemType: 'checkup',
              date: result.checkinDate,
              remark: remark,
              extra: { description: remark },
              amount: 0,
            });
          }
        }
      }

      // Sheet 2: 体检人员名单
      const sheet2 = wb.Sheets['体检人员名单'];
      if (sheet2) {
        const data2 = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
        const people = data2.slice(1).filter((r: any[]) => r[1]);
        result.totalPeople = Math.max(result.totalPeople, people.length);
      }

      // Sheet 5: 营运附件单 - 解析用餐
      const sheet5 = wb.Sheets['营运附件单'];
      if (sheet5) {
        const data5 = XLSX.utils.sheet_to_json(sheet5, { header: 1 });
        for (const row of data5) {
          if (row[1] && String(row[1]).includes('早餐')) {
            result.items.push({
              itemType: 'breakfast',
              date: String(row[0] || result.checkinDate).trim(),
              remark: '早餐',
              extra: { description: '早餐' },
              amount: 0,
            });
          }
          if (row[5] && String(row[5]).includes('午餐')) {
            result.items.push({
              itemType: 'lunch',
              date: String(row[4] || result.checkinDate).trim(),
              remark: '午餐',
              extra: { description: '午餐' },
              amount: 0,
            });
          }
        }
      }

      // Sheet 6: 营运用车申请单
      const sheet6 = wb.Sheets['营运用车申请单'];
      if (sheet6) {
        const data6 = XLSX.utils.sheet_to_json(sheet6, { header: 1 });
        for (const row of data6) {
          if (String(row[0] || '').includes('接客日期')) {
            result.items.push({
              itemType: 'carpickup',
              date: String(row[1] || result.checkinDate).trim(),
              remark: '接客用车',
              extra: { description: '接客用车' },
              amount: 0,
            });
          }
        }
      }

      // 如果没有解析到 items，至少添加一条体检记录
      if (result.items.length === 0 && result.checkinDate) {
        result.items.push({
          itemType: 'checkup',
          date: result.checkinDate,
          remark: '体检套餐',
          extra: { description: '体检套餐' },
          amount: result.totalAmount,
        });
      }

      setImportPreview(result);
    } catch (e) {
      console.error('Excel 解析失败:', e);
      toast.error('Excel 解析失败，请检查文件格式是否正确');
      setShowImport(false);
    } finally {
      setImportParsing(false);
    }
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    setSaving(true);
    try {
      const orderData = {
        customerName: importPreview.customerName || 'Excel导入订单',
        contactName: importPreview.customerContact || '',
        contactPhone: '',
        salesPerson: importPreview.salesPerson || '',
        paymentMethod: importPreview.paymentMethod || '',
        remark: `Excel导入 | 抵店:${importPreview.checkinDate} | 离店:${importPreview.checkoutDate} | ${importPreview.totalPeople}人`,
        items: importPreview.items,
      };
      const created = await bookingApi.createOrder(orderData);
      const adapted = adaptOrder(created);
      orderUuidMap.current[adapted.id] = created.id;
      setOrders(prev => [...prev, adapted]);
      setShowImport(false);
      setImportPreview(null);
      setImportFile(null);
      toast.success('订单导入成功！');
    } catch (e) {
      console.error('导入保存失败:', e);
      toast.error('订单导入失败: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
}