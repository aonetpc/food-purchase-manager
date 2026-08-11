import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Calendar, X, ArrowLeftRight, Download, Upload, FileText, Star, Edit2, ChevronDown, AlertCircle } from 'lucide-react';
import type { BookingOrder, BookingItem, BizType, OrderStatus } from './types';
import {
  BUSINESS,
  BIZ_MAP,
  STATUS_MAP,
  LODGING_TYPES,
  MEETING_HALLS,
  WELLNESS_TYPES,
  CHECKUP_PACKAGES,
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
import { useAuthStore } from '@/store/authStore';
import CreateFormRaw from './Create';

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
            <span className="text-[10px] text-gray-600 truncate">{group.salesPerson}</span>
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
          {item.pax}
          {BIZ_MAP[item.itemType].unit}
          {item.amount ? ` · ¥${item.amount}` : ''}
        </div>
        <div className="text-[10px] text-gray-500 truncate">{group.salesPerson}</div>
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200 shadow-2xl"
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
                    return (
                      <tr key={it.id} className="border-t border-gray-200">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span style={{ color: biz.color }}>{biz.icon}</span>{' '}
                          <span className="text-gray-700">{biz.label}</span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-gray-600">{itemDateRange(it)}</td>
                        <td className="px-2 py-1.5 font-mono text-gray-600">
                          {it.startTime}
                          {it.endTime ? `-${it.endTime}` : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-700">
                          {it.pax}
                          {biz.unit}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-700">
                          {it.amount ? `¥${it.amount.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-gray-500">{itemDetail(it) || '-'}</td>
                      </tr>
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
  // orderNo → backend UUID 映射（编辑/状态操作时需要 UUID 调后端）
  const orderUuidMap = useRef<Record<string, string>>({});

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

  // 切换周时从后端加载订单数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const weekStartStr = fmt(weekStart);
        const { data } = await bookingApi.getOrders({ weekStart: weekStartStr });
        if (!cancelled) {
          const map: Record<string, string> = {};
          const adapted = data.map(apiOrder => {
            const displayId = apiOrder.orderNo || apiOrder.id;
            map[displayId] = apiOrder.id;
            return adaptOrder(apiOrder);
          });
          orderUuidMap.current = map;
          setOrders(adapted);
        }
      } catch (e) {
        console.error('[BookingBoard] 加载订单失败:', e);
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    setMobileDate(fmt(weekStart));
    return () => { cancelled = true; };
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

  // 识别待完善草稿（没有任何 items 的 pending 订单）
  const draftOrders = useMemo(() => {
    return orders.filter(o =>
      o.status === 'pending' &&
      (!o.items || o.items.length === 0)
    );
  }, [orders]);

  // 加载模板列表
  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const list = await bookingApi.getTemplates();
      setTemplates(list);
    } catch (e) {
      console.error('加载模板失败:', e);
    } finally {
      setTplLoading(false);
    }
  }, []);

  // 应用模板创建新单
  const handleApplyTemplate = async (tpl: any) => {
    if (!confirm(`确定从模板「${tpl.templateName}」创建订单吗？\n日期会自动偏移到本周。`)) return;
    try {
      const created = await bookingApi.applyTemplate(tpl.id);
      const adapted = adaptOrder(created);
      orderUuidMap.current[adapted.id] = created.id;
      setOrders(prev => [...prev, adapted]);
      setShowTemplatePicker(false);
      // 直接进入编辑模式
      setCreateDrawer({ mode: 'edit', order: adapted });
    } catch (e) {
      alert('创建失败: ' + (e as Error).message);
    }
  };

  // 确认设为模板
  const handleConfirmSetTemplate = async () => {
    const orderId = showSetTemplate;
    const name = templateNameInput.trim();
    if (!orderId || !name) { alert('请输入模板名称'); return; }
    try {
      await bookingApi.setTemplate(orderUuidMap.current[orderId] || orderId, name);
      alert('已设为模板');
      setShowSetTemplate(null);
      setTemplateNameInput('');
    } catch (e) {
      alert('设置失败: ' + (e as Error).message);
    }
  };

  // 取消模板
  const handleUnsetTemplate = async (tplId: string) => {
    if (!confirm('确定取消该模板？')) return;
    try {
      await bookingApi.unsetTemplate(tplId);
      alert('已取消模板');
      await loadTemplates();
    } catch (e) {
      alert('操作失败: ' + (e as Error).message);
    }
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
      alert('保存失败: ' + (e as Error).message);
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
                  className="bg-white rounded-lg border border-amber-200 p-3 cursor-pointer hover:shadow-md hover:border-amber-400 transition-all"
                  onClick={() => isBookingOperator ? setCreateDrawer({ mode: 'edit', order: o }) : setSelectedOrder(o)}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{o.id}</div>
                      <div className="text-xs text-gray-600 font-medium mt-0.5 truncate">👥 {o.customerName || '（未填客户名）'}</div>
                      <div className="text-[11px] text-gray-400 mt-1 truncate">
                        {o.salesPerson ? `销售：${o.salesPerson}` : '未填销售'} · {o.createdAt?.slice(0, 10) || '今天'}
                      </div>
                    </div>
                    {isBookingOperator && <Edit2 size={14} className="text-amber-500 flex-shrink-0 ml-2 mt-1" />}
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
          onCopy={() => { setCreateDrawer({ mode: 'copy', order: selectedOrder }); setSelectedOrder(null); }}
          onEdit={() => { setCreateDrawer({ mode: 'edit', order: selectedOrder }); setSelectedOrder(null); }}
          canOperate={isBookingOperator}
          onSetTemplate={(orderId, customerName) => {
            setShowSetTemplate(orderId);
            setTemplateNameInput(customerName);
          }}
        />
      )}

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
                            title="取消模板"
                            onClick={(e) => { e.stopPropagation(); handleUnsetTemplate(tpl.id); }}
                            className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            取消模板
                          </button>
                        </div>
                        <div className="text-xs text-gray-500 mb-1">原客户：{tpl.customerName || '-'}</div>
                        <div className="text-xs text-gray-500 mb-3">
                          共 {tpl.items?.length || 0} 项业务 · 
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
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                  设置模板名称后，可通过顶部【新建订单 → 从模板创建】快速复制本订单。
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
      alert('Excel 解析失败，请检查文件格式是否正确');
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
      alert('订单导入成功！');
    } catch (e) {
      console.error('导入保存失败:', e);
      alert('订单导入失败: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
}