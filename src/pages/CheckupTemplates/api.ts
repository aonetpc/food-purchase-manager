import { api } from '@/lib/api';

export type Role = 'male' | 'female_married' | 'female_single';
export const ROLES: Role[] = ['male', 'female_married', 'female_single'];
export const ROLE_LABEL: Record<Role, string> = {
  male: '男性',
  female_married: '已婚女性',
  female_single: '未婚女性',
};
export const ROLE_EMOJI: Record<Role, string> = {
  male: '👨',
  female_married: '👩',
  female_single: '👧',
};
export const ROLE_HINT: Record<Role, string> = {
  male: '含前列腺检查',
  female_married: '含妇科+两癌',
  female_single: '无妇科侵入',
};
export const CATEGORIES = [
  '体格检查',
  '实验室',
  '影像检查',
  '功能检查',
  '肿瘤筛查',
  '妇科专项',
  '特色加项',
];

export interface RolePlan {
  original_total: number;
  discount_price: number;
  discount_rate: number;
  remark?: string | null;
}
export interface CheckupItemRef {
  id: string;
  package_id?: string;
  item_id: string;
  role: 'common' | Role;
  item_name_snapshot: string;
  item_price: number;
  insurance_price_snapshot: number;
  quantity: number;
  remark?: string | null;
  sort_order: number;
  category?: string;
  item_type?: 'item' | 'combo';
}
export interface CheckupTemplate {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  status: 0 | 1;
  sort_order: number;
  owner_sales_id: string | null;
  is_public: boolean;
  base_template_id: string | null;
  applicable_roles: Role[];
  cover_sales_ids: string[];
  has_share: boolean;
  share_expire_at: string | null;
  created_at: string;
  updated_at: string;
  price: number;
  role_price_capsule: Record<Role, RolePlan>;
  role_plans?: Record<Role, RolePlan>;
  role_items?: Record<Role, { total: number; item_count: number; items: CheckupItemRef[] }>;
  items_by_role?: Record<'common' | Role, CheckupItemRef[]>;
  item_count?: number;
}
export interface CheckupItem {
  id: string;
  code: string;
  name: string;
  item_type: 'item' | 'combo';
  category: string;
  description?: string | null;
  default_price: number;
  insurance_price: number;
  unit: string;
  status: 0 | 1;
  sort_order: number;
}
export interface ShareData {
  id: string;
  code: string;
  name: string;
  description: string | null;
  applicable_roles: Role[];
  created_at: string;
  role_price_capsule: Record<Role, RolePlan>;
  role_plans: Record<Role, RolePlan>;
  role_items: Record<Role, { total: number; item_count: number; items: CheckupItemRef[] }>;
}

export interface ShareResult {
  share_token: string;
  expire_at: string;
  expire_days: number;
  share_path: string;
}

export const checkupApi = {
  list: (params?: { scope?: string; keyword?: string }) =>
    api.get<any>('/booking/checkup-templates', { params }),
  create: (body: any) =>
    api.post<any>('/booking/checkup-templates', body),
  get: (id: string) =>
    api.get<any>(`/booking/checkup-templates/${id}`),
  update: (id: string, body: any) =>
    api.put<any>(`/booking/checkup-templates/${id}`, body),
  clone: (id: string, body?: any) =>
    api.post<any>(`/booking/checkup-templates/${id}/clone`, body),
  saveItems: (id: string, body: { items: any[]; role_plans?: Record<string, Partial<RolePlan>> }) =>
    api.put<any>(`/booking/checkup-templates/${id}/items-batch`, body),
  share: (id: string, body?: any) =>
    api.post<any>(`/booking/checkup-templates/${id}/share`, body || {}),
  remove: (id: string) =>
    api.delete<any>(`/booking/checkup-templates/${id}`),
  pdfUrl: (id: string, role?: string, shareToken?: string) => {
    // 如果传入 shareToken（分享场景免登录下载），则走 share 专属免登录 PDF 端点
    if (shareToken) {
      const qs = [role ? `role=${role}` : ''].filter(Boolean).join('&');
      return `/api/booking/checkup-share/${encodeURIComponent(shareToken)}/pdf${qs ? '?' + qs : ''}`;
    }
    const token = (api as any).getToken ? (api as any).getToken() : '';
    const qs = [role ? `role=${role}` : '', token ? `access_token=${encodeURIComponent(token)}` : ''].filter(Boolean).join('&');
    return `/api/booking/checkup-templates/${id}/pdf${qs ? '?' + qs : ''}`;
  },
  listSalesCapsules: (salesId: string) =>
    api.get<any>(`/booking/checkup-templates/sales/${salesId}/capsules`),
  listItems: (params?: any) =>
    api.get<any>('/booking/config/checkup-items', { params }),
  sharePublic: (token: string) =>
    fetch(`/api/booking/checkup-share/${encodeURIComponent(token)}`, { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({ error: '请求失败' })); throw new Error(e.error || 'HTTP ' + r.status); } return r.json(); }),
  sharePublicPdfUrl: (token: string, role?: string) =>
    `/api/booking/checkup-share/${encodeURIComponent(token)}/pdf${role ? `?role=${role}` : ''}`,
};
