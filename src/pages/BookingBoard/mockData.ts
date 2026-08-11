import type { BookingOrder, BookingItem, OrderStatus, PaxEntry, PackageCode, LodgingType } from './types';
import { CHECKUP_PACKAGES, LODGING_TYPES } from './constants';
import { fmt, addDays, pad, genItemId, genOrderNo, daysBetween, calcCheckupAmount, calcLodgingAmount } from './utils';

const CUSTOMERS = [
  '杭州锐捷科技', '上海绿城集团', '北京中海地产', '苏州金螳螂', '南京万科',
  '浙江物产中大', '宁波雅戈尔', '温州正泰电器', '杭州海康威视', '上海拼多多',
  '阿里健康', '蚂蚁集团', '字节跳动', '网易雷火', '大华股份',
];

const CONTACTS = ['张总', '李经理', '王主任', '赵总', '陈部长', '刘总监', '杨主管', '吴总'];
const PHONES = ['13800138000', '13900139000', '13700137000', '13600136000', '13500135000'];
const SALES = ['李慧', '王芳', '张磊', '陈静', '赵明'];
const PAYMENTS = ['销售担保挂账', '客户现付', '公司结算', '预付定金'];

const PACKAGE_CODES: PackageCode[] = ['A', 'B', 'C', 'D'];
const LODGING_KEYS: LodgingType[] = ['standard', 'bigbed', 'suite', 'vipsuite'];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generatePaxList(count: number): PaxEntry[] {
  const surnames = ['张', '李', '王', '赵', '陈', '刘', '杨', '吴', '周', '徐', '孙', '马'];
  const givenNames = ['伟', '芳', '娜', '敏', '静', '强', '磊', '军', '洋', '勇', '艳', '杰'];
  return Array.from({ length: count }, () => ({
    name: rand(surnames) + rand(givenNames),
    idCard: `3301${randInt(1980, 2000)}${pad(randInt(1, 12))}${pad(randInt(1, 28))}${randInt(1000, 9999)}`,
    phone: `1${rand([3, 5, 7, 8, 9])}${String(randInt(0, 99999999)).padStart(8, '0')}`,
    gender: rand(['男', '女'] as const),
    married: Math.random() > 0.5,
    package: rand(PACKAGE_CODES),
  }));
}

function generateOrder(weekStart: Date, dayOffset: number): BookingOrder {
  const orderDate = addDays(weekStart, dayOffset);
  const items: BookingItem[] = [];
  const numItems = randInt(1, 4);

  const hasCheckup = Math.random() > 0.4;
  const hasLodging = Math.random() > 0.3;
  const hasMeal = Math.random() > 0.4;
  const hasMeeting = Math.random() > 0.7;
  const hasWellness = Math.random() > 0.7;

  if (hasCheckup) {
    const pax = randInt(3, 12);
    const paxList = generatePaxList(pax);
    items.push({
      id: genItemId(),
      itemType: 'checkup',
      date: fmt(orderDate),
      startTime: '08:00',
      pax,
      extra: { paxList, packageTotal: calcCheckupAmount(paxList) },
      amount: calcCheckupAmount(paxList),
    });
  }

  if (hasLodging) {
    const nights = randInt(1, 3);
    const lodgingType = rand(LODGING_KEYS);
    const rooms = randInt(1, 5);
    const checkIn = fmt(orderDate);
    const checkOut = fmt(addDays(orderDate, nights));
    items.push({
      id: genItemId(),
      itemType: 'lodging',
      date: checkIn,
      startTime: '14:00',
      pax: rooms,
      extra: {
        lodgingType,
        dateCheckIn: checkIn,
        dateCheckOut: checkOut,
        arrivalTime: '14:00',
        nights,
      },
      amount: calcLodgingAmount(lodgingType, rooms, nights),
    });
  }

  if (hasMeal) {
    const mealType = rand(['lunch', 'dinner'] as const);
    const sessions = randInt(1, 3);
    const sessionDates = Array.from({ length: sessions }, (_, i) => fmt(addDays(orderDate, i)));
    const tables = randInt(1, 3);
    const perTable = randInt(8, 12);
    items.push({
      id: genItemId(),
      itemType: mealType,
      date: sessionDates[0],
      startTime: mealType === 'lunch' ? '12:00' : '18:00',
      pax: tables,
      extra: {
        dateStart: sessionDates[0],
        dateEnd: sessionDates[sessions - 1],
        defaultTime: mealType === 'lunch' ? '12:00' : '18:00',
        defaultTables: tables,
        defaultPerTable: perTable,
        sessions: sessionDates.map(d => ({ date: d, time: mealType === 'lunch' ? '12:00' : '18:00', tables, perTable })),
      },
      amount: 0, // 用餐金额现场结算
    });
  }

  if (hasMeeting) {
    items.push({
      id: genItemId(),
      itemType: 'meeting',
      date: fmt(orderDate),
      startTime: '09:00',
      pax: randInt(20, 80),
      extra: {
        sessions: [{
          date: fmt(orderDate),
          startTime: '09:00',
          hall: 'siji' as const,
          slotType: 'full' as const,
          pax: randInt(20, 80),
        }],
      },
      amount: 3500,
    });
  }

  if (hasWellness) {
    items.push({
      id: genItemId(),
      itemType: 'wellness',
      date: fmt(orderDate),
      startTime: '15:00',
      pax: randInt(2, 8),
      extra: {
        sessions: [{
          date: fmt(orderDate),
          startTime: '15:00',
          wellnessType: 'mahjong' as const,
          hours: 4,
          pax: randInt(2, 8),
        }],
      },
      amount: 320,
    });
  }

  // 状态分布
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (orderDate.getTime() - today.getTime()) / 86400000;
  let status: OrderStatus;
  if (diff < -1) status = Math.random() > 0.2 ? 'completed' : 'rejected';
  else if (diff === 0) status = rand(['confirmed', 'pending', 'reviewing'] as const);
  else if (diff <= 2) status = rand(['confirmed', 'pending'] as const);
  else status = rand(['pending', 'confirmed'] as const);

  return {
    id: genOrderNo(),
    customerName: rand(CUSTOMERS),
    contactName: rand(CONTACTS),
    contactPhone: rand(PHONES),
    salesPerson: rand(SALES),
    payment: rand(PAYMENTS),
    remark: Math.random() > 0.7 ? 'VIP客户，请注意接待' : '',
    items,
    status,
    createdAt: fmt(addDays(orderDate, -1)) + 'T10:00:00',
  };
}

export function generateMockData(weekStart: Date): BookingOrder[] {
  _resetSeq();
  const orders: BookingOrder[] = [];
  for (let d = 0; d < 7; d++) {
    const count = randInt(2, 5);
    for (let i = 0; i < count; i++) {
      orders.push(generateOrder(weekStart, d));
    }
  }
  return orders;
}

function _resetSeq() {
  // 重置序列号
  (genItemId as any)._seq = 0;
  (genOrderNo as any)._seq = 0;
}
