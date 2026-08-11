// 订单状态
export type OrderStatus = 'pending' | 'reviewing' | 'confirmed' | 'rejected' | 'completed';

// 业务类型
export type BizType = 'checkup' | 'lodging' | 'breakfast' | 'lunch' | 'dinner' | 'meeting' | 'wellness' | 'carpickup';

// 体检套餐代码
export type PackageCode = 'A' | 'B' | 'C' | 'D';

// 房型
export type LodgingType = 'standard' | 'bigbed' | 'suite' | 'vipsuite';

// 会议厅
export type MeetingHall = 'siji' | 'shanshui' | 'qingquan' | 'wanghu';

// 康乐项目
export type WellnessType = 'mahjong' | 'fishing' | 'ktv' | 'swimming' | 'gym' | 'billiards' | 'tabletennis';

// 业务项目
export interface BookingItem {
  id: string;
  itemType: BizType;
  date: string;          // YYYY-MM-DD 主日期
  startTime: string;     // HH:mm
  endTime?: string;
  pax: number;           // 数量（人/间/桌/场/项）
  extra: ItemExtra;
  amount: number;
}

// 各业务 extra 结构
export interface ItemExtra {
  // 体检
  paxList?: PaxEntry[];
  packageTotal?: number;

  // 住宿
  lodgingType?: LodgingType;
  dateCheckIn?: string;
  dateCheckOut?: string;
  arrivalTime?: string;
  nights?: number;

  // 午餐/晚餐
  dateStart?: string;
  dateEnd?: string;
  defaultTime?: string;
  defaultTables?: number;
  defaultPerTable?: number;
  sessions?: MealSession[];

  // 会务
  // sessions 复用

  // 康乐
  // sessions 复用

  // 早餐（派生）
  derived?: boolean;
  source?: { checkup?: number; lodging?: number };
}

export interface PaxEntry {
  name: string;
  idCard: string;
  phone: string;
  gender: '男' | '女';
  married: boolean;
  package: PackageCode;
}

export interface MealSession {
  date: string;
  time: string;
  tables: number;
  perTable: number;
}

export interface MeetingSession {
  date: string;
  startTime: string;
  hall: MeetingHall;
  slotType: 'half' | 'full';
  pax: number;
}

export interface WellnessSession {
  date: string;
  startTime: string;
  wellnessType: WellnessType;
  hours: number;
  pax: number;
}

// 订单
export interface BookingOrder {
  id: string;
  customerName: string;
  contactName: string;
  contactPhone: string;
  salesPerson: string;
  salesPersonId?: string;
  payment: string;
  remark: string;
  items: BookingItem[];
  status: OrderStatus;
  createdAt: string;
  confirmedAt?: string;
  rejectedBy?: string;
  rejectReason?: string;
}

// 业务常量定义
export interface BizConfig {
  type: BizType;
  label: string;
  unit: string;
  color: string;
  icon: string;
  derived?: boolean;
}

// 画板卡片（渲染用）
export interface RenderCard {
  item: BookingItem;
  group: BookingOrder;
  startCol: number;
  endCol: number;
  track: number;
  isMerged: boolean;
  mergedItems?: BookingItem[];
}

// 筛选状态
export interface FilterState {
  biz: Set<BizType>;
  status: Set<OrderStatus>;
}
