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
  hasRole: (role: UserRole | UserRole[]) => boolean;
  canEditCheckupItems: () => boolean;
  canWriteCheckupPackages: () => boolean;
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
        // 复用 hasRole 的完善逻辑：兼容 role 单值 + roles 对象/字符串数组
        return get().hasRole('admin');
      },

      hasRole: (role) => {
        const user = get().user;
        if (!user) return false;
        const codes: UserRole[] = [];
        if (user.role) codes.push(user.role);
        if (Array.isArray(user.roles)) {
          user.roles.forEach(r => {
            if (typeof r === 'string') codes.push(r as UserRole);
            else if (r && typeof (r as any).code === 'string') codes.push((r as any).code);
          });
        }
        const targets = Array.isArray(role) ? role : [role];
        return targets.some(t => codes.includes(t));
      },

      // 体检中心-项目库：仅 admin/boss 可写（与后端 requireBookingAdmin 一致）
      canEditCheckupItems: () => get().hasRole(['admin', 'boss']),

      // 体检中心-套餐库写权限（新建/编辑/克隆/删除）：当前仅 admin + 非 booker 的业务角色可写；
      //     后续如需放开 booker 改自己的套餐，只需修改此函数（不影响后端安全 gate）
      canWriteCheckupPackages: () => {
        if (get().isAdmin()) return true;
        if (get().hasRole('boss')) return true;
        // booker 目前只读（后续可按归属放开）
        if (get().hasRole('booker')) return false;
        // sales / purchaser 等其他业务角色保留原有能力（体检中心前端虽未提供入口，但函数对齐未来扩展）
        return !!get().user;
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
        const seenPaths = new Set<string>();  // ← Phase F3：按 path 去重，防重复菜单（比如月底考核）
        user.permissions.modules.forEach(mod => {
          mod.menus.forEach(menu => {
            if (!menu || !menu.path) return;
            if (seenPaths.has(menu.path)) return;  // 同路径只保留第一个
            seenPaths.add(menu.path);
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

        // 体检相关菜单（booking-board/checkup-templates/checkup-center）
        // 已通过迁移 107 注册到 permissions 表 + role_permissions 分配，
        // 后端 /auth/me 会正常返回，不再需要前端兜底注入。
        // 参考 Hard Constraints #17：新增菜单必须注册 permissions 表，不能靠 authStore 兜底。

        const order = ['/daily', '/monthly', '/yearly', '/ingredients', '/purchase-entry', '/reimbursement', '/warehouse', '/warehouse-purchase', '/supplier-reconciliation', '/inventory', '/stock-movement', '/scan-audit', '/management-report', '/permission', '/ingredient-manager', '/departments', '/temp-positions', '/temp-workers', '/temp-audit', '/temp-assessment', '/temp-stats', '/booking-board', '/checkup-center', '/checkup-templates', '/wecom', '/wecom-test'];
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
