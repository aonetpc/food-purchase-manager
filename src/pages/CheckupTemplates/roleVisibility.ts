// 角色可见性规则：关键字兜底 + applicable_roles 字段优先
// 供 WizardItems / PackageDrawer 等多处复用，保持前后端逻辑一致

import type { Role, CheckupItem } from './api';

export type Scope = 'common' | Role;

// 男性专属关键字
export const MALE_ONLY_KEYS = ['前列腺','阴囊','精液','男科','睾丸','勃起','包皮','精索','附睾','PSA','男性激素'];
// 已婚女专属（含侵入性）关键字
export const FM_ONLY_KEYS = ['阴超','阴道B','阴道镜','宫腔镜','妇科内诊','双合诊','白带','宫颈刮片','TCT','液基','HPV','宫颈','阴道'];
// 已婚女+未婚女通用关键字（女性通用）
export const FEMALE_KEYS = ['乳腺','卵巢','子宫','盆腔','附件','性激素','雌激素','孕酮','妇科','妇产科','产前','唐筛','孕检','HCG','人绒毛膜','月经','痛经'];
// 未婚女禁用（已婚女专属，但未命中上述 FM_ONLY_KEYS 的补充）
export const SINGLE_FORBID_KEYS = ['经阴道'];

export function nameHitKeys(name: string, keys: string[]): boolean {
  const n = (name || '').toLowerCase();
  return keys.some(k => n.includes(k.toLowerCase()));
}

// 判断某项目是否对当前 scope 可见
// 优先级：applicable_roles 字段 > 项目名关键字兜底
export function scopeVisible(it: Pick<CheckupItem, 'name' | 'applicable_roles'>, s: Scope): boolean {
  if (s === 'common') return true;
  const name = it.name || '';
  const roles = it.applicable_roles;

  // 优先用字段值
  if (roles && Array.isArray(roles) && roles.length > 0) {
    return roles.includes(s as Role);
  }

  // 否则用关键字兜底
  if (s === 'male') {
    if (nameHitKeys(name, FM_ONLY_KEYS)) return false;
    if (nameHitKeys(name, FEMALE_KEYS)) return false;
    return true;
  }
  if (s === 'female_married') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return false;
    return true;
  }
  if (s === 'female_single') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return false;
    if (nameHitKeys(name, FM_ONLY_KEYS)) return false;
    if (nameHitKeys(name, SINGLE_FORBID_KEYS)) return false;
    return true;
  }
  return true;
}

// 判断某项目是否为「角色专属项」（非全角色通用）
export function isRoleSpecific(it: Pick<CheckupItem, 'name' | 'applicable_roles'>, role: Role): boolean {
  const name = it.name || '';
  if (role === 'male') {
    if (nameHitKeys(name, MALE_ONLY_KEYS)) return true;
  }
  if (role === 'female_married' || role === 'female_single') {
    if (nameHitKeys(name, FM_ONLY_KEYS)) return true;
    if (nameHitKeys(name, FEMALE_KEYS)) return true;
  }
  if (role === 'female_married') {
    if (nameHitKeys(name, SINGLE_FORBID_KEYS)) return true;
  }
  const roles = it.applicable_roles;
  if (roles && Array.isArray(roles) && roles.length > 0 && roles.length < 3) {
    return roles.includes(role);
  }
  return false;
}
