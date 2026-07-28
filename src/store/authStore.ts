import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';

export type UserRole = 'admin' | 'finance' | 'boss' | 'viewer' | 'temp_auditor' | 'temp_chairman';

export interface MenuItem {
  code: string;
  name: string;
  path: string;
  icon: string;
}

export interface ActionItem {
  code: string;
  name: string;
}

export interface ModulePermissions {
  code: string;
  name: string;
  icon?: string;
  menus: MenuItem[];
  actions: ActionItem[];
}

export interface UserPermissions {
  modules: ModulePermissions[];
  codes: string[];
  menuPaths: string[];
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  role_id: string;
  roles?: string[];
  status: number;
  wecomUserId?: string;
  phone?: string;
  department_id?: string;
  token?: string;
  permissions?: UserPermissions;
}

interface AuthStore {
  user: User | null;
  loading: boolean;
  error: string | null;
  pendingWecomUserId: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  wecomLogin: (code: string) => Promise<{ needBind?: boolean; user?: User }>;
  bindWecom: (userId: string, wecomUserId: string) => Promise<boolean>;
  logout: () => void;
  isAdmin: () => boolean;
  canViewMonthly: () => boolean;
  hasPermission: (permissionCode: string) => boolean;
  getSession: () => User | null;
  getUserMenus: () => MenuItem[];
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      error: null,
      pendingWecomUserId: null,

      login: async (username: string, password: string) => {
        set({ loading: true, error: null });

        try {
          const data = await api.post<any>('/auth/login', { username, password });

          const user: User = {
            id: data.id,
            username: data.username,
            name: data.name,
            role: data.role as UserRole,
            role_id: data.role_id,
            roles: data.roles || [],
            status: data.status,
            wecomUserId: data.wecom_userid,
            phone: data.phone,
            department_id: data.department_id,
            token: data.token,
            permissions: data.permissions,
          };

          set({ user, loading: false, error: null });

          const pendingWecomUserId = get().pendingWecomUserId;
          if (pendingWecomUserId && !user.wecomUserId) {
            await api.post('/auth/bind-wecom', { userId: user.id, wecomUserId: pendingWecomUserId });
            user.wecomUserId = pendingWecomUserId;
            set({ user, pendingWecomUserId: null });
          }

          return true;
        } catch (err: any) {
          set({ loading: false, error: err.message || '登录失败，请检查网络连接' });
          return false;
        }
      },

      wecomLogin: async (code: string) => {
        set({ loading: true, error: null });
        try {
          const data = await api.post<any>('/auth/wecom-login', { code });

          if (data.needBind) {
            set({ loading: false, pendingWecomUserId: data.wecomUserId });
            return { needBind: true };
          }

          const user: User = {
            id: data.id,
            username: data.username,
            name: data.name,
            role: data.role as UserRole,
            role_id: data.role_id,
            roles: data.roles || [],
            status: data.status,
            wecomUserId: data.wecom_userid,
            phone: data.phone,
            department_id: data.department_id,
            token: data.token,
            permissions: data.permissions,
          };

          set({ user, loading: false, error: null });
          return { user };
        } catch (err: any) {
          set({ loading: false, error: err.message || '企微登录失败' });
          throw err;
        }
      },

      logout: () => {
        set({ user: null, error: null, pendingWecomUserId: null });
      },

      bindWecom: async (userId: string, wecomUserId: string) => {
        try {
          await api.post('/auth/bind-wecom', { userId, wecomUserId });
          set({ pendingWecomUserId: null });
          return true;
        } catch (err) {
          console.error('绑定企微失败:', err);
          return false;
        }
      },

      isAdmin: () => {
        const user = get().user;
        if (!user) return false;
        if (user.role === 'admin') return true;
        if (user.roles && user.roles.includes('admin')) return true;
        return false;
      },

      canViewMonthly: () => {
        return get().hasPermission('menu:monthly') || get().hasPermission('menu:m-monthly');
      },

      hasPermission: (permissionCode: string) => {
        const user = get().user;
        if (!user || !user.permissions) return false;
        return user.permissions.codes.includes(permissionCode);
      },

      getSession: () => {
        return get().user;
      },

      getUserMenus: () => {
        const user = get().user;
        if (!user || !user.permissions) return [];

        const menus: MenuItem[] = [];
        user.permissions.modules.forEach(mod => {
          mod.menus.forEach(menu => {
            menus.push(menu);
          });
        });

        return menus.sort((a, b) => {
      const order = ['/daily', '/monthly', '/yearly', '/ingredients', '/purchase-entry', '/reimbursement', '/warehouse', '/inventory', '/stock-movement', '/users', '/roles', '/categories', '/ingredient-manager', '/departments', '/temp-positions', '/temp-auditors', '/temp-workers', '/temp-audit', '/temp-assessment', '/temp-stats', '/wecom'];
      const aIdx = order.indexOf(a.path) >= 0 ? order.indexOf(a.path) : 100;
      const bIdx = order.indexOf(b.path) >= 0 ? order.indexOf(b.path) : 100;
      return aIdx - bIdx;
    });
      },
    }),
    {
      name: 'auth-session-v2',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
