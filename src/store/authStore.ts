import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';

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
          // 查询用户
          const { data, error } = await supabase
            .from('users')
            .select('id, username, name, role')
            .eq('username', username)
            .eq('password_hash', password)
            .single();

          if (error || !data) {
            set({ loading: false, error: '用户名或密码错误' });
            return false;
          }

          const user: User = {
            id: data.id,
            username: data.username,
            name: data.name,
            role: data.role as UserRole,
          };

          set({ user, loading: false, error: null });
          return true;
        } catch (err) {
          set({ loading: false, error: '登录失败，请检查网络连接' });
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