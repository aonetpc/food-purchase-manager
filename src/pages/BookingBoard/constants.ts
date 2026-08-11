import type { BizConfig, BizType, OrderStatus, PackageCode, LodgingType, MeetingHall, WellnessType } from './types';

// 业务常量
export const BUSINESS: BizConfig[] = [
  { type: 'checkup',   label: '体检', unit: '人', color: '#0EA5E9', icon: '🩺' },
  { type: 'lodging',   label: '住宿', unit: '间', color: '#8B5CF6', icon: '🛏' },
  { type: 'breakfast', label: '早餐', unit: '人', color: '#F59E0B', icon: '🌅', derived: true },
  { type: 'lunch',     label: '午餐', unit: '桌', color: '#EF4444', icon: '🍽' },
  { type: 'dinner',    label: '晚餐', unit: '桌', color: '#EC4899', icon: '🌙' },
  { type: 'meeting',   label: '会务', unit: '场', color: '#14B8A6', icon: '📊' },
  { type: 'wellness',  label: '康乐', unit: '项', color: '#84CC16', icon: '🎯' },
  { type: 'carpickup', label: '用车', unit: '次', color: '#6B7280', icon: '🚗' },
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

// 订单状态
export const STATUS_MAP: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: '待确认', color: '#E8B339', bg: 'rgba(232,179,57,.12)' },
  reviewing: { label: '待审核', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  confirmed: { label: '已确认', color: '#10B981', bg: 'rgba(16,185,129,.12)' },
  rejected:  { label: '已驳回', color: '#EF4444', bg: 'rgba(239,68,68,.12)' },
  completed: { label: '已完成', color: '#6366F1', bg: 'rgba(99,102,241,.12)' },
};

// 体检套餐
export const CHECKUP_PACKAGES: Record<PackageCode, { name: string; price: number }> = {
  A: { name: '基础体检套餐', price: 588 },
  B: { name: '综合体检套餐', price: 1288 },
  C: { name: '深度体检套餐', price: 2888 },
  D: { name: 'VIP体检套餐',   price: 5888 },
};

// 房型
export const LODGING_TYPES: Record<LodgingType, { name: string; price: number }> = {
  standard: { name: '标准间',   price: 480 },
  bigbed:   { name: '大床房',   price: 520 },
  suite:    { name: '套房',     price: 880 },
  vipsuite: { name: 'VIP套房',  price: 1880 },
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
  mahjong:     { name: '棋牌室',   minHours: 4, price: 80,  free: false },
  fishing:     { name: '钓鱼',     minHours: 2, price: 60,  free: false },
  ktv:         { name: 'KTV',      minHours: 2, price: 120, free: false },
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
export const PACKAGE_NAME_MAP = Object.entries(CHECKUP_PACKAGES).reduce((acc, [code, v]) => { acc[v.name] = code as PackageCode; return acc; }, {} as Record<string, PackageCode>);
