import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';

export type UserRole = 'admin' | 'finance' | 'boss' | 'viewer' | 'temp_auditor' | 'temp_chairman' | 'purchaser' | 'booker' | 'sales';

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

        const rawMenus: MenuItem[] = [];
        user.permissions.modules.forEach(mod => {
          mod.menus.forEach(menu => {
            rawMenus.push(menu);
          });
        });

        // 兼容合并：将旧的 /users + /roles 菜单项合并为 /permission（权限管理）
        const hasUsers = rawMenus.some(m => m.path === '/users');
        const hasRoles = rawMenus.some(m => m.path === '/roles');
        const hasPermission = rawMenus.some(m => m.path === '/permission');
        const mergedMenus: MenuItem[] = [];
        let permissionInjected = false;

        rawMenus.forEach(menu => {
          if (menu.path === '/users' || menu.path === '/roles') {
            if (!permissionInjected && !hasPermission && (hasUsers || hasRoles)) {
              mergedMenus.push({
                code: 'menu:permission',
                name: '权限管理',
                path: '/permission',
                icon: 'Shield',
              });
              permissionInjected = true;
            }
            // 丢弃旧的 /users 和 /roles 独立菜单
          } else {
            mergedMenus.push(menu);
          }
        });

        // 如果后端已经直接返回了 /permission，也保留它（确保不会被上面漏掉）
        if (hasPermission && !mergedMenus.some(m => m.path === '/permission')) {
          const perm = rawMenus.find(m => m.path === '/permission');
          if (perm) mergedMenus.push(perm);
        }

        // 同样兼容：旧的 /categories 已经被重定向到 /ingredient-manager#categories
        // 如果有 /categories 但没有 /ingredient-manager，合并成 menu:ingredient-manager
        const hasCategories = mergedMenus.some(m => m.path === '/categories');
        const hasIngredientManager = mergedMenus.some(m => m.path === '/ingredient-manager');
        if (hasCategories && !hasIngredientManager) {
          const idxToRemove = mergedMenus.findIndex(m => m.path === '/categories');
          if (idxToRemove >= 0) mergedMenus.splice(idxToRemove, 1);
          mergedMenus.push({
            code: 'menu:ingredient-manager',
            name: '食材管理',
            path: '/ingredient-manager',
            icon: 'Package',
          });
        } else if (hasCategories && hasIngredientManager) {
          // 两者都有时，丢弃旧的 /categories 独立菜单
          const idxToRemove = mergedMenus.findIndex(m => m.path === '/categories');
          if (idxToRemove >= 0) mergedMenus.splice(idxToRemove, 1);
        }

        // 兼容兜底：确保 menu:booking-board 和 menu:checkup-templates 至少在管理员能看到时被注入
        const userRoles = user?.roles?.map((r: any) => typeof r === 'string' ? r : r.code) || [];
        const isAdmin = userRoles.includes('admin') || userRoles.includes('ADMIN') ||
                        userRoles.includes('超级管理员') || (user as any)?.isAdmin;
        const hasAdminLevelMenu = mergedMenus.some(m =>
          ['/permission', '/departments', '/wecom', '/wecom-test', '/ingredient-manager'].includes(m.path)
        );
        const isManagerUser = isAdmin || hasAdminLevelMenu;

        // 预订调度：仅管理员或有管理级权限的用户可见
        if (!mergedMenus.some(m => m.path === '/booking-board') && isManagerUser) {
          mergedMenus.push({
            code: 'menu:booking-board',
            name: '预订调度',
            path: '/booking-board',
            icon: 'Calendar',
          });
        }
        // 体检配单：所有已登录用户可见（用于 PC 端跳板跳转移动端）
        if (!mergedMenus.some(m => m.path === '/checkup-templates') && user) {
          mergedMenus.push({
            code: 'menu:checkup-templates',
            name: '体检配单',
            path: '/checkup-templates',
            icon: 'Stethoscope',
          });
        }

        const order = ['/daily', '/monthly', '/yearly', '/ingredients', '/purchase-entry', '/reimbursement', '/warehouse', '/warehouse-purchase', '/supplier-reconciliation', '/inventory', '/stock-movement', '/scan-audit', '/management-report', '/permission', '/ingredient-manager', '/departments', '/temp-positions', '/temp-workers', '/temp-audit', '/temp-assessment', '/temp-stats', '/booking-board', '/wecom', '/wecom-test'];
        return mergedMenus.sort((a, b) => {
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
