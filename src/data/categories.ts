import type { Category } from '@/types';

export const categories: Category[] = [
  { id: 'cat-1', name: '蔬菜类', icon: '🥬', color: '#10b981' },
  { id: 'cat-2', name: '肉类', icon: '🥩', color: '#ef4444' },
  { id: 'cat-3', name: '水产类', icon: '🐟', color: '#3b82f6' },
  { id: 'cat-4', name: '调料类', icon: '🧂', color: '#f59e0b' },
  { id: 'cat-5', name: '粮油类', icon: '🍚', color: '#a855f7' },
  { id: 'cat-6', name: '蛋奶类', icon: '🥚', color: '#ec4899' },
  { id: 'cat-7', name: '豆制品', icon: '🧈', color: '#14b8a6' },
  { id: 'cat-8', name: '水果类', icon: '🍎', color: '#f97316' },
];

export const getCategoryById = (id: string): Category | undefined => {
  return categories.find(c => c.id === id);
};
