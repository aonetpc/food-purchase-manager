import type { Ingredient } from '@/types';

export const ingredients: Ingredient[] = [
  {
    id: 'ing-1', name: '大白菜', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 3.5,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20chinese%20cabbage%20napa%20cabbage%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-2', name: '小白菜', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 5.8,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20bok%20choy%20pak%20choi%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-3', name: '西红柿', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 8.5,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20red%20tomatoes%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-4', name: '黄瓜', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 6.2,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20green%20cucumbers%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-5', name: '土豆', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 4.2,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20potatoes%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '袋', factor: 20 }]
  },
  {
    id: 'ing-6', name: '胡萝卜', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 4.8,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20carrots%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-7', name: '青椒', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 9.5,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20green%20bell%20peppers%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-8', name: '茄子', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 7.2,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20purple%20eggplants%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-9', name: '菠菜', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 8.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20spinach%20leaves%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '捆', factor: 0.3 }]
  },
  {
    id: 'ing-10', name: '葱姜蒜', categoryId: 'cat-1', baseUnit: '公斤', basePrice: 12.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20ginger%20garlic%20scallion%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-11', name: '猪五花肉', categoryId: 'cat-2', baseUnit: '公斤', basePrice: 38.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20pork%20belly%20meat%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-12', name: '猪里脊', categoryId: 'cat-2', baseUnit: '公斤', basePrice: 45.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20pork%20tenderloin%20meat%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-13', name: '牛肉', categoryId: 'cat-2', baseUnit: '公斤', basePrice: 85.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20beef%20steak%20meat%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-14', name: '鸡肉', categoryId: 'cat-2', baseUnit: '公斤', basePrice: 22.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20raw%20chicken%20meat%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '只', factor: 1.5 }]
  },
  {
    id: 'ing-15', name: '鸭肉', categoryId: 'cat-2', baseUnit: '公斤', basePrice: 28.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20raw%20duck%20meat%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '只', factor: 2 }]
  },
  {
    id: 'ing-16', name: '草鱼', categoryId: 'cat-3', baseUnit: '公斤', basePrice: 18.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20grass%20carp%20fish%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '条', factor: 1.5 }]
  },
  {
    id: 'ing-17', name: '鲫鱼', categoryId: 'cat-3', baseUnit: '公斤', basePrice: 25.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20crucian%20carp%20fish%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '条', factor: 0.4 }]
  },
  {
    id: 'ing-18', name: '虾', categoryId: 'cat-3', baseUnit: '公斤', basePrice: 65.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20shrimp%20prawns%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '盒', factor: 0.5 }]
  },
  {
    id: 'ing-19', name: '生抽酱油', categoryId: 'cat-4', baseUnit: '升', basePrice: 12.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=chinese%20soy%20sauce%20bottle%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '升', factor: 1, isCommon: true }, { unit: '瓶', factor: 0.5, isCommon: true }, { unit: '桶', factor: 5 }]
  },
  {
    id: 'ing-20', name: '食用盐', categoryId: 'cat-4', baseUnit: '公斤', basePrice: 3.5,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=table%20salt%20container%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '袋', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-21', name: '白砂糖', categoryId: 'cat-4', baseUnit: '公斤', basePrice: 8.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=white%20sugar%20in%20bowl%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '袋', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-22', name: '大米', categoryId: 'cat-5', baseUnit: '公斤', basePrice: 6.5,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=white%20rice%20grains%20in%20bowl%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '袋', factor: 25 }]
  },
  {
    id: 'ing-23', name: '面粉', categoryId: 'cat-5', baseUnit: '公斤', basePrice: 5.2,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=wheat%20flour%20in%20bag%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '袋', factor: 25, isCommon: true }]
  },
  {
    id: 'ing-24', name: '食用油', categoryId: 'cat-5', baseUnit: '升', basePrice: 15.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cooking%20oil%20bottle%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '升', factor: 1, isCommon: true }, { unit: '桶', factor: 5, isCommon: true }, { unit: '瓶', factor: 1.8 }]
  },
  {
    id: 'ing-25', name: '鸡蛋', categoryId: 'cat-6', baseUnit: '公斤', basePrice: 12.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20chicken%20eggs%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '个', factor: 0.06 }, { unit: '板', factor: 1.8 }]
  },
  {
    id: 'ing-26', name: '牛奶', categoryId: 'cat-6', baseUnit: '升', basePrice: 12.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20milk%20carton%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '升', factor: 1, isCommon: true }, { unit: '盒', factor: 0.25, isCommon: true }, { unit: '箱', factor: 6 }]
  },
  {
    id: 'ing-27', name: '豆腐', categoryId: 'cat-7', baseUnit: '公斤', basePrice: 6.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20tofu%20blocks%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '块', factor: 0.3, isCommon: true }]
  },
  {
    id: 'ing-28', name: '苹果', categoryId: 'cat-8', baseUnit: '公斤', basePrice: 10.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20red%20apples%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }, { unit: '箱', factor: 10 }]
  },
  {
    id: 'ing-29', name: '香蕉', categoryId: 'cat-8', baseUnit: '公斤', basePrice: 8.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20yellow%20bananas%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
  {
    id: 'ing-30', name: '橙子', categoryId: 'cat-8', baseUnit: '公斤', basePrice: 12.0,
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fresh%20oranges%20on%20white%20background%20food%20photography&image_size=square',
    units: [{ unit: '公斤', factor: 1, isCommon: true }, { unit: '斤', factor: 0.5, isCommon: true }]
  },
];

export const getIngredientById = (id: string): Ingredient | undefined => {
  return ingredients.find(i => i.id === id);
};

export const getIngredientsByCategory = (categoryId: string): Ingredient[] => {
  return ingredients.filter(i => i.categoryId === categoryId);
};
