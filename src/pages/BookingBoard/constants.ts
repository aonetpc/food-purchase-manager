import type { BizConfig, BizType, DisplayStatus, OrderStatus, PackageCode, LodgingType, MeetingHall, WellnessType } from './types';

// 业务常量
export const BUSINESS: BizConfig[] = [
  { type: 'checkup',   label: '体检', unit: '人', color: '#0EA5E9', icon: '🩺' },
  { type: 'lodging',   label: '住宿', unit: '间', color: '#8B5CF6', icon: '🛏' },
  { type: 'breakfast', label: '早餐', unit: '人', color: '#F59E0B', icon: '🌅', derived: true },
  { type: 'lunch',     label: '午餐', unit: '桌', color: '#EF4444', icon: '🍽' },
  { type: 'dinner',    label: '晚餐', unit: '桌', color: '#EC4899', icon: '🌙' },
  { type: 'meeting',   label: '会务', unit: '场', color: '#14B8A6', icon: '📊' },
  { type: 'wellness',  label: '康乐', unit: '项', color: '#84CC16', icon: '🎯' },
  { type: 'carpickup', label: '用车', unit: '人', color: '#6B7280', icon: '🚗' },
];

export const BIZ_MAP = Object.fromEntries(BUSINESS.map(b => [b.type, b])) as Record<BizType, BizConfig>;

// ================================================
// 颜色工具（hex → rgba，用于生成业务色浅色背景）
// ================================================
export function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// 订单状态（实际存储仍为 5 个状态，但 UI 展示归为 3 类）
export const STATUS_MAP: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: '预测单', color: '#E8B339', bg: 'rgba(232,179,57,.12)' },
  reviewing: { label: '审批中', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  confirmed: { label: '已确认', color: '#10B981', bg: 'rgba(16,185,129,.12)' },
  rejected:  { label: '审批中', color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  completed: { label: '已确认', color: '#6366F1', bg: 'rgba(99,102,241,.12)' },
};

// UI 展示用的 3 类状态（预测单、审批中、已确认）
export const DISPLAY_STATUSES: { key: DisplayStatus; label: string; color: string; bg: string }[] = [
  { key: 'pending',    label: '预测单', color: '#E8B339', bg: 'rgba(232,179,57,.12)' },
  { key: 'reviewing',  label: '审批中', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  { key: 'confirmed',  label: '已确认', color: '#10B981', bg: 'rgba(16,185,129,.12)' },
];

// 展示状态 → 实际状态分组
export const STATUS_GROUP: Record<DisplayStatus, OrderStatus[]> = {
  pending:   ['pending'],
  reviewing: ['reviewing', 'rejected'],
  confirmed: ['confirmed', 'completed'],
};

// 实际状态 → 展示状态
export function getDisplayStatus(s: OrderStatus): DisplayStatus {
  if (s === 'pending') return 'pending';
  if (s === 'reviewing' || s === 'rejected') return 'reviewing';
  return 'confirmed';
}

/**
 * @deprecated 第5期起废弃静态套餐常量。仅作为后端数据库未初始化（尚未执行迁移）时的兜底保底。
 * 新增/修改套餐统一通过：业务配置弹窗 → 体检套餐 Tab，数据来源于 booking_packages + booking_package_items 表。
 * 历史订单详情展示也不再依赖该常量，直接使用订单提交时嵌入 extra.paxList[].finalItems 的快照数据。
 */
export const CHECKUP_PACKAGES: Record<PackageCode, { name: string; price: number }> = {
  A: { name: '基础体检套餐', price: 588 },
  B: { name: '综合体检套餐', price: 1288 },
  C: { name: '深度体检套餐', price: 2888 },
  D: { name: 'VIP体检套餐',   price: 5888 },
};

// 房型（旧编码兼容 + 新编码 RM001~RM016）
export const LODGING_TYPES: Record<LodgingType, { name: string; price: number }> = {
  // 旧编码（兼容历史数据，070 迁移后会逐步统一为 RM 编码）
  standard: { name: '标准间',   price: 480 },
  bigbed:   { name: '大床房',   price: 520 },
  suite:    { name: '套房',     price: 880 },
  vipsuite: { name: 'VIP套房',  price: 1880 },
  // 新编码 RM001~RM016（与 067 迁移脚本一致）
  RM001: { name: '【稻香楼】标准大床房',     price: 1118 },
  RM002: { name: '【稻香楼】标准双床房',     price: 1118 },
  RM003: { name: '【稻香楼】稻香山林大床房', price: 1118 },
  RM004: { name: '【稻香楼】稻香山林双床房', price: 1118 },
  RM005: { name: '【蝉鸣院】单人房',         price: 1500 },
  RM006: { name: '【蝉鸣院】标准大床房',     price: 1500 },
  RM007: { name: '【蝉鸣院】大床房',         price: 1680 },
  RM008: { name: '【蝉鸣院】双床房',         price: 1680 },
  RM009: { name: '【蝉鸣院】大床房带露台',   price: 1780 },
  RM010: { name: '【蝉鸣院】行政双床套房',   price: 1780 },
  RM011: { name: '【蝉鸣院】多床家庭套房',   price: 2380 },
  RM012: { name: '竹風别墅大床房',           price: 2880 },
  RM013: { name: '竹風临湖别墅大床房',       price: 3380 },
  RM014: { name: '竹風别墅多床房',           price: 3580 },
  RM015: { name: '竹風临湖别墅多床房',       price: 4080 },
  RM016: { name: '湖畔别墅',                 price: 11888 },
};

// 会议厅
export const MEETING_HALLS: Record<MeetingHall, { name: string; capacity: number; halfPrice: number; fullPrice: number }> = {
  siji:     { name: '四季厅', capacity: 80,  halfPrice: 2000, fullPrice: 3500 },
  shanshui: { name: '山水厅', capacity: 40,  halfPrice: 1200, fullPrice: 2200 },
  qingquan: { name: '清泉厅', capacity: 20,  halfPrice: 600,  fullPrice: 1100 },
  wanghu:   { name: '望湖厅', capacity: 120, halfPrice: 3000, fullPrice: 5800 },
};

// 康乐项目
export const WELLNESS_TYPES: Record<WellnessType, { name: string; minHours: number; price: number; free: boolean }> = {
  mahjong:     { name: '棋牌室',   minHours: 4, price: 200,  free: false },
  fishing:     { name: '钓鱼',     minHours: 12, price: 200,  free: false },
  ktv:         { name: 'KTV大包',  minHours: 3, price: 688, free: false },
  ktv_small:   { name: 'KTV小包',  minHours: 3, price: 488, free: false },
  swimming:    { name: '游泳池',   minHours: 0, price: 0,   free: true },
  gym:         { name: '健身房',   minHours: 0, price: 0,   free: true },
  billiards:   { name: '台球室',   minHours: 0, price: 0,   free: true },
  tabletennis: { name: '乒乓房',   minHours: 0, price: 0,   free: true },
};

// 付款方式
export const PAYMENT_OPTIONS = [
  '销售担保挂账',
  '客户现付',
  '公司结算',
  '预付定金',
  '其他',
];

// 可手动添加的业务（不含早餐）
export const MANUAL_BIZ_TYPES = BUSINESS.filter(b => !b.derived);

// 反查映射（名称→代码）
export const LODGING_NAME_MAP = Object.entries(LODGING_TYPES).reduce((acc, [code, v]) => { acc[v.name] = code as LodgingType; return acc; }, {} as Record<string, LodgingType>);
export const HALL_NAME_MAP = Object.entries(MEETING_HALLS).reduce((acc, [code, v]) => { acc[v.name] = code as MeetingHall; return acc; }, {} as Record<string, MeetingHall>);
export const WELLNESS_NAME_MAP = Object.entries(WELLNESS_TYPES).reduce((acc, [code, v]) => { acc[v.name] = code as WellnessType; return acc; }, {} as Record<string, WellnessType>);
/** @deprecated 依赖于废弃的 CHECKUP_PACKAGES，仅后端无数据时兜底使用，解析时请优先用 pkgNameToCode（动态配置） */
export const PACKAGE_NAME_MAP = Object.entries(CHECKUP_PACKAGES).reduce((acc, [code, v]) => { acc[v.name] = code as PackageCode; return acc; }, {} as Record<string, PackageCode>);
