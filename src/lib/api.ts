const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const DEFAULT_TIMEOUT = 35000; // 默认35秒超时（后端30秒超时+5秒缓冲）

function getToken(): string | null {
  try {
    const stored = localStorage.getItem('auth-session-v2');
    if (stored) {
      const data = JSON.parse(stored);
      if (data?.state?.user?.token) return data.state.user.token;
    }
    const storedLegacy = localStorage.getItem('auth-session');
    if (storedLegacy) {
      const data = JSON.parse(storedLegacy);
      if (data?.state?.user?.token) return data.state.user.token;
    }
  } catch (e) {
    console.error('Failed to get token:', e);
  }
  return null;
}

async function request<T>(path: string, options: RequestInit & { params?: Record<string, any>; timeout?: number } = {}): Promise<T> {
  let url = `${BASE_URL}${path}`;
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  
  if (options.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    if (searchParams.toString()) {
      url += `?${searchParams.toString()}`;
    }
  }
  
  const token = getToken();
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const { params: _, timeout: __, ...restOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...restOptions,
      headers: {
        ...defaultHeaders,
        ...restOptions.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '请求失败' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const api = {
  get: <T>(path: string, options?: RequestInit & { params?: Record<string, any> }) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, data?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),
  put: <T>(path: string, data?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  getBaseUrl: () => BASE_URL,
  getToken,
};

// ============================================================
// 预订调度模块 API
// snake_case ↔ camelCase 转换
// ============================================================

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, (_, c) => '_' + c.toLowerCase());
}

function transformKeys(obj: any, fn: (k: string) => string): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(v => transformKeys(v, fn));
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[fn(k)] = transformKeys(v, fn);
    }
    return result;
  }
  return obj;
}

/** 后端 snake_case → 前端 camelCase（递归转换所有 key） */
function fromBackend<T = any>(data: any): T {
  return transformKeys(data, snakeToCamel) as T;
}

/** 前端 items → 后端 items（只转 item 层字段，extra 保持原样） */
function itemsToBackend(items: any[]): any[] {
  return (items || []).map(it => ({
    item_type: it.itemType,
    date: it.date,
    start_time: it.startTime || null,
    end_time: it.endTime || null,
    pax: it.pax,
    extra: it.extra,  // extra 保持 camelCase，后端 JSON 原样存储
    amount: it.amount,
  }));
}

export interface BookingApiOrder {
  id: string;
  orderNo: string;
  customerName: string;
  contactName?: string;
  contactPhone?: string;
  salesPerson?: string;
  salesPersonId?: string;
  paymentMethod?: string;
  remark?: string;
  status: string;
  totalAmount: number;
  bookerId?: string;
  bookerName?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectionReason?: string;
  confirmedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  items: any[];
  derivedBreakfasts?: any[];
}

export interface BookingSearchResult {
  id: string;
  customer_name: string;
  contact_phone: string | null;
  order_no: string | null;
  biz_types: string[];
  biz_label: string;
  status: string;
  total_people: number;
  total_amount: number;
  created_at: string;
  appointment_date: string | null;
  remark: string | null;
  sales_person: string | null;
}

export interface BookingSalesUser {
  id: string;
  name: string;
  username?: string;
}

export interface PackageItemRow {
  id: string;
  package_id: string;
  item_id: string;
  item_name_snapshot: string;
  item_price: number;
  quantity: number;
  remark?: string;
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

export interface CheckupItemRow {
  id: string;
  code: string;
  name: string;
  item_type?: 'item' | 'combo';
  category: string;
  description: string;
  /** 体检意义 / 临床意义（在客户展示页 SharePage 显示） */
  clinical_significance?: string | null;
  default_price: number;
  insurance_price?: number;
  unit: string;
  status: number;
  sort_order: number;
  sub_items?: Array<{
    sub_item_id: string;
    name: string;
    code: string;
    default_price: number;
    insurance_price?: number;
    category: string;
    unit: string;
    sort_order: number;
  }>;
  sub_item_ids?: string[];
  /** 适用角色：null/空数组/undefined = 全通用；或 ['male'|'female_married'|'female_single'] 白名单 */
  applicable_roles?: Array<'male' | 'female_married' | 'female_single'> | null;
}

export interface RoomTypeRow {
  id: string;
  code: string;
  name: string;
  price: number;
  status: number;
  sort_order: number;
  pricing_mode?: 'per_room' | 'per_person';
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
  package_hours: number;
  price: number;
  price_guest: number;
  price_external: number;
  time_window?: string | null;
  pricing_mode: 'per_hour' | 'package';
  is_free: number;
  status: number;
  sort_order: number;
}

export interface MealTypeRow {
  id: string;
  code: string;
  name: string;
  pricing_mode: 'per_table' | 'per_person';
  unit_price: number;
  default_time: string;
  default_tables: number;
  default_per_table: number;
  default_pax: number;
  description?: string;
  status: number;
  sort_order: number;
}

export interface BookingConfig {
  packages: PackageRow[];
  roomTypes: RoomTypeRow[];
  meetingHalls: MeetingHallRow[];
  wellnessTypes: WellnessTypeRow[];
  mealTypes?: MealTypeRow[];
  checkupItems?: CheckupItemRow[];
  salesUsers?: BookingSalesUser[];
}

export const bookingApi = {
  // 按周查询订单列表
  async getOrders(params: {
    weekStart?: string;
    weekEnd?: string;
    status?: string;
    bizType?: string;
    salesPerson?: string;
    customerName?: string;
  }): Promise<{ data: BookingApiOrder[]; filters: { weekStart: string; weekEnd: string } }> {
    const res = await api.get<{ ok: boolean; data: any[]; filters: any }>('/booking/orders', { params });
    return {
      data: (res.data || []).map(fromBackend) as BookingApiOrder[],
      filters: { weekStart: res.filters?.weekStart || '', weekEnd: res.filters?.weekEnd || '' },
    };
  },

  // 查询单个订单详情
  async getOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.get<{ ok: boolean; data: any }>(`/booking/orders/${id}`);
    return fromBackend(res.data);
  },

  // 历史订单搜索（无日期限制）
  async searchOrders(params: {
    keyword?: string;
    bizTypes?: string;
    statuses?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    total: number;
    page: number;
    pageSize: number;
    orders: BookingSearchResult[];
  }> {
    const res = await api.get<{ ok: boolean; data: any }>('/booking/orders/search', { params });
    const d = res.data || {};
    return {
      total: d.total || 0,
      page: d.page || 1,
      pageSize: d.page_size || 20,
      orders: (d.orders || []) as BookingSearchResult[],
    };
  },

  // 新建订单
  async createOrder(payload: {
    customerName: string;
    contactName?: string;
    contactPhone?: string;
    salesPerson?: string;
    salesPersonId?: string;
    paymentMethod?: string;
    remark?: string;
    items: any[];
  }): Promise<BookingApiOrder> {
    const backendPayload = {
      customerName: payload.customerName,
      contactName: payload.contactName,
      contactPhone: payload.contactPhone,
      salesPerson: payload.salesPerson,
      salesPersonId: payload.salesPersonId,
      paymentMethod: payload.paymentMethod,
      remark: payload.remark,
      items: itemsToBackend(payload.items),
    };
    const res = await api.post<{ ok: boolean; data: any }>('/booking/orders', backendPayload);
    return fromBackend(res.data);
  },

  // 编辑订单
  async updateOrder(id: string, payload: {
    customerName: string;
    contactName?: string;
    contactPhone?: string;
    salesPerson?: string;
    salesPersonId?: string;
    paymentMethod?: string;
    remark?: string;
    items: any[];
  }): Promise<BookingApiOrder> {
    const backendPayload = {
      customerName: payload.customerName,
      contactName: payload.contactName,
      contactPhone: payload.contactPhone,
      salesPerson: payload.salesPerson,
      salesPersonId: payload.salesPersonId,
      paymentMethod: payload.paymentMethod,
      remark: payload.remark,
      items: itemsToBackend(payload.items),
    };
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/orders/${id}`, backendPayload);
    return fromBackend(res.data);
  },

  // 复制为新单
  async duplicateOrder(id: string, payload?: {
    clearRemark?: boolean;
    itemDateShiftDays?: number;
  }): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/duplicate`, payload || {});
    return fromBackend(res.data);
  },

  // 提交确认（pending → sales_confirming）
  async submitOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/submit`, {});
    return fromBackend(res.data);
  },

  // 销售员确认（sales_confirming → reviewing）
  async salesConfirmOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/sales-confirm`, {});
    return fromBackend(res.data);
  },

  // 撤回（sales_confirming → pending）
  async withdrawOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/withdraw`, {});
    return fromBackend(res.data);
  },

  // 审核通过（reviewing → confirmed）
  async approveOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/approve`, {});
    return fromBackend(res.data);
  },

  // 驳回（sales_confirming/reviewing → rejected）
  async rejectOrder(id: string, rejectionReason: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/reject`, { rejectionReason });
    return fromBackend(res.data);
  },

  // 标记完成（confirmed → completed）
  async completeOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/complete`, {});
    return fromBackend(res.data);
  },

  // 删除草稿订单（仅 pending 状态）
  async deleteOrder(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/orders/${id}`);
  },

  // 获取业务常量
  async getConfig(): Promise<BookingConfig> {
    const res = await api.get<{ ok: boolean; data: any }>('/booking/config');
    // 【修复】后端字段名可能是 snake_case，也可能因 FastAPI response_model 转 camelCase
    // 双读兜底：先读 camelCase（若后端开启 alias generator 会走这个），否则读 snake_case
    const d = res.data || {};
    return {
      // 套餐：fromBackend 转换后需将嵌套 items 还原为 snake_case（渲染代码使用 snake_case）
      packages: (d.packages || d.pkg_list || []).map((p: any) => {
        const transformed = fromBackend(p);
        if (transformed.items && Array.isArray(transformed.items)) {
          transformed.items = transformed.items.map((it: any) => ({
            item_id: it.itemId ?? it.item_id ?? '',
            item_name_snapshot: it.itemNameSnapshot ?? it.item_name_snapshot ?? '',
            item_price: it.itemPrice ?? it.item_price ?? 0,
            quantity: it.quantity ?? 1,
            remark: it.remark ?? '',
            sort_order: it.sortOrder ?? it.sort_order ?? 0,
            role: it.role ?? it.scope ?? 'common',
          }));
        }
        return transformed;
      }),
      roomTypes:    (d.roomTypes    || d.room_types    || []) as RoomTypeRow[],
      meetingHalls: (d.meetingHalls || d.meeting_halls || []) as MeetingHallRow[],
      wellnessTypes:(d.wellnessTypes|| d.wellness_types|| []) as WellnessTypeRow[],
      mealTypes:    (d.mealTypes    || d.meal_types    || []) as MealTypeRow[],
      // 体检项目不走 fromBackend（渲染代码用 snake_case，保持与后端一致）
      checkupItems: (d.checkupItems || d.checkup_items || []) as CheckupItemRow[],
      salesUsers:   (d.salesUsers   || d.sales_users   || []).map(fromBackend),
    };
  },

  // 设为模板
  async setTemplate(id: string, templateName: string): Promise<void> {
    await api.post<{ ok: boolean }>(`/booking/orders/${id}/set-template`, { templateName });
  },

  // 取消模板
  async unsetTemplate(id: string): Promise<void> {
    await api.post<{ ok: boolean }>(`/booking/orders/${id}/unset-template`, {});
  },

  // 模板列表
  async getTemplates(): Promise<any[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/templates');
    return (res.data || []).map(fromBackend);
  },

  // 从模板创建订单
  async applyTemplate(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/templates/${id}/apply`, {});
    return fromBackend(res.data);
  },

  // ===== 4 类业务常量 CRUD =====
  async listPackages(): Promise<PackageRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/packages');
    return (res.data || []).map(fromBackend) as PackageRow[];
  },
  async createPackage(payload: Partial<PackageRow>): Promise<PackageRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/packages', payload);
    return fromBackend(res.data) as PackageRow;
  },
  async updatePackage(id: string, payload: Partial<PackageRow>): Promise<PackageRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/packages/${id}`, payload);
    return fromBackend(res.data) as PackageRow;
  },
  async deletePackage(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/packages/${id}`);
  },

  // ===== 体检项目主表 CRUD =====
  // 注意：体检项目前端渲染代码（BizConfigModal.tsx）全部使用 snake_case
  //       因此这里不做 fromBackend 转换，保持与后端字段一致
  async listCheckupItems(): Promise<CheckupItemRow[]> {
    const res = await api.get<{ ok: boolean; data: any[]; error?: string }>('/booking/config/checkup-items');
    if (!res.ok) throw new Error(res.error || '获取体检项目列表失败');
    return (res.data || []) as CheckupItemRow[];
  },
  async createCheckupItem(payload: Partial<CheckupItemRow>): Promise<CheckupItemRow> {
    const res = await api.post<{ ok: boolean; data: any; error?: string }>('/booking/config/checkup-items', payload);
    if (!res.ok) throw new Error(res.error || '创建体检项目失败');
    return res.data as CheckupItemRow;
  },
  async updateCheckupItem(id: string, payload: Partial<CheckupItemRow>): Promise<CheckupItemRow> {
    const res = await api.put<{ ok: boolean; data: any; error?: string }>(`/booking/config/checkup-items/${id}`, payload);
    if (!res.ok) throw new Error(res.error || '更新体检项目失败');
    return res.data as CheckupItemRow;
  },
  async deleteCheckupItem(id: string): Promise<void> {
    const res = await api.delete<{ ok: boolean; error?: string }>(`/booking/config/checkup-items/${id}`);
    if (!res.ok) throw new Error(res.error || '删除体检项目失败');
  },
  // 批量清空所有体检项目（含 status=0 的漏删项），事务中会自动处理 FK 关联
  async wipeAllCheckupItems(): Promise<{ deleted: number; subItemsCleared: number; packageItemsFixed: number }> {
    const res = await api.delete<{ ok: boolean; error?: string; data: any }>('/booking/config/checkup-items');
    if (!res.ok) throw new Error(res.error || '批量清空体检项目失败');
    return (res.data || { deleted: 0, subItemsCleared: 0, packageItemsFixed: 0 }) as any;
  },

  // ===== 套餐项目（子资源）CRUD =====
  async listPackageItems(pkgId: string): Promise<PackageItemRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>(`/booking/config/packages/${pkgId}/items`);
    return (res.data || []).map(fromBackend) as PackageItemRow[];
  },
  async addPackageItem(pkgId: string, payload: { item_id: string; item_price?: number; quantity?: number; remark?: string; sort_order?: number }): Promise<PackageItemRow> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/config/packages/${pkgId}/items`, payload);
    return fromBackend(res.data) as PackageItemRow;
  },
  async updatePackageItem(pkgId: string, id: string, payload: { item_price?: number; quantity?: number; remark?: string; sort_order?: number }): Promise<PackageItemRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/packages/${pkgId}/items/${id}`, payload);
    return fromBackend(res.data) as PackageItemRow;
  },
  async deletePackageItem(pkgId: string, id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/packages/${pkgId}/items/${id}`);
  },
  async batchUpdatePackageItems(pkgId: string, items: any[]): Promise<PackageItemRow[]> {
    const res = await api.put<{ ok: boolean; data: any[] }>(`/booking/config/packages/${pkgId}/items-batch`, { items });
    return (res.data || []).map(fromBackend) as PackageItemRow[];
  },

  // 房型 CRUD（不走 fromBackend，保持 snake_case，与 wellnessTypes/mealTypes 一致）
  async listRoomTypes(): Promise<RoomTypeRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/room-types');
    return (res.data || []) as RoomTypeRow[];
  },
  async createRoomType(payload: Partial<RoomTypeRow>): Promise<RoomTypeRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/room-types', payload);
    return res.data as RoomTypeRow;
  },
  async updateRoomType(id: string, payload: Partial<RoomTypeRow>): Promise<RoomTypeRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/room-types/${id}`, payload);
    return res.data as RoomTypeRow;
  },
  async deleteRoomType(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/room-types/${id}`);
  },

  // 会议厅 CRUD（不走 fromBackend，保持 snake_case）
  async listMeetingHalls(): Promise<MeetingHallRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/meeting-halls');
    return (res.data || []) as MeetingHallRow[];
  },
  async createMeetingHall(payload: Partial<MeetingHallRow>): Promise<MeetingHallRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/meeting-halls', payload);
    return res.data as MeetingHallRow;
  },
  async updateMeetingHall(id: string, payload: Partial<MeetingHallRow>): Promise<MeetingHallRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/meeting-halls/${id}`, payload);
    return res.data as MeetingHallRow;
  },
  async deleteMeetingHall(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/meeting-halls/${id}`);
  },

  // 康乐项目 CRUD（不走 fromBackend，保持 snake_case，与 mealTypes 一致）
  async listWellnessTypes(): Promise<WellnessTypeRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/wellness-types');
    return (res.data || []) as WellnessTypeRow[];
  },
  async createWellnessType(payload: Partial<WellnessTypeRow>): Promise<WellnessTypeRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/wellness-types', payload);
    return res.data as WellnessTypeRow;
  },
  async updateWellnessType(id: string, payload: Partial<WellnessTypeRow>): Promise<WellnessTypeRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/wellness-types/${id}`, payload);
    return res.data as WellnessTypeRow;
  },
  async deleteWellnessType(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/wellness-types/${id}`);
  },

  // 用餐标准 CRUD（不走 fromBackend，保持 snake_case）
  async listMealTypes(): Promise<MealTypeRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/meal-types');
    return (res.data || []) as MealTypeRow[];
  },
  async createMealType(payload: Partial<MealTypeRow>): Promise<MealTypeRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/meal-types', payload);
    return res.data as MealTypeRow;
  },
  async updateMealType(id: string, payload: Partial<MealTypeRow>): Promise<MealTypeRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/meal-types/${id}`, payload);
    return res.data as MealTypeRow;
  },
  async deleteMealType(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/meal-types/${id}`);
  },
};
