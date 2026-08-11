import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  X,
  Upload,
  Download,
  Save,
  Send,
  Pencil,
  FileSpreadsheet,
  Eraser,
  AlertCircle,
  CheckCircle,
  ClipboardList,
  ChevronDown,
} from 'lucide-react';
import type {
  BookingOrder,
  BookingItem,
  BizType,
  PaxEntry,
  PackageCode,
  LodgingType,
  MealSession,
  MeetingSession,
  WellnessSession,
} from './types';
import {
  BIZ_MAP,
  MANUAL_BIZ_TYPES,
  CHECKUP_PACKAGES,
  LODGING_TYPES,
  MEETING_HALLS,
  WELLNESS_TYPES,
  PAYMENT_OPTIONS,
  LODGING_NAME_MAP,
  HALL_NAME_MAP,
  WELLNESS_NAME_MAP,
  PACKAGE_NAME_MAP,
} from './constants';
import {
  fmt,
  addDays,
  todayStr,
  daysBetween,
  genItemId,
  genOrderNo,
  calcCheckupAmount,
  calcLodgingAmount,
  calcMeetingAmount,
  calcWellnessAmount,
  parseCSV,
  toCSV,
  downloadFile,
  groupTotal,
} from './utils';
import { bookingApi, type BookingSalesUser } from '../../lib/api';

// ================================================
// 样式常量
// ================================================
const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const labelCls = 'block text-xs text-gray-500 mb-1.5';
const cellInput =
  'bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-900 text-xs focus:outline-none focus:border-green-500 w-full';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors';

// ================================================
// 本地工具函数
// ================================================

// 按 YYYY-MM-DD 本地解析，避免时区偏移
function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function emptyPax(): PaxEntry {
  return { name: '', idCard: '', phone: '', gender: '男', married: false, package: 'A' };
}

// 根据日期范围生成用餐场次
function genMealSessions(
  dateStart: string,
  dateEnd: string,
  time: string,
  tables: number,
  perTable: number,
): MealSession[] {
  if (!dateStart || !dateEnd) return [];
  const n = daysBetween(dateStart, dateEnd);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => ({
    date: fmt(addDays(parseDateLocal(dateStart), i)),
    time,
    tables,
    perTable,
  }));
}

// 复制为新单：清日期、保配置、重算金额
function copyItemsForCopy(src: BookingOrder): BookingItem[] {
  return src.items.map((it) => {
    const extra = { ...it.extra };
    let date = '';
    let startTime = '';
    let amount = 0;
    if (it.itemType === 'checkup') {
      extra.paxList = (extra.paxList || []).map((p) => ({ ...p }));
      extra.packageTotal = calcCheckupAmount(extra.paxList || []);
      amount = extra.packageTotal;
    } else if (it.itemType === 'lodging') {
      extra.dateCheckIn = '';
      extra.dateCheckOut = '';
      extra.arrivalTime = '';
      extra.nights = undefined;
      amount = 0;
    } else if (it.itemType === 'lunch' || it.itemType === 'dinner') {
      extra.dateStart = '';
      extra.dateEnd = '';
      extra.sessions = (extra.sessions || []).map((s) => ({ ...s, date: '' }));
      amount = 0;
    } else if (it.itemType === 'meeting') {
      extra.sessions = (extra.sessions || []).map((s) => ({ ...s, date: '' }));
      amount = (extra.sessions || []).reduce(
        (sum, s) => sum + calcMeetingAmount(s.hall, s.slotType),
        0,
      );
    } else if (it.itemType === 'wellness') {
      extra.sessions = (extra.sessions || []).map((s) => ({ ...s, date: '' }));
      amount = (extra.sessions || []).reduce(
        (sum, s) => sum + calcWellnessAmount(s.wellnessType, s.hours),
        0,
      );
    }
    return { ...it, id: genItemId(), date, startTime, extra, amount };
  });
}

// 解析整单导入文本，按 [SHEET:xxx] 分段
function parseOrderImport(text: string): Record<string, string[][]> {
  const rows = parseCSV(text);
  const sections: Record<string, string[][]> = {};
  let current = '';
  for (const row of rows) {
    if (row.length === 0) continue;
    const m = row[0].match(/^\[SHEET:([^\]]+)\]/);
    if (m) {
      current = m[1].trim();
      sections[current] = [];
    } else if (current) {
      sections[current].push(row);
    }
  }
  return sections;
}

function colGetter(headers: string[], row: string[]) {
  return (name: string) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? row[idx] || '' : '';
  };
}

function parsePackage(raw: string): PackageCode {
  const v = (raw || '').trim();
  if (!v) return 'A';
  const up = v.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(up[0])) return up[0] as PackageCode;
  if (PACKAGE_NAME_MAP[v]) return PACKAGE_NAME_MAP[v];
  return 'A';
}

// 项目摘要
function itemSummary(item: BookingItem): { main: string; sub: string } {
  let main = '';
  let sub = '';
  if (item.itemType === 'checkup') {
    main = `${item.date} ${item.startTime}`;
    const pkgs = (item.extra.paxList || []).reduce(
      (acc, p) => {
        acc[p.package] = (acc[p.package] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    sub = `${item.pax}人 · ${Object.entries(pkgs)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ')}`;
  } else if (item.itemType === 'lodging') {
    main = `${item.extra.dateCheckIn || '-'} → ${item.extra.dateCheckOut || '-'}`;
    sub = `${LODGING_TYPES[item.extra.lodgingType || 'standard'].name} ${item.pax}间 · ${
      item.extra.nights || 0
    }晚`;
  } else if (item.itemType === 'lunch' || item.itemType === 'dinner') {
    main = `${item.extra.dateStart || '-'} → ${item.extra.dateEnd || '-'}`;
    sub = `${(item.extra.sessions || []).length}场 · ${item.extra.defaultTables || 0}桌×${
      item.extra.defaultPerTable || 0
    }人`;
  } else if (item.itemType === 'meeting') {
    const ss = item.extra.sessions || [];
    main = `${ss[0]?.date || item.date} · ${ss.length}场`;
    sub = ss.map((s) => MEETING_HALLS[s.hall].name).join('、');
  } else if (item.itemType === 'wellness') {
    const ss = item.extra.sessions || [];
    main = `${ss[0]?.date || item.date} · ${ss.length}场`;
    sub = ss.map((s) => `${WELLNESS_TYPES[s.wellnessType].name} ${s.hours}h`).join('、');
  }
  return { main, sub };
}

// ================================================
// 抽屉状态
// ================================================
interface DrawerState {
  open: boolean;
  mode: 'select' | 'form';
  itemType: BizType | null;
  editIdx: number;
}

interface ImportResult {
  msg: string;
  warnings: string[];
}

// ================================================
// 主组件
// ================================================
export default function BookingBoardCreate(props: {
  mode: 'create' | 'edit' | 'copy';
  order?: BookingOrder;
  onClose: () => void;
  onSaved: (order: BookingOrder) => Promise<void> | void;
}) {
  const { mode, order, onClose, onSaved } = props;
  const editOrder = mode === 'edit' ? order : undefined;
  const copySource = mode === 'copy' ? order : undefined;
  const isEdit = mode === 'edit';
  const isCopy = mode === 'copy';

  // 订单草稿（客户信息 + 业务项目）
  const [draftGroup, setDraftGroup] = useState<BookingOrder>(() => {
    if (editOrder) {
      return JSON.parse(JSON.stringify(editOrder)) as BookingOrder;
    }
    if (copySource) {
      return {
        id: '',
        customerName: '',
        contactName: '',
        contactPhone: '',
        salesPerson: copySource.salesPerson,
        salesPersonId: copySource.salesPersonId,
        payment: copySource.payment,
        remark: copySource.remark,
        items: copyItemsForCopy(copySource),
        status: 'pending',
        createdAt: '',
      };
    }
    return {
      id: '',
      customerName: '',
      contactName: '',
      contactPhone: '',
      salesPerson: '',
      salesPersonId: undefined,
      payment: PAYMENT_OPTIONS[0],
      remark: '',
      items: [],
      status: 'pending',
      createdAt: '',
    };
  });

  // 抽屉
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: 'select',
    itemType: null,
    editIdx: -1,
  });

  // 体检表单
  const [chkDate, setChkDate] = useState(todayStr());
  const [chkTime, setChkTime] = useState('08:00');
  const [chkPax, setChkPax] = useState<PaxEntry[]>([emptyPax()]);
  const [showChkPaste, setShowChkPaste] = useState(false);
  const [chkPasteText, setChkPasteText] = useState('');

  // 住宿表单
  const [lgIn, setLgIn] = useState(todayStr());
  const [lgOut, setLgOut] = useState(fmt(addDays(new Date(), 1)));
  const [lgArr, setLgArr] = useState('14:00');
  const [lgType, setLgType] = useState<LodgingType>('standard');
  const [lgRooms, setLgRooms] = useState(1);

  // 用餐表单
  const [mlStart, setMlStart] = useState(todayStr());
  const [mlEnd, setMlEnd] = useState(todayStr());
  const [mlTime, setMlTime] = useState('12:00');
  const [mlTables, setMlTables] = useState(1);
  const [mlPerTable, setMlPerTable] = useState(10);
  const [mlSessions, setMlSessions] = useState<MealSession[]>([]);

  // 会务表单
  const [mtSessions, setMtSessions] = useState<MeetingSession[]>([]);

  // 康乐表单
  const [wlSessions, setWlSessions] = useState<WellnessSession[]>([]);

  // 页面状态
  const [err, setErr] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 销售员列表（从后端拉取，仅含 sales 角色的用户）
  const [salesUsers, setSalesUsers] = useState<BookingSalesUser[]>([]);
  const [salesPickerOpen, setSalesPickerOpen] = useState(false);

  // 拉取销售员列表（仅一次）
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await bookingApi.getConfig();
        if (mounted && Array.isArray(cfg.salesUsers)) {
          setSalesUsers(cfg.salesUsers);
        }
      } catch (e) {
        // 静默失败，不影响表单使用
      }
    })();
    return () => { mounted = false; };
  }, []);

  // 用餐场次自动生成（日期范围 / 默认值变化时）
  useEffect(() => {
    if (!drawer.open || (drawer.itemType !== 'lunch' && drawer.itemType !== 'dinner')) return;
    if (!mlStart || !mlEnd) {
      setMlSessions([]);
      return;
    }
    const n = daysBetween(mlStart, mlEnd);
    if (n < 0) {
      setMlSessions([]);
      return;
    }
    setMlSessions((prev) =>
      Array.from({ length: n + 1 }, (_, i) => {
        const d = fmt(addDays(parseDateLocal(mlStart), i));
        const ex = prev.find((s) => s.date === d);
        return {
          date: d,
          time: ex?.time ?? mlTime,
          tables: ex?.tables ?? mlTables,
          perTable: ex?.perTable ?? mlPerTable,
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlStart, mlEnd, mlTime, mlTables, mlPerTable, drawer.open, drawer.itemType]);

  // 总金额
  const totalAmount = useMemo(() => groupTotal(draftGroup), [draftGroup]);

  // 抽屉内实时金额
  const drawerAmount = useMemo(() => {
    const t = drawer.itemType;
    if (!t) return 0;
    if (t === 'checkup') return calcCheckupAmount(chkPax.filter((p) => p.name.trim()));
    if (t === 'lodging')
      return calcLodgingAmount(lgType, lgRooms, Math.max(0, daysBetween(lgIn, lgOut)));
    if (t === 'lunch' || t === 'dinner') return 0;
    if (t === 'meeting')
      return mtSessions.reduce((s, x) => s + calcMeetingAmount(x.hall, x.slotType), 0);
    if (t === 'wellness')
      return wlSessions.reduce((s, x) => s + calcWellnessAmount(x.wellnessType, x.hours), 0);
    return 0;
  }, [drawer.itemType, chkPax, lgType, lgRooms, lgIn, lgOut, mtSessions, wlSessions]);

  // ================================================
  // 抽屉操作
  // ================================================
  function openAdd() {
    setDrawer({ open: true, mode: 'select', itemType: null, editIdx: -1 });
  }

  function selectBizType(type: BizType) {
    setDrawer({ open: true, mode: 'form', itemType: type, editIdx: -1 });
    if (type === 'checkup') {
      setChkDate(todayStr());
      setChkTime('08:00');
      setChkPax([emptyPax()]);
    } else if (type === 'lodging') {
      setLgIn(todayStr());
      setLgOut(fmt(addDays(new Date(), 1)));
      setLgArr('14:00');
      setLgType('standard');
      setLgRooms(1);
    } else if (type === 'lunch' || type === 'dinner') {
      const t = type === 'lunch' ? '12:00' : '18:00';
      setMlStart(todayStr());
      setMlEnd(todayStr());
      setMlTime(t);
      setMlTables(1);
      setMlPerTable(10);
      setMlSessions(genMealSessions(todayStr(), todayStr(), t, 1, 10));
    } else if (type === 'meeting') {
      setMtSessions([
        { date: todayStr(), startTime: '09:00', hall: 'siji', slotType: 'full', pax: 20 },
      ]);
    } else if (type === 'wellness') {
      setWlSessions([
        { date: todayStr(), startTime: '15:00', wellnessType: 'mahjong', hours: 4, pax: 2 },
      ]);
    }
  }

  function openEdit(item: BookingItem, idx: number) {
    setDrawer({ open: true, mode: 'form', itemType: item.itemType, editIdx: idx });
    if (item.itemType === 'checkup') {
      setChkDate(item.date || todayStr());
      setChkTime(item.startTime || '08:00');
      setChkPax((item.extra.paxList || []).map((p) => ({ ...p })));
    } else if (item.itemType === 'lodging') {
      setLgIn(item.extra.dateCheckIn || todayStr());
      setLgOut(item.extra.dateCheckOut || fmt(addDays(new Date(), 1)));
      setLgArr(item.extra.arrivalTime || '14:00');
      setLgType(item.extra.lodgingType || 'standard');
      setLgRooms(item.pax || 1);
    } else if (item.itemType === 'lunch' || item.itemType === 'dinner') {
      setMlStart(item.extra.dateStart || todayStr());
      setMlEnd(item.extra.dateEnd || todayStr());
      setMlTime(item.extra.defaultTime || (item.itemType === 'lunch' ? '12:00' : '18:00'));
      setMlTables(item.extra.defaultTables ?? 1);
      setMlPerTable(item.extra.defaultPerTable ?? 10);
      setMlSessions((item.extra.sessions || []).map((s) => ({ ...s })));
    } else if (item.itemType === 'meeting') {
      setMtSessions((item.extra.sessions || []).map((s) => ({ ...s })));
    } else if (item.itemType === 'wellness') {
      setWlSessions((item.extra.sessions || []).map((s) => ({ ...s })));
    }
  }

  function closeDrawer() {
    setDrawer({ open: false, mode: 'select', itemType: null, editIdx: -1 });
  }

  function updChkPax(idx: number, patch: Partial<PaxEntry>) {
    setChkPax((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function saveDrawer() {
    const itemType = drawer.itemType;
    if (!itemType) return;
    let item: BookingItem;
    const keepId =
      drawer.editIdx >= 0 && drawer.editIdx < draftGroup.items.length
        ? draftGroup.items[drawer.editIdx].id
        : genItemId();

    if (itemType === 'checkup') {
      const paxList = chkPax.filter((p) => p.name.trim());
      if (paxList.length === 0) {
        setErr('请至少添加一名体检人员');
        return;
      }
      const amount = calcCheckupAmount(paxList);
      item = {
        id: keepId,
        itemType,
        date: chkDate,
        startTime: chkTime,
        pax: paxList.length,
        extra: { paxList, packageTotal: amount },
        amount,
      };
    } else if (itemType === 'lodging') {
      const nights = Math.max(0, daysBetween(lgIn, lgOut));
      const amount = calcLodgingAmount(lgType, lgRooms, nights);
      item = {
        id: keepId,
        itemType,
        date: lgIn,
        startTime: lgArr,
        pax: lgRooms,
        extra: {
          lodgingType: lgType,
          dateCheckIn: lgIn,
          dateCheckOut: lgOut,
          arrivalTime: lgArr,
          nights,
        },
        amount,
      };
    } else if (itemType === 'lunch' || itemType === 'dinner') {
      const sessions = mlSessions.filter((s) => s.date);
      item = {
        id: keepId,
        itemType,
        date: mlStart,
        startTime: mlTime,
        pax: sessions.reduce((s, x) => s + x.tables, 0),
        extra: {
          dateStart: mlStart,
          dateEnd: mlEnd,
          defaultTime: mlTime,
          defaultTables: mlTables,
          defaultPerTable: mlPerTable,
          sessions,
        },
        amount: 0,
      };
    } else if (itemType === 'meeting') {
      const sessions = mtSessions.filter((s) => s.date);
      if (sessions.length === 0) {
        setErr('请至少添加一场会务');
        return;
      }
      const amount = sessions.reduce((s, x) => s + calcMeetingAmount(x.hall, x.slotType), 0);
      item = {
        id: keepId,
        itemType,
        date: sessions[0].date,
        startTime: sessions[0].startTime,
        pax: sessions.reduce((s, x) => s + x.pax, 0),
        extra: { sessions },
        amount,
      };
    } else {
      // wellness
      const sessions = wlSessions.filter((s) => s.date);
      if (sessions.length === 0) {
        setErr('请至少添加一场康乐');
        return;
      }
      const amount = sessions.reduce((s, x) => s + calcWellnessAmount(x.wellnessType, x.hours), 0);
      item = {
        id: keepId,
        itemType,
        date: sessions[0].date,
        startTime: sessions[0].startTime,
        pax: sessions.reduce((s, x) => s + x.pax, 0),
        extra: { sessions },
        amount,
      };
    }

    setDraftGroup((g) => {
      const items = [...g.items];
      if (drawer.editIdx >= 0 && drawer.editIdx < items.length) {
        items[drawer.editIdx] = item;
      } else {
        items.push(item);
      }
      return { ...g, items };
    });
    setErr('');
    closeDrawer();
  }

  function deleteItem(idx: number) {
    setDraftGroup((g) => ({ ...g, items: g.items.filter((_, i) => i !== idx) }));
  }

  // ================================================
  // 整单导入 / 模板 / 清空
  // ================================================
  function downloadTemplate() {
    const lines = [
      '[SHEET:订单主表]',
      '客户名称,联系人,联系电话,销售员,付款方式,备注',
      '杭州锐捷科技,张总,13800138000,李慧,销售担保挂账,VIP客户',
      '',
      '[SHEET:体检名单]',
      '姓名,身份证号,手机号,性别,婚否,套餐',
      '张伟,3301198501011234,13800138000,男,是,B',
      '',
      '[SHEET:住宿]',
      '入住日期,离店日期,到达时间,房型,间数',
      '2026-08-10,2026-08-12,14:00,标准间,2',
      '',
      '[SHEET:用餐]',
      '类型,开始日期,结束日期,默认时间,桌数,每桌人数',
      '午餐,2026-08-10,2026-08-10,12:00,2,10',
      '',
      '[SHEET:会务]',
      '日期,开始时间,会议厅,时段,人数',
      '2026-08-10,09:00,四季厅,全天,80',
      '',
      '[SHEET:康乐]',
      '日期,开始时间,项目,小时,人数',
      '2026-08-10,15:00,棋牌室,4,4',
    ];
    downloadFile('订单导入模板.csv', lines.join('\n'));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleImportFile(f);
    e.target.value = '';
  }

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const sections = parseOrderImport(text);
        const warnings: string[] = [];
        const newItems: BookingItem[] = [];
        const customer = {
          customerName: '',
          contactName: '',
          contactPhone: '',
          salesPerson: '',
          payment: '',
          remark: '',
        };

        // 主表
        const mainRows = sections['订单主表'] || [];
        if (mainRows.length >= 2) {
          const get = colGetter(mainRows[0], mainRows[1]);
          customer.customerName = get('客户名称');
          customer.contactName = get('联系人');
          customer.contactPhone = get('联系电话');
          customer.salesPerson = get('销售员');
          customer.payment = get('付款方式');
          customer.remark = get('备注');
        } else {
          warnings.push('缺少 [SHEET:订单主表]');
        }

        // 体检名单
        const chkRows = sections['体检名单'] || [];
        if (chkRows.length >= 2) {
          const headers = chkRows[0];
          const paxList: PaxEntry[] = [];
          for (let i = 1; i < chkRows.length; i++) {
            const r = chkRows[i];
            if (!r[0]) continue;
            const get = colGetter(headers, r);
            paxList.push({
              name: get('姓名'),
              idCard: get('身份证号'),
              phone: get('手机号'),
              gender: get('性别') === '女' ? '女' : '男',
              married: ['是', 'true', '1', '已婚'].includes(get('婚否').trim()),
              package: parsePackage(get('套餐')),
            });
          }
          if (paxList.length) {
            const date = todayStr();
            newItems.push({
              id: genItemId(),
              itemType: 'checkup',
              date,
              startTime: '08:00',
              pax: paxList.length,
              extra: { paxList, packageTotal: calcCheckupAmount(paxList) },
              amount: calcCheckupAmount(paxList),
            });
          }
        }

        // 住宿
        const lgRows = sections['住宿'] || [];
        for (let i = 1; i < lgRows.length; i++) {
          const r = lgRows[i];
          if (!r[0]) continue;
          const get = colGetter(lgRows[0], r);
          const checkIn = get('入住日期');
          const checkOut = get('离店日期');
          const arrivalTime = get('到达时间') || '14:00';
          const lodgingType = LODGING_NAME_MAP[get('房型')] || 'standard';
          const rooms = parseInt(get('间数')) || 1;
          const nights = checkIn && checkOut ? Math.max(0, daysBetween(checkIn, checkOut)) : 0;
          newItems.push({
            id: genItemId(),
            itemType: 'lodging',
            date: checkIn,
            startTime: arrivalTime,
            pax: rooms,
            extra: { lodgingType, dateCheckIn: checkIn, dateCheckOut: checkOut, arrivalTime, nights },
            amount: calcLodgingAmount(lodgingType, rooms, nights),
          });
        }

        // 用餐
        const mlRows = sections['用餐'] || [];
        for (let i = 1; i < mlRows.length; i++) {
          const r = mlRows[i];
          if (!r[0]) continue;
          const get = colGetter(mlRows[0], r);
          const typeName = get('类型');
          const itemType: BizType = typeName.includes('晚') ? 'dinner' : 'lunch';
          const dateStart = get('开始日期');
          const dateEnd = get('结束日期') || dateStart;
          const defaultTime = get('默认时间') || (itemType === 'lunch' ? '12:00' : '18:00');
          const defaultTables = parseInt(get('桌数')) || 1;
          const defaultPerTable = parseInt(get('每桌人数')) || 10;
          const sessions = genMealSessions(dateStart, dateEnd, defaultTime, defaultTables, defaultPerTable);
          newItems.push({
            id: genItemId(),
            itemType,
            date: dateStart,
            startTime: defaultTime,
            pax: sessions.reduce((s, x) => s + x.tables, 0),
            extra: { dateStart, dateEnd, defaultTime, defaultTables, defaultPerTable, sessions },
            amount: 0,
          });
        }

        // 会务
        const mtRows = sections['会务'] || [];
        const mtSess: MeetingSession[] = [];
        for (let i = 1; i < mtRows.length; i++) {
          const r = mtRows[i];
          if (!r[0]) continue;
          const get = colGetter(mtRows[0], r);
          const hall = HALL_NAME_MAP[get('会议厅')] || 'siji';
          const slotName = get('时段');
          const slotType: 'half' | 'full' = slotName.includes('半') ? 'half' : 'full';
          mtSess.push({
            date: get('日期'),
            startTime: get('开始时间') || '09:00',
            hall,
            slotType,
            pax: parseInt(get('人数')) || 0,
          });
        }
        if (mtSess.length) {
          newItems.push({
            id: genItemId(),
            itemType: 'meeting',
            date: mtSess[0].date,
            startTime: mtSess[0].startTime,
            pax: mtSess.reduce((s, x) => s + x.pax, 0),
            extra: { sessions: mtSess },
            amount: mtSess.reduce((s, x) => s + calcMeetingAmount(x.hall, x.slotType), 0),
          });
        }

        // 康乐
        const wlRows = sections['康乐'] || [];
        const wlSess: WellnessSession[] = [];
        for (let i = 1; i < wlRows.length; i++) {
          const r = wlRows[i];
          if (!r[0]) continue;
          const get = colGetter(wlRows[0], r);
          const wellnessType = WELLNESS_NAME_MAP[get('项目')] || 'mahjong';
          wlSess.push({
            date: get('日期'),
            startTime: get('开始时间') || '15:00',
            wellnessType,
            hours: parseInt(get('小时')) || 1,
            pax: parseInt(get('人数')) || 0,
          });
        }
        if (wlSess.length) {
          newItems.push({
            id: genItemId(),
            itemType: 'wellness',
            date: wlSess[0].date,
            startTime: wlSess[0].startTime,
            pax: wlSess.reduce((s, x) => s + x.pax, 0),
            extra: { sessions: wlSess },
            amount: wlSess.reduce((s, x) => s + calcWellnessAmount(x.wellnessType, x.hours), 0),
          });
        }

        if (newItems.length === 0 && !customer.customerName) {
          setImportResult({ msg: '未识别到有效数据', warnings });
          return;
        }

        // 导入的销售员姓名尝试匹配 salesUsers 以补全 salesPersonId
        const matchedSalesUser = customer.salesPerson
          ? salesUsers.find((u) => (u.name || u.username || '') === customer.salesPerson)
          : undefined;

        setDraftGroup((g) => ({
          ...g,
          customerName: customer.customerName || g.customerName,
          contactName: customer.contactName || g.contactName,
          contactPhone: customer.contactPhone || g.contactPhone,
          salesPerson: customer.salesPerson || g.salesPerson,
          salesPersonId: matchedSalesUser?.id || g.salesPersonId,
          payment: customer.payment || g.payment,
          remark: customer.remark || g.remark,
          items: [...g.items, ...newItems],
        }));
        setImportResult({
          msg: `导入成功：新增 ${newItems.length} 个业务项目`,
          warnings,
        });
      } catch (e) {
        setImportResult({ msg: `导入失败：${(e as Error).message}`, warnings: [] });
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // 体检名单粘贴导入
  function doChkImport() {
    const rows = parseCSV(chkPasteText);
    const paxList: PaxEntry[] = [];
    const startIdx =
      rows[0] && (rows[0][0] === '姓名' || (rows[0][0] || '').includes('姓名')) ? 1 : 0;
    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] && !r[1]) continue;
      paxList.push({
        name: r[0] || '',
        idCard: r[1] || '',
        phone: r[2] || '',
        gender: r[3] === '女' ? '女' : '男',
        married: ['是', 'true', '1', '已婚'].includes((r[4] || '').trim()),
        package: parsePackage(r[5] || 'A'),
      });
    }
    if (paxList.length) {
      setChkPax((prev) => [...prev.filter((p) => p.name.trim()), ...paxList]);
      setShowChkPaste(false);
      setChkPasteText('');
    }
  }

  function exportChkTemplate() {
    const rows = chkPax
      .filter((p) => p.name.trim())
      .map((p) => [p.name, p.idCard, p.phone, p.gender, p.married ? '是' : '否', p.package]);
    const csv = toCSV(rows, ['姓名', '身份证号', '手机号', '性别', '婚否', '套餐']);
    downloadFile('体检名单.csv', csv);
  }

  function handleClear() {
    if (!confirm('确定清空所有内容吗？此操作不可撤销。')) return;
    setDraftGroup({
      id: '',
      customerName: '',
      contactName: '',
      contactPhone: '',
      salesPerson: '',
      salesPersonId: undefined,
      payment: PAYMENT_OPTIONS[0],
      remark: '',
      items: [],
      status: 'pending',
      createdAt: '',
    });
    setImportResult(null);
    setErr('');
  }

  // ================================================
  // 提交 / 草稿
  // ================================================
  const [saving, setSaving] = useState(false);

  function buildOrder(): BookingOrder {
    return {
      ...draftGroup,
      id: draftGroup.id || genOrderNo(),
      status: 'pending',
      createdAt: draftGroup.createdAt || new Date().toISOString(),
    };
  }

  async function handleSubmit() {
    if (!draftGroup.customerName.trim()) {
      setErr('请填写客户/单位名称');
      return;
    }
    if (draftGroup.items.length === 0) {
      setErr('请至少添加一个业务项目');
      return;
    }
    const order = buildOrder();
    setSaving(true);
    try {
      await onSaved(order);
      onClose();
    } catch {
      // 错误已由上层处理
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    const order = buildOrder();
    setSaving(true);
    try {
      await onSaved(order);
      onClose();
    } catch {
      // 错误已由上层处理
    } finally {
      setSaving(false);
    }
  }

  // ================================================
  // 渲染
  // ================================================
  const title = isEdit ? '编辑订单' : '新建订单';
  const lgNights = Math.max(0, daysBetween(lgIn, lgOut));

  return (
    <div className="flex flex-col h-full text-gray-800">
      {/* 隐藏文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 页头 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ClipboardList size={18} className="text-green-600" />
          {title}
          {isCopy && (
            <span className="text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-600 font-normal">
              复制为新单
            </span>
          )}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()} className={btnGhost}>
            <Upload size={14} /> Excel导入
          </button>
          <button onClick={downloadTemplate} className={btnGhost}>
            <Download size={14} /> 下载模板
          </button>
          <button onClick={handleClear} className={btnGhost}>
            <Eraser size={14} /> 清空
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {/* 错误提示 */}
        {err && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr('')} className="text-red-600 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 导入结果 */}
        {importResult && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm">
            <CheckCircle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div>{importResult.msg}</div>
              {importResult.warnings.length > 0 && (
                <ul className="mt-1 text-xs text-amber-600 list-disc list-inside">
                  {importResult.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="text-emerald-600 hover:text-emerald-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 客户信息 */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-green-500 rounded-full" />
            客户信息
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>客户/单位名称 *</label>
              <input
                value={draftGroup.customerName}
                onChange={(e) => setDraftGroup((g) => ({ ...g, customerName: e.target.value }))}
                placeholder="请输入客户或单位名称"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>联系人</label>
              <input
                value={draftGroup.contactName}
                onChange={(e) => setDraftGroup((g) => ({ ...g, contactName: e.target.value }))}
                placeholder="请输入联系人"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>联系电话</label>
              <input
                value={draftGroup.contactPhone}
                onChange={(e) => setDraftGroup((g) => ({ ...g, contactPhone: e.target.value }))}
                placeholder="请输入联系电话"
                className={`${inputCls} font-mono`}
              />
            </div>
            <div>
              <label className={labelCls}>销售员</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSalesPickerOpen((v) => !v)}
                  className={`${inputCls} text-left flex items-center justify-between ${draftGroup.salesPerson ? 'text-gray-900' : 'text-gray-400'}`}
                >
                  <span className="truncate">{draftGroup.salesPerson || '点击选择销售员'}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {draftGroup.salesPerson && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraftGroup((g) => ({ ...g, salesPerson: '', salesPersonId: undefined }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            setDraftGroup((g) => ({ ...g, salesPerson: '', salesPersonId: undefined }));
                          }
                        }}
                        className="text-gray-400 hover:text-red-500"
                        title="清除"
                      >
                        <X size={14} />
                      </span>
                    )}
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${salesPickerOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {salesPickerOpen && (
                  <>
                    {/* 点击遮罩关闭 */}
                    <div className="fixed inset-0 z-10" onClick={() => setSalesPickerOpen(false)} />
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-2 max-h-56 overflow-y-auto">
                      {salesUsers.length === 0 ? (
                        <div className="text-center py-4 text-xs text-gray-400">
                          暂无销售员，请先在用户管理中为员工分配「销售员」角色
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {salesUsers.map((u) => {
                            const active = u.id === draftGroup.salesPersonId;
                            return (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => {
                                  setDraftGroup((g) => ({
                                    ...g,
                                    salesPerson: u.name || u.username || '',
                                    salesPersonId: u.id,
                                  }));
                                  setSalesPickerOpen(false);
                                }}
                                className={`px-3 py-2 rounded-md text-sm text-left transition-colors border ${
                                  active
                                    ? 'bg-green-50 border-green-500 text-green-700 font-medium'
                                    : 'bg-white border-gray-200 text-gray-700 hover:bg-green-50 hover:border-green-300 hover:text-green-700'
                                }`}
                                title={u.username ? `账号：${u.username}` : u.name}
                              >
                                <span className="truncate block">{u.name || u.username || '未命名'}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>付款方式</label>
              <select
                value={draftGroup.payment}
                onChange={(e) => setDraftGroup((g) => ({ ...g, payment: e.target.value }))}
                className={inputCls}
              >
                {PAYMENT_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>备注</label>
              <input
                value={draftGroup.remark}
                onChange={(e) => setDraftGroup((g) => ({ ...g, remark: e.target.value }))}
                placeholder="备注信息"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* 业务项目 */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <span className="w-1 h-4 bg-green-500 rounded-full" />
              业务项目
              <span className="text-xs text-gray-400 font-normal">
                （{draftGroup.items.length} 项）
              </span>
            </h2>
            <button onClick={openAdd} className={btnGold}>
              <Plus size={14} /> 添加业务项目
            </button>
          </div>

          {draftGroup.items.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              <FileSpreadsheet size={32} className="mx-auto mb-2 opacity-40" />
              暂无业务项目，点击「添加业务项目」开始
            </div>
          ) : (
            <div className="space-y-2">
              {draftGroup.items.map((item, idx) => {
                const biz = BIZ_MAP[item.itemType];
                const sum = itemSummary(item);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 text-gray-800"
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ background: `${biz.color}20`, color: biz.color }}
                    >
                      {biz.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ background: `${biz.color}20`, color: biz.color }}
                        >
                          {biz.label}
                        </span>
                        <span className="text-sm font-medium font-mono truncate">
                          {sum.main}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{sum.sub}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-mono font-semibold text-green-700">
                        ¥{(item.amount || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {biz.unit}×{item.pax}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(item, idx)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteItem(idx)}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* 底部汇总 */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200">
        <div className="px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-xs text-gray-500">订单总额</div>
            <div className="text-2xl font-bold font-mono text-green-600">
              ¥{totalAmount.toLocaleString()}
            </div>
          </div>
          <button onClick={handleSaveDraft} disabled={saving} className={btnGhost + (saving ? ' opacity-50 cursor-not-allowed' : '')}>
            <Save size={14} /> {saving ? '保存中...' : '保存草稿'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={14} /> {saving ? '提交中...' : '提交订单'}
          </button>
        </div>
      </div>

      {/* ================================================ */}
      {/* 抽屉 */}
      {/* ================================================ */}
      {drawer.open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeDrawer} />
          <div className="relative w-full sm:w-[620px] h-full bg-white border-l border-gray-200 shadow-2xl flex flex-col">
            {/* 抽屉头 */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200">
              {drawer.mode === 'form' && (
                <button
                  onClick={() => setDrawer((d) => ({ ...d, mode: 'select', itemType: null, editIdx: -1 }))}
                  className="text-gray-500 hover:text-gray-800 text-sm"
                >
                  ←
                </button>
              )}
              <h3 className="text-base font-medium text-gray-900 flex-1">
                {drawer.mode === 'select'
                  ? '选择业务类型'
                  : drawer.editIdx >= 0
                    ? `编辑${BIZ_MAP[drawer.itemType!].label}`
                    : `添加${BIZ_MAP[drawer.itemType!].label}`}
              </h3>
              <button onClick={closeDrawer} className="text-gray-500 hover:text-gray-800">
                <X size={18} />
              </button>
            </div>

            {/* 抽屉内容 */}
            <div className="flex-1 overflow-y-auto p-5">
              {drawer.mode === 'select' ? (
                <div className="grid grid-cols-2 gap-3">
                  {MANUAL_BIZ_TYPES.map((biz) => (
                    <button
                      key={biz.type}
                      onClick={() => selectBizType(biz.type)}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl bg-gray-50 border border-gray-200 hover:border-green-500 transition-colors"
                    >
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                        style={{ background: `${biz.color}25`, color: biz.color }}
                      >
                        {biz.icon}
                      </div>
                      <div className="text-sm font-medium text-gray-900">{biz.label}</div>
                      <div className="text-[10px] text-gray-400">单位：{biz.unit}</div>
                    </button>
                  ))}
                </div>
              ) : drawer.itemType === 'checkup' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>体检日期</label>
                      <input
                        type="date"
                        value={chkDate}
                        onChange={(e) => setChkDate(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>开始时间</label>
                      <input
                        type="time"
                        value={chkTime}
                        onChange={(e) => setChkTime(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      体检名单（{chkPax.filter((p) => p.name.trim()).length} 人）
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setShowChkPaste(true)} className={btnGhost}>
                        <Upload size={12} /> 导入
                      </button>
                      <button onClick={exportChkTemplate} className={btnGhost}>
                        <Download size={12} /> 模板
                      </button>
                      <button onClick={() => setChkPax((p) => [...p, emptyPax()])} className={btnGold}>
                        <Plus size={12} /> 添加
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium">姓名</th>
                          <th className="px-2 py-2 text-left font-medium">身份证号</th>
                          <th className="px-2 py-2 text-left font-medium">手机号</th>
                          <th className="px-2 py-2 text-left font-medium">性别</th>
                          <th className="px-2 py-2 text-center font-medium">婚否</th>
                          <th className="px-2 py-2 text-left font-medium">套餐</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {chkPax.map((p, idx) => (
                          <tr key={idx} className="border-t border-gray-100">
                            <td className="px-1.5 py-1">
                              <input
                                value={p.name}
                                onChange={(e) => updChkPax(idx, { name: e.target.value })}
                                className={`${cellInput} w-20`}
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                value={p.idCard}
                                onChange={(e) => updChkPax(idx, { idCard: e.target.value })}
                                className={`${cellInput} w-36 font-mono`}
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                value={p.phone}
                                onChange={(e) => updChkPax(idx, { phone: e.target.value })}
                                className={`${cellInput} w-28 font-mono`}
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <select
                                value={p.gender}
                                onChange={(e) =>
                                  updChkPax(idx, { gender: e.target.value as '男' | '女' })
                                }
                                className={cellInput}
                              >
                                <option value="男">男</option>
                                <option value="女">女</option>
                              </select>
                            </td>
                            <td className="px-1.5 py-1 text-center">
                              <input
                                type="checkbox"
                                checked={p.married}
                                onChange={(e) => updChkPax(idx, { married: e.target.checked })}
                                className="accent-green-500"
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <select
                                value={p.package}
                                onChange={(e) =>
                                  updChkPax(idx, { package: e.target.value as PackageCode })
                                }
                                className={cellInput}
                              >
                                {(['A', 'B', 'C', 'D'] as PackageCode[]).map((k) => (
                                  <option key={k} value={k}>
                                    {k} · ¥{CHECKUP_PACKAGES[k].price}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1.5 py-1">
                              <button
                                onClick={() => setChkPax((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-right text-sm text-green-600 font-mono">
                    合计：¥{calcCheckupAmount(chkPax.filter((p) => p.name.trim())).toLocaleString()}
                  </div>
                </div>
              ) : drawer.itemType === 'lodging' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>入住日期</label>
                      <input
                        type="date"
                        value={lgIn}
                        onChange={(e) => setLgIn(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>离店日期</label>
                      <input
                        type="date"
                        value={lgOut}
                        onChange={(e) => setLgOut(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>到达时间</label>
                      <input
                        type="time"
                        value={lgArr}
                        onChange={(e) => setLgArr(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>间数</label>
                      <input
                        type="number"
                        min="1"
                        value={lgRooms}
                        onChange={(e) => setLgRooms(Math.max(1, parseInt(e.target.value) || 1))}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>房型</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(Object.keys(LODGING_TYPES) as LodgingType[]).map((k) => (
                          <button
                            key={k}
                            onClick={() => setLgType(k)}
                            className={`px-2 py-2 rounded-lg text-xs border transition-colors ${
                              lgType === k
                                ? 'bg-green-500/15 border-green-500 text-green-600'
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <div className="font-medium">{LODGING_TYPES[k].name}</div>
                            <div className="text-[10px] opacity-70 font-mono">
                              ¥{LODGING_TYPES[k].price}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-500">
                        共 <span className="text-green-600 font-mono">{lgNights}</span> 晚
                      </span>
                      <span className="text-green-600 font-mono">
                        ¥{LODGING_TYPES[lgType].price} × {lgRooms} × {lgNights} = ¥
                        {calcLodgingAmount(lgType, lgRooms, lgNights).toLocaleString()}
                      </span>
                    </div>
                    {lgNights > 0 && (
                      <div className="flex gap-0.5 h-7">
                        {Array.from({ length: lgNights + 1 }, (_, i) => {
                          const isCheckIn = i === 0;
                          const isCheckOut = i === lgNights;
                          const cls = isCheckIn
                            ? 'bg-green-500'
                            : isCheckOut
                              ? 'bg-emerald-500'
                              : 'bg-purple-500';
                          const label = isCheckIn ? '入住' : isCheckOut ? '退房' : `D${i + 1}`;
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded text-[10px] flex items-center justify-center text-white font-medium ${cls}`}
                            >
                              {label}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-green-500" /> 入住
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-purple-500" /> 在住
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-emerald-500" /> 退房
                      </span>
                    </div>
                  </div>
                </div>
              ) : drawer.itemType === 'lunch' || drawer.itemType === 'dinner' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>开始日期</label>
                      <input
                        type="date"
                        value={mlStart}
                        onChange={(e) => setMlStart(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>结束日期</label>
                      <input
                        type="date"
                        value={mlEnd}
                        onChange={(e) => setMlEnd(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>默认时间</label>
                      <input
                        type="time"
                        value={mlTime}
                        onChange={(e) => setMlTime(e.target.value)}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>默认桌数</label>
                      <input
                        type="number"
                        min="1"
                        value={mlTables}
                        onChange={(e) => setMlTables(Math.max(1, parseInt(e.target.value) || 1))}
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>每桌人数</label>
                      <input
                        type="number"
                        min="1"
                        value={mlPerTable}
                        onChange={(e) =>
                          setMlPerTable(Math.max(1, parseInt(e.target.value) || 1))
                        }
                        className={`${inputCls} font-mono`}
                      />
                    </div>
                  </div>

                  {/* 日期范围可视化 */}
                  {mlSessions.length > 0 && (
                    <div className="flex gap-0.5 h-6">
                      {mlSessions.map((s, i) => {
                        const isFirst = i === 0;
                        const isLast = i === mlSessions.length - 1;
                        const cls = isFirst
                          ? 'bg-green-500'
                          : isLast
                            ? 'bg-emerald-500'
                            : 'bg-purple-500';
                        return (
                          <div
                            key={s.date}
                            className={`flex-1 rounded text-[10px] flex items-center justify-center text-white font-medium ${cls}`}
                            title={s.date}
                          >
                            {s.date.slice(5)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div>
                    <div className="text-sm text-gray-700 mb-2">
                      场次明细（{mlSessions.length} 场）
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="px-2 py-2 text-left font-medium">日期</th>
                            <th className="px-2 py-2 text-left font-medium">时间</th>
                            <th className="px-2 py-2 text-left font-medium">桌数</th>
                            <th className="px-2 py-2 text-left font-medium">每桌</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mlSessions.map((s, idx) => (
                            <tr key={s.date + idx} className="border-t border-gray-100">
                              <td className="px-1.5 py-1 font-mono text-gray-700">{s.date}</td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="time"
                                  value={s.time}
                                  onChange={(e) =>
                                    setMlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, time: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-24 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="number"
                                  min="1"
                                  value={s.tables}
                                  onChange={(e) =>
                                    setMlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx
                                          ? { ...x, tables: Math.max(1, parseInt(e.target.value) || 1) }
                                          : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-16 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="number"
                                  min="1"
                                  value={s.perTable}
                                  onChange={(e) =>
                                    setMlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx
                                          ? {
                                              ...x,
                                              perTable: Math.max(1, parseInt(e.target.value) || 1),
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-16 font-mono`}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    用餐金额现场结算，不计入订单总额
                  </div>
                </div>
              ) : drawer.itemType === 'meeting' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">会务场次（{mtSessions.length} 场）</span>
                    <button
                      onClick={() =>
                        setMtSessions((prev) => [
                          ...prev,
                          {
                            date: todayStr(),
                            startTime: '09:00',
                            hall: 'siji',
                            slotType: 'full',
                            pax: 20,
                          },
                        ])
                      }
                      className={btnGold}
                    >
                      <Plus size={12} /> 添加场次
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium">日期</th>
                          <th className="px-2 py-2 text-left font-medium">开始</th>
                          <th className="px-2 py-2 text-left font-medium">会议厅</th>
                          <th className="px-2 py-2 text-left font-medium">时段</th>
                          <th className="px-2 py-2 text-left font-medium">人数</th>
                          <th className="px-2 py-2 text-left font-medium">金额</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {mtSessions.map((s, idx) => (
                          <tr key={idx} className="border-t border-gray-100">
                            <td className="px-1.5 py-1">
                              <input
                                type="date"
                                value={s.date}
                                onChange={(e) =>
                                  setMtSessions((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, date: e.target.value } : x,
                                    ),
                                  )
                                }
                                className={`${cellInput} w-36 font-mono`}
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                type="time"
                                value={s.startTime}
                                onChange={(e) =>
                                  setMtSessions((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, startTime: e.target.value } : x,
                                    ),
                                  )
                                }
                                className={`${cellInput} w-20 font-mono`}
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <select
                                value={s.hall}
                                onChange={(e) =>
                                  setMtSessions((prev) =>
                                    prev.map((x, i) =>
                                      i === idx
                                        ? { ...x, hall: e.target.value as MeetingSession['hall'] }
                                        : x,
                                    ),
                                  )
                                }
                                className={cellInput}
                              >
                                {(Object.keys(MEETING_HALLS) as Array<keyof typeof MEETING_HALLS>).map(
                                  (k) => (
                                    <option key={k} value={k}>
                                      {MEETING_HALLS[k].name}
                                    </option>
                                  ),
                                )}
                              </select>
                            </td>
                            <td className="px-1.5 py-1">
                              <select
                                value={s.slotType}
                                onChange={(e) =>
                                  setMtSessions((prev) =>
                                    prev.map((x, i) =>
                                      i === idx
                                        ? { ...x, slotType: e.target.value as 'half' | 'full' }
                                        : x,
                                    ),
                                  )
                                }
                                className={cellInput}
                              >
                                <option value="half">半天</option>
                                <option value="full">全天</option>
                              </select>
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                type="number"
                                min="0"
                                value={s.pax}
                                onChange={(e) =>
                                  setMtSessions((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, pax: parseInt(e.target.value) || 0 } : x,
                                    ),
                                  )
                                }
                                className={`${cellInput} w-16 font-mono`}
                              />
                            </td>
                            <td className="px-1.5 py-1 font-mono text-green-600">
                              ¥{calcMeetingAmount(s.hall, s.slotType).toLocaleString()}
                            </td>
                            <td className="px-1.5 py-1">
                              <button
                                onClick={() =>
                                  setMtSessions((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : drawer.itemType === 'wellness' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">康乐场次（{wlSessions.length} 场）</span>
                    <button
                      onClick={() =>
                        setWlSessions((prev) => [
                          ...prev,
                          {
                            date: todayStr(),
                            startTime: '15:00',
                            wellnessType: 'mahjong',
                            hours: 4,
                            pax: 2,
                          },
                        ])
                      }
                      className={btnGold}
                    >
                      <Plus size={12} /> 添加场次
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium">日期</th>
                          <th className="px-2 py-2 text-left font-medium">开始</th>
                          <th className="px-2 py-2 text-left font-medium">项目</th>
                          <th className="px-2 py-2 text-left font-medium">小时</th>
                          <th className="px-2 py-2 text-left font-medium">人数</th>
                          <th className="px-2 py-2 text-left font-medium">金额</th>
                          <th className="px-2 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {wlSessions.map((s, idx) => {
                          const w = WELLNESS_TYPES[s.wellnessType];
                          return (
                            <tr key={idx} className="border-t border-gray-100">
                              <td className="px-1.5 py-1">
                                <input
                                  type="date"
                                  value={s.date}
                                  onChange={(e) =>
                                    setWlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, date: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-36 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="time"
                                  value={s.startTime}
                                  onChange={(e) =>
                                    setWlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, startTime: e.target.value } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-20 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <select
                                  value={s.wellnessType}
                                  onChange={(e) =>
                                    setWlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx
                                          ? {
                                              ...x,
                                              wellnessType:
                                                e.target.value as WellnessSession['wellnessType'],
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  className={cellInput}
                                >
                                  {(
                                    Object.keys(WELLNESS_TYPES) as Array<
                                      keyof typeof WELLNESS_TYPES
                                    >
                                  ).map((k) => (
                                    <option key={k} value={k}>
                                      {WELLNESS_TYPES[k].name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={s.hours}
                                  onChange={(e) =>
                                    setWlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, hours: parseInt(e.target.value) || 0 } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-14 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1">
                                <input
                                  type="number"
                                  min="0"
                                  value={s.pax}
                                  onChange={(e) =>
                                    setWlSessions((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, pax: parseInt(e.target.value) || 0 } : x,
                                      ),
                                    )
                                  }
                                  className={`${cellInput} w-14 font-mono`}
                                />
                              </td>
                              <td className="px-1.5 py-1 font-mono text-green-600">
                                {w.free ? (
                                  <span className="text-emerald-400">免费</span>
                                ) : (
                                  `¥${calcWellnessAmount(s.wellnessType, s.hours).toLocaleString()}`
                                )}
                              </td>
                              <td className="px-1.5 py-1">
                                <button
                                  onClick={() =>
                                    setWlSessions((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="text-red-400 hover:text-red-600"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 抽屉底部 */}
            {drawer.mode === 'form' && (
              <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-3">
                <div className="flex-1 text-sm">
                  <span className="text-gray-500">合计：</span>
                  <span className="text-green-600 font-mono font-semibold">
                    ¥{drawerAmount.toLocaleString()}
                  </span>
                </div>
                <button onClick={closeDrawer} className={btnGhost}>
                  取消
                </button>
                <button
                  onClick={saveDrawer}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors"
                >
                  <Save size={14} /> 保存
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 体检名单粘贴导入弹窗 */}
      {showChkPaste && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowChkPaste(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-xl border border-gray-200 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-medium text-gray-900">粘贴导入体检名单</h3>
              <button onClick={() => setShowChkPaste(false)} className="text-gray-500 hover:text-gray-800">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-2">
              支持 Tab 或逗号分隔，列顺序：姓名、身份证号、手机号、性别、婚否、套餐（A/B/C/D 或套餐名）
            </p>
            <textarea
              value={chkPasteText}
              onChange={(e) => setChkPasteText(e.target.value)}
              rows={8}
              placeholder={'张伟\t3301198501011234\t13800138000\t男\t是\tB\n李芳\t...'}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono focus:outline-none focus:border-green-500"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowChkPaste(false)} className={btnGhost}>
                取消
              </button>
              <button onClick={doChkImport} className={btnGold}>
                <Upload size={14} /> 导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
