/**
 * 本地缓存工具 - 减少 Supabase 请求次数，提升加载速度
 */

const CACHE_PREFIX = 'fpm_cache_';
const CACHE_EXPIRY_MS = 30 * 60 * 1000; // 30分钟过期

interface CacheItem<T> {
  data: T;
  timestamp: number;
  version: string;
}

// 当前数据版本（数据结构变化时更新）
const DATA_VERSION = '1.0';

export const cache = {
  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;

      const item: CacheItem<T> = JSON.parse(raw);

      // 检查版本和过期时间
      if (item.version !== DATA_VERSION) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }

      if (Date.now() - item.timestamp > CACHE_EXPIRY_MS) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }

      return item.data;
    } catch {
      return null;
    }
  },

  /**
   * 设置缓存数据
   */
  set<T>(key: string, data: T): void {
    try {
      const item: CacheItem<T> = {
        data,
        timestamp: Date.now(),
        version: DATA_VERSION,
      };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(item));
    } catch {
      // localStorage 满了，清理旧缓存
      cache.clear();
    }
  },

  /**
   * 清除所有缓存
   */
  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch {}
  },

  /**
   * 清除特定缓存
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch {}
  },
};