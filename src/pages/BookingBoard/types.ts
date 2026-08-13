// 订单状态
export type OrderStatus = 'pending' | 'reviewing' | 'confirmed' | 'rejected' | 'completed';

// 业务类型
export type BizType = 'checkup' | 'lodging' | 'breakfast' | 'lunch' | 'dinner' | 'meeting' | 'wellness' | 'carpickup';

// 体检套餐代码（改为动态 string，后端可新增任意套餐）
export type PackageCode = string;

// 房型（改为动态 string）
export type LodgingType = string;

// 会议厅（改为动态 string）
export type MeetingHall = string;

// 康乐项目（改为动态 string）
export type WellnessType = string;

// 体检套餐记录（增强版，包含 items）
export interface PackageItemRow {
  id: string;
  package_id: string;
  item_id: string;
  item_name_snapshot: string;
  item_price: number;
  quantity: number;
  sort_order: number;
}

export interface PackageRow {
  id: string;
  code: string;
  name: string;
  price: number;
  status: number;
  sort_order: number;
  item_count?: number;
  auto_total?: number;
  remark?: string;
  items?: PackageItemRow[];
}

// 体检项目主表记录
export interface CheckupItemRow {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string;
  default_price: number;
  unit: string;
  status: number;
  sort_order: number;
}

export interface RoomTypeRow {
  id: string;
  code: string;
  name: string;
  price: number;
  status: number;
  sort_order: number;
}

export interface MeetingHallRow {
  id: string;
  code: string;
  name: string;
  capacity: number;
  half_price: number;
  full_price: number;
  status: number;
  sort_order: number;
}

export interface WellnessTypeRow {
  id: string;
  code: string;
  name: string;
  min_hours: number;
  price: number;
  is_free: number;
  status: number;
  sort_order: number;
}

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

  // 午餐/晚餐/会议/康乐 统一 sessions 字段（联合类型）
  dateStart?: string;
  dateEnd?: string;
  defaultTime?: string;
  defaultTables?: number;
  defaultPerTable?: number;
  sessions?: (MealSession | MeetingSession | WellnessSession)[];

  // 早餐（派生）
  derived?: boolean;
  source?: { checkup?: number; lodging?: number };
}

// 临时定制的体检项目项（在套餐基础上加减项目时使用）
export interface CustomPackageItem {
  item_id: string;          // 体检项目库ID（空=临时新增，未入项目库）
  item_name_snapshot: string; // 名称快照
  item_price: number;       // 单价
  quantity: number;         // 数量（默认1）
  remark?: string;          // 备注
  __temporary?: boolean;    // 是否为临时追加（不在原套餐中的标记，用于UI区分）
}

export interface PaxEntry {
  name: string;
  idCard: string;
  phone: string;
  gender: '男' | '女';
  married: boolean;
  package: PackageCode;
  // 第4期新增：临时定制项目（在套餐基础上的修改）。
  //   - undefined/null = 完全使用套餐原始项目
  //   - 有值 = 使用该数组作为最终体检项目列表（已包含加减后的结果）
  customItems?: CustomPackageItem[] | null;
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
