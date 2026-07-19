import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';

export type UserRole = 'admin' | 'finance' | 'boss' | 'viewer';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  wecomUserId?: string;
}

// 角色权限映射：哪些角色可以查看月度分析
const MONTHLY_ACCESS_ROLES: UserRole[] = ['admin', 'finance', 'boss'];

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
  getSession: () => User | null;
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
            wecomUserId: data.wecom_userid,
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

      // 企微免登
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
            wecomUserId: data.wecomUserId,
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
        return user?.role === 'admin';
      },

      // 是否可以查看月度分析（仅财务、董事长、管理员）
      canViewMonthly: () => {
        const user = get().user;
        return !!user && MONTHLY_ACCESS_ROLES.includes(user.role);
      },

      getSession: () => {
        return get().user;
      },
    }),
    {
      name: 'auth-session',
      partialize: (state) => ({ user: state.user }),
    }
  )
);