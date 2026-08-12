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

export interface BookingConfig {
  packages: PackageRow[];
  roomTypes: RoomTypeRow[];
  meetingHalls: MeetingHallRow[];
  wellnessTypes: WellnessTypeRow[];
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

  // 提交审核
  async submitOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/submit`, {});
    return fromBackend(res.data);
  },

  // 审核通过
  async approveOrder(id: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/approve`, {});
    return fromBackend(res.data);
  },

  // 驳回
  async rejectOrder(id: string, rejectionReason: string): Promise<BookingApiOrder> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/orders/${id}/reject`, { rejectionReason });
    return fromBackend(res.data);
  },

  // 标记完成
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
    return {
      packages: (res.data?.packages || []).map(fromBackend),
      roomTypes: (res.data?.roomTypes || []).map(fromBackend),
      meetingHalls: (res.data?.meetingHalls || []).map(fromBackend),
      wellnessTypes: (res.data?.wellnessTypes || []).map(fromBackend),
      salesUsers: (res.data?.salesUsers || []).map(fromBackend),
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
  async listCheckupItems(): Promise<CheckupItemRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/checkup-items');
    return (res.data || []).map(fromBackend) as CheckupItemRow[];
  },
  async createCheckupItem(payload: Partial<CheckupItemRow>): Promise<CheckupItemRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/checkup-items', payload);
    return fromBackend(res.data) as CheckupItemRow;
  },
  async updateCheckupItem(id: string, payload: Partial<CheckupItemRow>): Promise<CheckupItemRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/checkup-items/${id}`, payload);
    return fromBackend(res.data) as CheckupItemRow;
  },
  async deleteCheckupItem(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/checkup-items/${id}`);
  },

  // ===== 套餐项目（子资源）CRUD =====
  async listPackageItems(pkgId: string): Promise<PackageItemRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>(`/booking/config/packages/${pkgId}/items`);
    return (res.data || []).map(fromBackend) as PackageItemRow[];
  },
  async addPackageItem(pkgId: string, payload: { item_id: string; item_price?: number; quantity?: number; sort_order?: number }): Promise<PackageItemRow> {
    const res = await api.post<{ ok: boolean; data: any }>(`/booking/config/packages/${pkgId}/items`, payload);
    return fromBackend(res.data) as PackageItemRow;
  },
  async updatePackageItem(pkgId: string, id: string, payload: { item_price?: number; quantity?: number; sort_order?: number }): Promise<PackageItemRow> {
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

  async listRoomTypes(): Promise<RoomTypeRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/room-types');
    return (res.data || []).map(fromBackend) as RoomTypeRow[];
  },
  async createRoomType(payload: Partial<RoomTypeRow>): Promise<RoomTypeRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/room-types', payload);
    return fromBackend(res.data) as RoomTypeRow;
  },
  async updateRoomType(id: string, payload: Partial<RoomTypeRow>): Promise<RoomTypeRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/room-types/${id}`, payload);
    return fromBackend(res.data) as RoomTypeRow;
  },
  async deleteRoomType(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/room-types/${id}`);
  },

  async listMeetingHalls(): Promise<MeetingHallRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/meeting-halls');
    return (res.data || []).map(fromBackend) as MeetingHallRow[];
  },
  async createMeetingHall(payload: Partial<MeetingHallRow>): Promise<MeetingHallRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/meeting-halls', payload);
    return fromBackend(res.data) as MeetingHallRow;
  },
  async updateMeetingHall(id: string, payload: Partial<MeetingHallRow>): Promise<MeetingHallRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/meeting-halls/${id}`, payload);
    return fromBackend(res.data) as MeetingHallRow;
  },
  async deleteMeetingHall(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/meeting-halls/${id}`);
  },

  async listWellnessTypes(): Promise<WellnessTypeRow[]> {
    const res = await api.get<{ ok: boolean; data: any[] }>('/booking/config/wellness-types');
    return (res.data || []).map(fromBackend) as WellnessTypeRow[];
  },
  async createWellnessType(payload: Partial<WellnessTypeRow>): Promise<WellnessTypeRow> {
    const res = await api.post<{ ok: boolean; data: any }>('/booking/config/wellness-types', payload);
    return fromBackend(res.data) as WellnessTypeRow;
  },
  async updateWellnessType(id: string, payload: Partial<WellnessTypeRow>): Promise<WellnessTypeRow> {
    const res = await api.put<{ ok: boolean; data: any }>(`/booking/config/wellness-types/${id}`, payload);
    return fromBackend(res.data) as WellnessTypeRow;
  },
  async deleteWellnessType(id: string): Promise<void> {
    await api.delete<{ ok: boolean }>(`/booking/config/wellness-types/${id}`);
  },
};
