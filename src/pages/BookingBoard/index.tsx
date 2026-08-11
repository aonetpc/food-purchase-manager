import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Calendar, X, ArrowLeftRight } from 'lucide-react';
import type { BookingOrder, BookingItem, BizType, OrderStatus } from './types';
import {
  BUSINESS,
  BIZ_MAP,
  STATUS_MAP,
  LODGING_TYPES,
  MEETING_HALLS,
  WELLNESS_TYPES,
  CHECKUP_PACKAGES,
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
import { generateMockData } from './mockData';

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
  return Math.max(118, (maxTrack + 1) * 92 + 16);
}

// 卡片摘要文本（用于跨天合并卡）
function cardSummary(item: BookingItem, days: number): string {
  const parts: string[] = [];
  if (item.itemType === 'lodging') {
    const lt = LODGING_TYPES[item.extra.lodgingType || 'standard'];
    parts.push(lt.name, `${item.pax}间`);
    if (item.extra.nights) parts.push(`${item.extra.nights}晚`);
    if (item.amount) parts.push(`¥${item.amount}`);
  } else if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    parts.push(BIZ_MAP[item.itemType].label);
    parts.push(`${item.extra.defaultTables || item.pax}桌`);
    if (days > 1) parts.push(`${days}天`);
  } else if (item.itemType === 'meeting') {
    const s = meetingSession(item);
    if (s) parts.push(MEETING_HALLS[s.hall].name);
    parts.push(`${item.pax}人`);
    if (days > 1) parts.push(`${days}天`);
    if (item.amount) parts.push(`¥${item.amount}`);
  } else if (item.itemType === 'wellness') {
    const s = wellnessSession(item);
    if (s) {
      parts.push(WELLNESS_TYPES[s.wellnessType].name, `${s.hours}时`);
    }
    parts.push(`${item.pax}人`);
    if (item.amount) parts.push(`¥${item.amount}`);
  } else if (item.itemType === 'breakfast') {
    parts.push('早餐', `${item.pax}人`);
    if (days > 1) parts.push(`${days}天`);
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
    const paxList = item.extra.paxList || [];
    const counts: Record<string, number> = {};
    paxList.forEach(p => { counts[p.package] = (counts[p.package] || 0) + 1; });
    return Object.entries(counts)
      .map(([k, v]) => `${CHECKUP_PACKAGES[k as keyof typeof CHECKUP_PACKAGES].name}×${v}`)
      .join(', ');
  }
  if (item.itemType === 'lodging') return LODGING_TYPES[item.extra.lodgingType || 'standard'].name;
  if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    return `${item.extra.defaultTables || 0}桌 × ${item.extra.defaultPerTable || 0}人/桌`;
  }
  if (item.itemType === 'meeting') {
    const s = meetingSession(item);
    if (s) return `${MEETING_HALLS[s.hall].name} · ${s.slotType === 'half' ? '半天' : '全天'}`;
  }
  if (item.itemType === 'wellness') {
    const s = wellnessSession(item);
    if (s) return `${WELLNESS_TYPES[s.wellnessType].name} · ${s.hours}小时`;
  }
  if (item.itemType === 'breakfast') {
    const src = item.extra.source;
    if (src) return `派生(体检${src.checkup || 0}/住宿${src.lodging || 0})`;
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
  const top = `${track * 92}px`;
  const status = STATUS_MAP[group.status];
  const days = endCol - startCol + 1;

  if (isMerged) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="absolute text-left bg-[#FAFAF7] rounded-md shadow-sm hover:shadow-md transition-shadow overflow-hidden"
        style={{
          left,
          width,
          top,
          height: '84px',
          border: `1px solid ${bizColor}66`,
          borderLeft: `3px solid ${bizColor}`,
        }}
      >
        <div
          className="flex items-center justify-between px-2 py-0.5"
          style={{ borderBottom: `1px solid ${bizColor}22` }}
        >
          <span className="text-[10px] font-mono text-gray-500">
            {BIZ_MAP[item.itemType].label}
          </span>
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: bizColor }}>
            <ArrowLeftRight size={9} /> {days}天
          </span>
        </div>
        <div className="px-2 py-1">
          <div className="text-xs font-bold text-gray-800 truncate">{group.customerName}</div>
          <div className="text-[11px] text-gray-600 truncate">{cardSummary(item, days)}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
            <span className="text-[10px] text-gray-500 truncate">{group.salesPerson}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute text-left bg-[#FAFAF7] rounded-md shadow-sm hover:shadow-md transition-shadow overflow-hidden"
      style={{ left, width, top, height: '84px', borderLeft: `3px solid ${bizColor}` }}
    >
      <div className="px-2 py-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-gray-500">
            {item.startTime}
            {item.endTime ? `-${item.endTime}` : ''}
          </span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
        </div>
        <div className="text-xs font-bold text-gray-800 truncate mt-0.5">{group.customerName}</div>
        <div className="text-[11px] text-gray-600 truncate">
          {item.pax}
          {BIZ_MAP[item.itemType].unit}
          {item.amount ? ` · ¥${item.amount}` : ''}
        </div>
        <div className="text-[10px] text-gray-400 truncate">{group.salesPerson}</div>
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
  return (
    <div className="flex border-b border-white/5 min-w-[1110px]" style={{ minHeight: `${height}px` }}>
      {/* 左侧固定栏 */}
      <div
        className="w-[200px] flex-shrink-0 sticky left-0 z-10 bg-[#161B22] flex items-center gap-2 px-3 border-r border-white/10"
        style={{ borderLeft: `3px solid ${biz.color}` }}
      >
        <span className="text-lg leading-none">{biz.icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-200 truncate">{biz.label}</div>
          <div className="text-[10px] text-gray-500">{cards.length} 项</div>
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
                className="border-r border-white/5"
                style={{
                  background: isToday
                    ? 'rgba(200,162,75,.07)'
                    : isWeekend
                      ? 'rgba(255,255,255,.02)'
                      : 'transparent',
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
    state === 'danger' ? 'bg-red-500' : state === 'active' ? 'bg-emerald-500' : 'bg-gray-600';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-gray-300">{label}</span>
      <span className="text-gray-500 font-mono ml-auto">{time}</span>
      {note && <span className="text-red-400 text-[11px]">（{note}）</span>}
    </div>
  );
}

function DetailModal({
  order,
  onClose,
  onCopy,
  onEdit,
}: {
  order: BookingOrder;
  onClose: () => void;
  onCopy: () => void;
  onEdit: () => void;
}) {
  const canEdit =
    order.status === 'pending' || order.status === 'reviewing' || order.status === 'confirmed';
  const total = groupTotal(order);
  const status = STATUS_MAP[order.status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-[#161B22] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between px-5 py-3 border-b border-white/10 sticky top-0 bg-[#161B22] z-10">
          <div>
            <div className="text-[11px] text-gray-500">订单号</div>
            <div className="text-lg font-bold font-mono text-[#C8A24B]">{order.id}</div>
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
              className="text-gray-400 hover:text-white p-1"
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
              <div className="text-sm text-gray-100 font-medium">{order.customerName}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">联系人 / 电话</div>
              <div className="text-sm text-gray-100 font-mono">
                {order.contactName} {order.contactPhone}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">销售人员</div>
              <div className="text-sm text-gray-100">{order.salesPerson}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">付款方式</div>
              <div className="text-sm text-gray-100">{order.payment}</div>
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
            <div className="border border-white/10 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-white/5 text-gray-400">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-normal">业务</th>
                    <th className="px-2 py-1.5 text-left font-normal">日期</th>
                    <th className="px-2 py-1.5 text-left font-normal">时间</th>
                    <th className="px-2 py-1.5 text-right font-normal">数量</th>
                    <th className="px-2 py-1.5 text-right font-normal">金额</th>
                    <th className="px-2 py-1.5 text-left font-normal">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map(it => {
                    const biz = BIZ_MAP[it.itemType];
                    return (
                      <tr key={it.id} className="border-t border-white/5">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span style={{ color: biz.color }}>{biz.icon}</span>{' '}
                          <span className="text-gray-200">{biz.label}</span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-gray-300">{itemDateRange(it)}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-300">
                          {it.startTime}
                          {it.endTime ? `-${it.endTime}` : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-200">
                          {it.pax}
                          {biz.unit}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-200">
                          {it.amount ? `¥${it.amount.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-gray-400">{itemDetail(it) || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 金额 */}
          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <div className="text-xs text-gray-400">订单总额</div>
            <div className="text-lg font-bold font-mono text-[#C8A24B]">
              ¥{total.toLocaleString()}
            </div>
          </div>

          {/* 备注 */}
          {order.remark && (
            <div>
              <div className="text-[11px] text-gray-500">备注</div>
              <div className="text-xs text-gray-300 bg-white/5 rounded p-2">{order.remark}</div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-2 px-5 py-3 border-t border-white/10 sticky bottom-0 bg-[#161B22]">
          <button
            type="button"
            onClick={onCopy}
            className="px-3 py-1.5 text-xs rounded bg-white/10 hover:bg-white/20 text-gray-200"
          >
            复制为新单
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-1.5 text-xs rounded text-black font-medium"
              style={{ background: '#C8A24B' }}
            >
              修改此单
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 text-xs rounded border border-white/10 text-gray-300 hover:bg-white/5"
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
  const navigate = useNavigate();

  const [orders, setOrders] = useState<BookingOrder[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [bizFilter, setBizFilter] = useState<Set<BizType>>(() => new Set(ALL_BIZ));
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => new Set(ALL_STATUS));
  const [selectedOrder, setSelectedOrder] = useState<BookingOrder | null>(null);
  const [mobileDate, setMobileDate] = useState<string>(() => todayStr());

  // 切换周时重新生成 mock 数据并重置移动端选中日期
  useEffect(() => {
    setOrders(generateMockData(weekStart));
    setMobileDate(fmt(weekStart));
  }, [weekStart]);

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
      { label: '总订单数', value: String(stats.total), color: '#C8A24B' },
      { label: '待确认', value: String(stats.pending), color: STATUS_MAP.pending.color },
      { label: '待审核', value: String(stats.reviewing), color: STATUS_MAP.reviewing.color },
      { label: '已确认', value: String(stats.confirmed), color: STATUS_MAP.confirmed.color },
      { label: '总金额', value: `¥${stats.amount.toLocaleString()}`, color: '#C8A24B' },
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

  // 导航
  const goPrevWeek = useCallback(() => setWeekStart(s => addDays(s, -7)), []);
  const goNextWeek = useCallback(() => setWeekStart(s => addDays(s, 7)), []);
  const goToday = useCallback(() => setWeekStart(getWeekStart(new Date())), []);
  const goCreate = useCallback(() => navigate('/booking-board/create'), [navigate]);
  const handleCopy = useCallback(
    (o: BookingOrder) => navigate('/booking-board/create', { state: { mode: 'copy', order: o } }),
    [navigate],
  );
  const handleEdit = useCallback(
    (o: BookingOrder) => navigate(`/booking-board/edit/${o.id}`, { state: { mode: 'edit', order: o } }),
    [navigate],
  );

  return (
    <div className="min-h-screen bg-[#0E1217] text-gray-200">
      <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
        {/* ============ 顶部栏 ============ */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#C8A24B]">预订调度画板</h1>
            <div className="text-xs text-gray-500 mt-0.5">康养中心 · 7天预订调度</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={goPrevWeek}
              className="p-1.5 rounded border border-white/10 text-gray-300 hover:bg-white/5"
              aria-label="上一周"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="px-3 py-1.5 text-sm bg-[#161B22] rounded border border-white/10 text-gray-200 font-mono min-w-[180px] text-center">
              {formatWeekRange(weekStart)}
            </div>
            <button
              type="button"
              onClick={goNextWeek}
              className="p-1.5 rounded border border-white/10 text-gray-300 hover:bg-white/5"
              aria-label="下一周"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="px-3 py-1.5 text-xs rounded border border-white/10 text-gray-300 hover:bg-white/5 flex items-center gap-1"
            >
              <Calendar size={12} /> 今天
            </button>
            <button
              type="button"
              onClick={goCreate}
              className="px-3 py-1.5 text-xs rounded text-black font-medium flex items-center gap-1"
              style={{ background: '#C8A24B' }}
            >
              <Plus size={12} /> 新建订单
            </button>
          </div>
        </div>

        {/* ============ 统计卡片 ============ */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          {statCards.map((c, i) => (
            <div
              key={i}
              className="bg-[#161B22] rounded-lg p-3 border border-white/5"
              style={{ borderLeft: `3px solid ${c.color}` }}
            >
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className="text-lg font-bold font-mono text-gray-100 mt-1 truncate">
                {c.value}
              </div>
            </div>
          ))}
        </div>

        {/* ============ 筛选栏 ============ */}
        <div className="bg-[#161B22] rounded-lg p-3 border border-white/5 mb-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-gray-500 w-12">业务</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {BUSINESS.map(biz => {
                const active = bizFilter.has(biz.type);
                return (
                  <button
                    key={biz.type}
                    type="button"
                    onClick={() => setBizFilter(s => toggleInSet(s, biz.type))}
                    className={`px-2.5 py-1 rounded text-xs flex items-center gap-1 border transition-colors ${
                      active
                        ? 'text-white border-transparent'
                        : 'text-gray-400 border-white/10 hover:border-white/30'
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
            <span className="text-[11px] text-gray-500 w-12">状态</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ALL_STATUS.map(st => {
                const cfg = STATUS_MAP[st];
                const active = statusFilter.has(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(s => toggleInSet(s, st))}
                    className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                      active
                        ? 'text-white border-transparent'
                        : 'text-gray-400 border-white/10 hover:border-white/30'
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
          <div
            className="bg-[#0E1217] rounded-lg border border-white/5 overflow-auto"
            style={{ maxHeight: 'calc(100vh - 320px)' }}
          >
            <div className="min-w-[1110px]">
              {/* 表头 */}
              <div className="flex sticky top-0 z-20 bg-[#161B22] border-b border-white/10">
                <div className="w-[200px] flex-shrink-0 sticky left-0 z-30 bg-[#161B22] px-3 py-2 border-r border-white/10">
                  <div className="text-[11px] text-gray-500">业务 / 日期</div>
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
                        className="px-2 py-2 text-center border-r border-white/10"
                        style={{ background: isToday ? 'rgba(200,162,75,.08)' : 'transparent' }}
                      >
                        <div className="text-[10px] text-gray-500">
                          {WEEKDAY_LABELS[d.getDay()]}
                        </div>
                        <div
                          className={`text-sm font-mono ${
                            isToday
                              ? 'text-[#C8A24B] font-bold'
                              : isWeekend
                                ? 'text-gray-300'
                                : 'text-gray-200'
                          }`}
                        >
                          {d.getMonth() + 1}/{d.getDate()}
                        </div>
                        <div className="text-[10px] text-gray-500">{dayOrderCount[ds] || 0} 单</div>
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
                      ? 'border-[#C8A24B] bg-[#C8A24B]/10'
                      : 'border-white/10 bg-[#161B22]'
                  }`}
                >
                  <div className="text-[10px] text-gray-500">{WEEKDAY_LABELS[d.getDay()]}</div>
                  <div
                    className={`text-sm font-mono ${
                      isToday ? 'text-[#C8A24B] font-bold' : 'text-gray-200'
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
            <div className="text-center text-gray-500 text-sm py-10 bg-[#161B22] rounded-lg border border-white/5">
              当日暂无预订
            </div>
          ) : (
            <div className="space-y-3">
              {mobileDayGroups.map(({ biz, cards }) => (
                <div
                  key={biz.type}
                  className="bg-[#161B22] rounded-lg border border-white/5 overflow-hidden"
                >
                  <div
                    className="px-3 py-2 flex items-center gap-2 border-b border-white/5"
                    style={{ borderLeft: `3px solid ${biz.color}` }}
                  >
                    <span>{biz.icon}</span>
                    <span className="text-sm text-gray-200">{biz.label}</span>
                    <span className="text-[10px] text-gray-500 ml-auto">{cards.length} 项</span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {cards.map(card => {
                      const { item, group, isMerged } = card;
                      const status = STATUS_MAP[group.status];
                      return (
                        <button
                          key={item.id + card.startCol}
                          type="button"
                          onClick={() => setSelectedOrder(group)}
                          className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-3"
                        >
                          <span
                            className="w-1 self-stretch rounded-full flex-shrink-0"
                            style={{ background: biz.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-100 truncate">
                                {group.customerName}
                              </span>
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] flex-shrink-0"
                                style={{ color: status.color, background: status.bg }}
                              >
                                {status.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                              {item.startTime}
                              {item.endTime ? `-${item.endTime}` : ''} · {item.pax}
                              {biz.unit} · {group.salesPerson}
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
          onCopy={() => handleCopy(selectedOrder)}
          onEdit={() => handleEdit(selectedOrder)}
        />
      )}
    </div>
  );
}
