import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';

export type UserRole = 'admin' | 'viewer';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

interface AuthStore {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAdmin: () => boolean;
  getSession: () => User | null;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      error: null,

      login: async (username: string, password: string) => {
        set({ loading: true, error: null });
        
        try {
          const data = await api.post<any>('/auth/login', { username, password });

          const user: User = {
            id: data.id,
            username: data.username,
            name: data.name,
            role: data.role as UserRole,
          };

          set({ user, loading: false, error: null });
          return true;
        } catch (err: any) {
          set({ loading: false, error: err.message || '登录失败，请检查网络连接' });
          return false;
        }
      },

      logout: () => {
        set({ user: null, error: null });
      },

      isAdmin: () => {
        const user = get().user;
        return user?.role === 'admin';
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