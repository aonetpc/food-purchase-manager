import { createClient } from '@supabase/supabase-js';

// Supabase 配置
// 请替换为你自己的 Supabase 项目 URL 和 anon key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 辅助函数：检查连接状态
export async function checkConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from('categories').select('count').limit(1);
    return !error;
  } catch {
    return false;
  }
}

// 辅助函数：生成唯一 ID（兼容原有逻辑）
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}