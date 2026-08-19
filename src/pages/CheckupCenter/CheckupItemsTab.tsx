import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, Search, AlertTriangle, FileSpreadsheet, ChevronDown, ChevronUp, X, Sparkles } from 'lucide-react';
import { bookingApi, type CheckupItemRow } from '@/lib/api';
import { CATEGORIES } from './api';
import { useToast } from '@/components/Toast';
import { useAuthStore } from '@/store/authStore';

const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors disabled:opacity-50';

function Upd({ value, onChange, type = 'text', step, placeholder, warn }:
  { value: any; onChange: (v: any) => void; type?: string; step?: string; placeholder?: string; warn?: boolean }) {
  return (
    <input
      type={type}
      step={step}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      className={`${inputCls} text-xs !py-1 !px-2 ${warn ? '!border-amber-400 !bg-amber-50 focus:!border-amber-500' : ''}`}
    />
  );
}

function Checkbox({ value, onChange }: { value: any; onChange: (v: number) => void }) {
  return (
    <input
      type="checkbox"
      checked={Number(value) === 1}
      onChange={(e) => onChange(e.target.checked ? 1 : 0)}
      className="accent-green-500 w-4 h-4"
    />
  );
}

function RowBtn({ children, onClick, cls }: { children: React.ReactNode; onClick?: () => void; cls?: string }) {
  return (
    <button onClick={onClick} className={`text-xs px-2 py-1 rounded border transition-colors ${cls || btnGhost}`}>
      {children}
    </button>
  );
}

// ===== 体检项目分类+类型 自动推断（7大类 + combo/普通）=====
// 【分类规则 v2】
// 1) 先命中先归类，命中优先级从上到下
// 2) 体格检查关键词严格只保留"科室/器官触诊类"，移除了之前抢词的 前列腺/甲状腺/腹部/血压/人体成分/动脉硬化检测
// 3) 特色加项关键词只保留明确的：基因甲基化/早筛基因/过敏原检测
//    - 脂联素、25-羟基维D、LP-PLA2、SdLDL-C、胸苷激酶…等一律走 LAB_KEYWORDS 归实验室
//    - 删除了 '外)' 这种过宽关键词，避免叶酸(外)等被误判为特色加项
// 4) 第7类存库名改为「实验室」与 CATEGORIES 常量严格一致（原来写"实验室检查"导致UI分类tab过滤为空！）
const CATEGORY_RULES: Array<{ cat: string; keywords: string[] }> = [
  { cat: '体格检查', keywords: [
    '一般检查','内科','外科','眼科','耳鼻喉科','口腔科','妇科常规','裂隙灯检查','眼压','身高','体重','bmi','听诊','触诊','宫颈脱落细胞检查','白带常规','视力','辨色','口腔常规','牙周','内诊','全身体格','既往史','家族史','心率','心律','杂音','肺部听诊','腹部触诊','肝脏触诊','脾脏触诊','双肾区','淋巴结','脊柱','四肢关节','皮肤','肛诊','外生殖器检查','乳房检查','眼科常规','血压'
  ]},
  { cat: '肿瘤筛查', keywords: ['肿瘤指标','蛋白芯片','肿瘤5项','肿瘤6项','肿瘤11项','肿瘤全套','前列腺肿瘤两项筛选','肿瘤筛查','肿瘤组合','早筛','肿瘤（男）','肿瘤（女）','肿瘤相关抗原','非小细胞肺癌相关抗原','鳞状细胞癌相关抗原','胃泌素释放前体','progrp','恶性肿瘤特异性生长因子','tsgf','septin9','shox2','rassf1a','ptger4','rnf180','reprimo','sdc2','tcf4','三基因甲基化','肠癌基因','胃癌三基因','基因甲基化检测'] },
  { cat: '妇科专项', keywords: ['tct','液基','hpv','阴道镜','阴超','宫颈','白带','妇科','激素水平测定','抗缪勒管','β-hcg','人乳头瘤病毒','女性激素','卵巢','乳腺彩超','电子阴道镜','激素水平','β-绒毛膜促性腺激素'] },
  { cat: '影像检查', keywords: ['彩超','dr摄片','数字dr','ct','磁共振','x线','摄片','出片费','拷片','超声','b超','彩色多普勒','钼靶','拍片','dr/ct','ct动态','部位（不含片）'] },
  { cat: '功能检查', keywords: ['心电图','动态心电','动态血压','经颅多普勒','tcd','肺功能检查','c13呼气','c14呼气','呼气试验','电子直乙肠镜','肠镜','胃镜','人体成分分析','动脉硬化检测','骨密度','经颅','脑血流图','脑电图','肌电图','诱发电位'] },
  { cat: '特色加项', keywords: ['基因甲基化检测(外）','过敏源检测','过敏原检测','基因甲基化','肺癌shox2/rassf1a/ptger4基因甲基化','septin9肠癌基因检测','rnf180/septin9基因甲基化','reprimo/sdc2/tcf4胃癌三基因甲基化'] },
];
// 实验室检查（没命中上面6类，但属于化验/抽血/尿检/粪便类的）
const LAB_KEYWORDS = ['血常规','血型','血沉','尿常规','尿沉渣','大便隐血','血流变','谷丙','谷草','肝功','肝功能','肾功能','尿素氮','肌酐','尿酸','血糖','糖化血红蛋白','糖化','血脂','胆固醇','甘油三脂','甘油三酯','总蛋白','白蛋白','球蛋白','总胆红素','直接胆红素','胆汁酸','转氨酶','淀粉酶','脂肪酶','心肌酶','肌酸激酶','乳酸脱氢酶','肌钙蛋白','肌红蛋白','bnp','pro-bnp','b型钠尿肽','d-二聚体','凝血','c反应蛋白','crp','同型半胱氨酸','胱抑素','β2-微球蛋白','前白蛋白','胆碱酯酶','叶酸','维生素d','铁蛋白','转铁蛋白','甲胎蛋白','afp','cea','癌胚抗原','糖类抗原','ca199','ca724','ca153','ca125','ca211','ca50','ca242','he4','人附睾蛋白','ost','骨钙素','hcg','ferr','c-肽','胃泌素','胃蛋白酶原','pg','免疫球蛋白','肝纤维化','电解质','微量元素','eb病毒','ea-iga','vca-iga','vca-igm','丙型肝炎','甲型肝炎','梅毒筛查','anti-tp','艾滋病筛查','anti-hiv','促甲状腺素','tsh','游离三碘甲状原氨酸','ft3','ft4','游离甲状腺素','甲状腺素','t4','三碘甲状原氨酸','t3','甲状腺球蛋白','抗甲状腺球蛋白抗体','tg-ab','抗甲状腺过氧化物酶抗体','tpo-ab','促甲状腺激素受体抗体','tp-ab','载脂蛋白','apoa1','apob','脂联素','谷胱甘肽还原酶','gr','肌酸激酶同工酶','ck-mb','vegf','血管内皮生长因子','胃幽门螺杆菌抗体','血清肌红蛋白','nse','神经元特异性烯醇化酶','t-psa','f-psa','游离前列腺特异性抗原','总前列腺特异性抗原','前列腺特异性抗原','tnt-hs','超敏肌钙蛋白','malb','尿微量白蛋白','nag','n-β-葡萄糖苷酶','afu','α-l糖苷岩藻酶','高密度胆固醇','低密度胆固醇','脂蛋白a','lpa','出凝血','凝血四项','类风湿因子','aso','抗链球菌溶血素','超敏crp','感染四项','hcv','hav','igm','igg','小而密低密度脂蛋白','sdldl-c','sdl','脂蛋白相关磷脂酶a2','lp-pla2','胸苷激酶1','tki','25-羟基维生素d','降钙素','血清肌钙蛋白（外）','淀粉酶测定','纤维蛋白原','血空腹胰岛素','生化全套','总胆汁酸','谷丙转氨酶','丙氨酸氨基转移酶','天门冬氨酸氨基转移酶','γ-谷氨酰转移酶','碱性磷酸酶','白球比例','鳞状细胞癌相关抗原','scc'] ;

function inferCategory(name: string): string {
  const n = (name || '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    const hit = rule.keywords.find(k => n.includes(k.toLowerCase()));
    if (hit) return rule.cat;
  }
  if (LAB_KEYWORDS.some(k => n.includes(k.toLowerCase()))) return '实验室';
  // 特殊兜底："（外）"结尾但没命中特色加项的，一律实验室（避免走最后兜底到特色加项）
  if (/（外）|\(外\)|\(外）|（外\)$/.test(n)) return '实验室';
  return '实验室';
}
// 判断是否为"组合项目 combo"：含N项/全套/两项/三项/组合/筛选/芯片/指标 等
function inferItemType(name: string): 'combo' | 'item' {
  const n = (name || '');
  if (/\d+项/.test(n)) return 'combo';
  if (/(一|二|三|四|五|六|七|八|九|十|十一|十二|十五|十六|两)项/.test(n)) return 'combo';
  if (/全套|两项|三项|筛选|芯片|肿瘤指标|蛋白芯片|甲状腺功能检查|肝功能\d|肝功能\d?项|肾功能|血脂|心肌酶谱|微量元素检测|电解质检测|过敏源检测|过敏原检测|胃蛋白酶原|肝纤维化四项|类风湿因子.*抗|组合|套餐|尿常规\+尿沉渣|免疫球蛋白三项/.test(n)) return 'combo';
  return 'item';
}

// 编码生成：统一 T + 5 位数字（T00001、T00002…），与现有数据库编码保持一致
// 兼容历史：同时扫描 T\d{5}（优先）和 CI\d{3}（旧格式），取最大序号
function generateCode(existing: { code?: string }[]): string {
  let maxNum = 0;
  existing.forEach(r => {
    // 优先匹配现行规范：T00001
    const m5 = (r.code || '').match(/^T(\d{5})$/);
    if (m5) { maxNum = Math.max(maxNum, parseInt(m5[1], 10)); return; }
    // 兼容旧格式：CI001
    const m3 = (r.code || '').match(/^CI(\d{3})$/);
    if (m3) maxNum = Math.max(maxNum, parseInt(m3[1], 10));
    // 其他形如 [A-Za-z]+(\d+) 的非标准编码，也把数字部分纳入参考（别重号）
    const fall = (r.code || '').match(/(\d+)$/);
    if (fall) maxNum = Math.max(maxNum, Math.min(parseInt(fall[1], 10), 99999));
  });
  return `T${String(maxNum + 1).padStart(5, '0')}`;
}

const DEFAULT_CATEGORY = CATEGORIES[0]; // '体格检查'

type AppRole = 'male' | 'female_married' | 'female_single';
const APPLICABLE_ROLES: Array<{ key: AppRole; label: string }> = [
  { key: 'male', label: '👨 男性' },
  { key: 'female_married', label: '👩 已婚女性' },
  { key: 'female_single', label: '👧 未婚女性' },
];
function appRoleLabel(roles: AppRole[] | null | undefined): string | null {
  if (!roles || roles.length === 0) return null;
  if (roles.length === 3) return null; // 全选=通用
  if (roles.length === 1 && roles[0] === 'male') return '仅男性';
  if (roles.includes('female_married') && roles.includes('female_single') && roles.length === 2) return '仅女性';
  if (roles.length === 1 && roles[0] === 'female_married') return '仅已婚女';
  if (roles.length === 1 && roles[0] === 'female_single') return '仅未婚女';
  return roles.map(r => APPLICABLE_ROLES.find(x => x.key === r)?.label || r).join('+');
}

const DEFAULT_CHECKUP: Partial<CheckupItemRow> = {
  code: '', name: '', item_type: 'item', category: DEFAULT_CATEGORY,
  description: '', clinical_significance: '', default_price: 0, insurance_price: 0, unit: '次',
  status: 1, sort_order: 100, sub_item_ids: [], applicable_roles: [],
};

export default function CheckupItemsTab() {
  const toast = useToast();
  const isAdmin = useAuthStore(s => s.isAdmin());
  const [rows, setRows] = useState<CheckupItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'create' | 'update'; data: any } | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('全部');
  const [toolOpen, setToolOpen] = useState(false);
  const [pdfText, setPdfText] = useState('');
  // A2: 手动绑定覆盖：key = pdfName（normalize后），value = db id(string)；用户在下拉框选择后持久化到 state
  const [manualBindMap, setManualBindMap] = useState<Record<string, string>>({});
  // A4: 选中的diff行 key（用行index+name组合）
  const [selectedDiffKeys, setSelectedDiffKeys] = useState<Set<string>>(new Set());
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; curr?: string | null; msg?: string } | null>(null);
  // 组合项目子项目胶囊弹窗状态
  const [subPickerOpen, setSubPickerOpen] = useState(false);
  const [subPickerPicked, setSubPickerPicked] = useState<Set<string>>(new Set());
  const [subPickerSearch, setSubPickerSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await bookingApi.listCheckupItems();
      setRows(data);
    } catch (e: any) {
      toast.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const bumpEditing = () => {
    setEditing(prev => prev ? { ...prev } : null);
  };

  const setField = (k: string, v: any) => {
    if (editing) {
      editing.data[k] = v;
      bumpEditing();
    }
  };

  function checkCodeUnique(code: string, excludeId?: string | number): boolean {
    if (!code) return true;
    return !rows.some(r => r.code === code && String(r.id) !== String(excludeId));
  }

  const handleSave = async (d: any) => {
    const data = d as Partial<CheckupItemRow>;
    if (data.code && !checkCodeUnique(data.code, data.id)) {
      toast.error(`编码「${data.code}」已存在，请使用其他编码`);
      return;
    }
    if (!data.name || !String(data.name).trim()) {
      toast.error('项目名称不能为空');
      return;
    }
    if (data.default_price === undefined || data.default_price === null || isNaN(Number(data.default_price))) {
      toast.error('请填写默认定价');
      return;
    }
    const defaultPrice = Number(data.default_price) || 0;
    const insurancePrice = Number(data.insurance_price) || 0;
    if (defaultPrice > 0 && insurancePrice === 0) {
      // 允许继续，但加提醒
      const ok = window.confirm('当前默认定价 > 0，但医保价格为 0。可能是数据漏录，建议补录。是否仍继续保存？');
      if (!ok) return;
    }
    if (insurancePrice > defaultPrice) {
      toast.error(`医保价格(¥${insurancePrice})不能高于默认定价(¥${defaultPrice})`);
      return;
    }
    setSaving(true);
    try {
      if (editing?.mode === 'update' && data.id) {
        await bookingApi.updateCheckupItem(data.id!, data);
      } else {
        await bookingApi.createCheckupItem(data);
      }
      toast.success('保存成功');
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error('保存失败：' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const handleDel = async (r: CheckupItemRow) => {
    if (!window.confirm(`确定禁用体检项目「${r.name}」吗？`)) return;
    try {
      await bookingApi.deleteCheckupItem(r.id);
      toast.success('已禁用');
      await load();
    } catch (e: any) {
      toast.error('禁用失败：' + (e.message || ''));
    }
  };

  // 分类：7 大类 + 数据库里存在的扩展分类（但不在7大类里的那些做分组折叠，避免污染默认 Tab）
  const allCategories = useMemo(() => {
    const set = new Set<string>([...CATEGORIES]);
    const extensions: string[] = [];
    rows.forEach(r => {
      if (r.category && !set.has(r.category)) {
        set.add(r.category);
        extensions.push(r.category);
      }
    });
    return { core: [...CATEGORIES], extensions };
  }, [rows]);

  const categoryTabs = ['全部', ...allCategories.core];

  // 过滤
  const filteredRows = rows.filter(r => {
    const kw = search.trim();
    if (kw && !`${r.name}${r.code}`.toLowerCase().includes(kw.toLowerCase())) return false;
    if (catFilter !== '全部' && r.category !== catFilter) return false;
    return true;
  });

  // 组合项目统计（基于当前筛选结果 P1 修复）
  const comboCount = filteredRows.filter(r => r.item_type === 'combo').length;
  const enabledCount = filteredRows.filter(r => r.status === 1).length;

  const isCreating = editing?.mode === 'create';
  const isEditingThis = (r: CheckupItemRow) => editing?.mode === 'update' && editing.data.id === r.id;
  const availableSubItems = rows.filter(r => r.item_type !== 'combo' && r.status === 1);
  const currentEditingId = editing?.data?.id;

  const toggleSubItem = (subId: string) => {
    if (!editing) return;
    const current = editing.data.sub_item_ids || [];
    if (current.includes(subId)) {
      setField('sub_item_ids', current.filter((id: string) => id !== subId));
    } else {
      setField('sub_item_ids', [...current, subId]);
    }
  };

  const toggleApplicableRole = (r: AppRole) => {
    if (!editing) return;
    const current: AppRole[] = Array.isArray(editing.data.applicable_roles) ? [...editing.data.applicable_roles] : [];
    const idx = current.indexOf(r);
    if (idx >= 0) current.splice(idx, 1); else current.push(r);
    setField('applicable_roles', current);
  };

  function renderApplicablePicker() {
    if (!editing) return null;
    const current: AppRole[] = Array.isArray(editing.data.applicable_roles) ? editing.data.applicable_roles : [];
    const isAll = current.length === 0 || current.length === 3;
    return (
      <tr className="border-t border-purple-100 bg-purple-50/30">
        <td colSpan={10} className="px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-purple-700 font-medium shrink-0">适用角色：</span>
            <div className="flex flex-wrap gap-1">
              {APPLICABLE_ROLES.map(r => {
                const checked = current.includes(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => toggleApplicableRole(r.key)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      checked
                        ? 'bg-purple-500 text-white border-purple-500'
                        : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-100'
                    }`}
                  >
                    {checked && '✓ '}{r.label}
                  </button>
                );
              })}
              {isAll && <span className="text-[10px] text-purple-500 px-1.5 py-0.5 rounded bg-purple-100">✨ 全角色通用</span>}
            </div>
          </div>
        </td>
      </tr>
    );
  }

  function openSubItemPicker() {
    if (!editing) return;
    const isCombo = editing.data.item_type === 'combo';
    if (!isCombo) return;
    const selected: string[] = editing.data.sub_item_ids || [];
    setSubPickerPicked(new Set(selected));
    setSubPickerSearch('');
    setSubPickerOpen(true);
  }

  function renderSubItemPickerSummary() {
    if (!editing) return null;
    const isCombo = editing.data.item_type === 'combo';
    if (!isCombo) return null;
    const selected = editing.data.sub_item_ids || [];
    return (
      <tr className="border-t border-amber-100 bg-amber-50/30">
        <td colSpan={10} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-amber-700 font-medium">组合子项目：</span>
            <span className="text-[11px] text-amber-600">{selected.length > 0 ? `${selected.length} 项已选` : '未选择'}</span>
            <button
              type="button"
              onClick={openSubItemPicker}
              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white font-medium transition-colors"
            >
              编辑子项目
            </button>
          </div>
          {selected.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 max-h-16 overflow-y-auto">
              {selected.map((id: string) => {
                const item = availableSubItems.find(r => r.id === id);
                if (!item) return null;
                return (
                  <span key={id} className="text-[10px] bg-cyan-50 border border-cyan-200 text-cyan-700 rounded px-1.5 py-0.5">
                    {item.name} ¥{Number(item.default_price || 0)}
                  </span>
                );
              })}
            </div>
          )}
        </td>
      </tr>
    );
  }

  // 子项目胶囊模态框（组合项目专用）
  function renderSubItemPickerModal() {
    if (!subPickerOpen || !editing) return null;
    const currentCategory = editing.data.category || DEFAULT_CATEGORY;
    const searchVal = subPickerSearch;
    // 可用子项目：排除当前编辑的项目本身，按分类过滤（先显示当前分类的，再显示其他分类）
    const subItems = availableSubItems.filter(r => r.id !== currentEditingId);
    const filtered = searchVal
      ? subItems.filter(r => `${r.name}${r.code}`.toLowerCase().includes(searchVal.toLowerCase()))
      : subItems;

    // 按分类分组（普通函数内不能用 useMemo，改为即时计算）
    const map = new Map<string, CheckupItemRow[]>();
    filtered.forEach(r => {
      const cat = r.category || '其他';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    });
    const sortedKeys = [...map.keys()].sort((a, b) => {
      if (a === currentCategory) return -1;
      if (b === currentCategory) return 1;
      return 0;
    });

    const confirm = () => {
      setField('sub_item_ids', Array.from(subPickerPicked));
      setSubPickerOpen(false);
      setSubPickerPicked(new Set());
    };

    return (
      <>
        {/* 遮罩 */}
        <div
          className="fixed inset-0 z-[95] bg-black/20"
          onClick={() => {
            if (subPickerPicked.size > 0) {
              if (!window.confirm('有未确认的选中项，确定关闭？')) return;
            }
            setSubPickerOpen(false);
            setSubPickerPicked(new Set());
          }}
        />
        {/* 弹窗 */}
        <div
          className="fixed z-[96] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '720px',
            maxWidth: '95vw',
            height: '80vh',
            maxHeight: '600px',
          }}
        >
          {/* 头部 */}
          <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-cyan-50 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-cyan-600" />
              <span className="font-semibold text-sm text-gray-800">选择子项目（仅显示「{currentCategory}」分类下的普通项目）</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">已选 {subPickerPicked.size} 项</span>
              <button onClick={() => setSubPickerOpen(false)} className="p-1 rounded hover:bg-gray-200 text-gray-500">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* 搜索框 */}
          <div className="px-4 py-2 border-b border-gray-100 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                placeholder="搜索项目名或编码..."
                className="w-full text-xs border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-cyan-500"
                value={subPickerSearch}
                onChange={(e) => setSubPickerSearch(e.target.value)}
              />
            </div>
          </div>

          {/* 分类分组 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {sortedKeys.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">暂无可选的普通项目</div>
            ) : sortedKeys.map(cat => {
              const items = map.get(cat) || [];
              const isCurrentCat = cat === currentCategory;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold ${isCurrentCat ? 'text-cyan-700' : 'text-gray-600'}`}>
                      {isCurrentCat && '⭐ '}{cat}
                    </span>
                    <span className="text-[10px] text-gray-400">{items.length} 项</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(item => {
                      const checked = subPickerPicked.has(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            const next = new Set(subPickerPicked);
                            if (checked) next.delete(item.id); else next.add(item.id);
                            setSubPickerPicked(next);
                          }}
                          className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-all ${
                            checked
                              ? 'bg-cyan-500 text-white border-cyan-500 shadow-sm'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-cyan-300 hover:bg-cyan-50'
                          }`}
                        >
                          {checked && '✓ '}{item.name}
                          <span className={`ml-1 ${checked ? 'text-cyan-100' : 'text-gray-400'}`}>
                            ¥{Number(item.default_price || 0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 底部 */}
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between shrink-0">
            <span className="text-xs text-gray-500">已选 <span className="font-semibold text-cyan-600">{subPickerPicked.size}</span> 项</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (subPickerPicked.size > 0) {
                    if (!window.confirm('有未确认的选中项，确定关闭？')) return;
                  }
                  setSubPickerOpen(false);
                  setSubPickerPicked(new Set());
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
              >取消</button>
              <button
                onClick={confirm}
                className="px-4 py-1.5 text-xs rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white font-medium"
              >确认追加 ({subPickerPicked.size})</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  function typeLabel(r: CheckupItemRow) {
    if (r.item_type === 'combo') {
      return <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-1">组合</span>;
    }
    return null;
  }

  // P5 价格对拍（A1 + A2 manualBindMap 叠加：若 manualBindMap 设置了则改写 diff 匹配结果）
  const compare = useMemo<PriceCompareResult & {
    diffsWithManual: (DiffRow & { diffKey: string })[];
    // Dx: 经 manualBind 修正后的 pdfUnmatched / collisions 视图（UI展示直接用这个）
    pdfUnmatchedView: PriceCompareResult['pdfUnmatched'];
    collisionsView: PriceCompareResult['collisions'];
  }>(() => {
    const base = priceCompare(rows, pdfText) as PriceCompareResult;
    const idMap = new Map<string, CheckupItemRow>();
    rows.forEach(r => { if (r.id) idMap.set(r.id, r); });
    // 每个 diff 叠加 manualBindMap
    const diffsWithManual: (DiffRow & { diffKey: string })[] = base.diffs.map((d, idx) => {
      const key = normalize(d.name);
      const bindId = manualBindMap[key];
      if (!bindId) return { ...d, diffKey: `${idx}:${key}` };
      const bound = idMap.get(bindId);
      if (!bound) return { ...d, diffKey: `${idx}:${key}` };
      // 手动绑定命中：覆盖 dbId/dbName/dbCode/dbPrice/dbInsured，重新计算 reason
      const dbPrice = Math.round((Number(bound.default_price) || 0) * 100) / 100;
      const dbInsured = Math.round((Number(bound.insurance_price) || 0) * 100) / 100;
      const priceDiff = Math.abs(dbPrice - (d.pdfPrice || 0));
      const insuredDiff = d.pdfInsured !== null ? Math.abs(dbInsured - d.pdfInsured) : 0;
      let reason: DiffRow['reason'] = '其他';
      if (priceDiff >= 0.001 && d.pdfInsured !== null && insuredDiff >= 0.001) reason = '定价差+医保';
      else if (priceDiff >= 0.001) reason = '定价差';
      else if (d.pdfInsured !== null && insuredDiff >= 0.001) reason = '医保价差';
      // 手动绑定的同步也加入 hitDbIds，用于反向未匹配统计
      if (bound.id) base.hitDbIds.add(bound.id);
      return {
        ...d,
        dbId: bound.id ?? null, dbName: bound.name, dbCode: bound.code,
        dbPrice, dbInsured, reason,
        matchKind: 'manual' as const, matchScore: 100,
        diffKey: `${idx}:${key}`,
      };
    });

    // === D1: 重新计算 pdfUnmatchedView：把 manualBindMap 已绑定的那些从红块里拿掉 ===
    const pdfUnmatchedView = base.pdfUnmatched.filter(r => {
      const key = normalize(r.name);
      const bindId = manualBindMap[key];
      if (!bindId) return true;
      return !idMap.has(bindId);  // 只有"手动绑定也指向不存在 DB id"的才继续显示
    });

    // === D2: 重新聚合 collisionsView（同时考虑自动命中 + 手动绑定）===
    const dbToHits = new Map<string, Array<{ pdfName: string; pdfPrice: number | null; pdfInsured: number | null; kind: any; score: number }>>();
    function pushHit(dbId: string, h: any) {
      if (!dbId) return;
      if (!dbToHits.has(dbId)) dbToHits.set(dbId, []);
      dbToHits.get(dbId)!.push(h);
    }
    // 自动匹配的冲突（来自 base.collisions 里的 pdfHits，我们改用更权威的来源：base.diffs + diffsWithManual 最终匹配情况）
    diffsWithManual.forEach(d => {
      if (!d.dbId) return;
      pushHit(d.dbId, { pdfName: d.name, pdfPrice: d.pdfPrice ?? null, pdfInsured: d.pdfInsured ?? null, kind: d.matchKind, score: d.matchScore ?? 0 });
    });
    // 另外 base 中已匹配+无差异的（matchedCount 那些，不在 diffsWithManual 里）也要计入冲突
    //   这些没有 diff，但 base.collisions 已反映过它们与自动命中 pdfHits 的共享关系
    base.collisions.forEach(c => {
      c.pdfHits.forEach(h => {
        // 只加那些未出现在 diffsWithManual 的（即 matchedCount 的部分，已经是自动匹配且价格完全一致）
        const alreadyInDiff = diffsWithManual.some(d => d.dbId === c.dbId && normalize(d.name) === normalize(h.pdfName));
        if (!alreadyInDiff) pushHit(c.dbId, h);
      });
    });
    // 生成 collisionsView（同一条 DB 被 ≥2 条同名不同 PDF 行命中时，记为冲突）
    const collisionsView: PriceCompareResult['collisions'] = [];
    for (const [dbId, arr] of dbToHits.entries()) {
      if (arr.length < 2) continue;
      const uniqueNames = new Set(arr.map(h => normalize(h.pdfName)));
      if (uniqueNames.size < 2) continue;
      const dbRow = idMap.get(dbId);
      if (!dbRow) continue;
      collisionsView.push({ dbId, dbRow, pdfHits: arr });
    }
    collisionsView.sort((a, b) => b.pdfHits.length - a.pdfHits.length);

    return { ...base, diffsWithManual, pdfUnmatchedView, collisionsView };
  }, [rows, pdfText, manualBindMap]);

  // A4/B2 同步执行：把选中的 diffs 回写到 DB（scope 支持 name 覆盖）
  const applySelected = async (scope: 'name' | 'price' | 'insured' | 'price+insured' | 'all') => {
    if (!isAdmin) { toast.error('仅管理员可同步'); return; }
    const picks = compare.diffsWithManual.filter(d => selectedDiffKeys.has(d.diffKey) && d.dbId != null);
    if (picks.length === 0) { toast.error('请先勾选需要同步的行（且该行已绑定到数据库项目）'); return; }
    const fuzzyCount = picks.filter(p => p.matchKind === 'fuzzy' && (p.matchScore || 0) < 85).length;
    const scopeMap: Record<string, string> = {
      name: '项目名称',
      price: '定价',
      insured: '医保价',
      'price+insured': '定价+医保价',
      all: '项目名称+定价+医保价',
    };
    const nameDiffCount = picks.filter(p => p.dbName !== p.name).length;
    const hasNameScope = scope === 'name' || scope === 'all';
    let message = `确认将修改 ${picks.length} 条项目的${scopeMap[scope]}？`;
    if (hasNameScope && nameDiffCount > 0) message += `\n\n⚠️ 其中有 ${nameDiffCount} 条将用 PDF 名称覆盖 DB 原名称！套餐里显示的项目名会同步变化，建议确认 PDF 名称是最终规范写法。`;
    if (fuzzyCount > 0) message += `\n\n其中 ${fuzzyCount} 条为模糊匹配（<85%），建议人工核对。`;
    message += `\n\n此操作会写入数据库，不可撤销。`;
    if (!confirm(message)) return;
    setSyncProgress({ done: 0, total: picks.length, curr: null });
    let failed = 0;
    for (let i = 0; i < picks.length; i++) {
      const d = picks[i];
      setSyncProgress(s => s ? { ...s, done: i, curr: d.dbName || d.name } : s);
      try {
        const body: any = {};
        if (scope === 'name' || scope === 'all') {
          const newName = (d.name || '').trim();
          if (newName) body.name = newName;
        }
        if (scope === 'price' || scope === 'price+insured' || scope === 'all') body.default_price = d.pdfPrice;
        if (scope === 'insured' || scope === 'price+insured' || scope === 'all') body.insurance_price = d.pdfInsured;
        await bookingApi.updateCheckupItem(d.dbId!, body);
      } catch (e: any) {
        failed++;
        toast.error(`${d.dbName || d.name} 同步失败：${e.message || String(e)}`);
      }
    }
    setSyncProgress({ done: picks.length, total: picks.length, curr: null });
    toast.success(`同步完成：${picks.length - failed} 条成功${failed ? `，${failed} 条失败` : ''}`);
    setSelectedDiffKeys(new Set());
    setTimeout(() => setSyncProgress(null), 1200);
    await load();
  };

  return (
    <div className="space-y-4">
      {/* 顶部操作栏：搜索 + 新增 + 价格对拍 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索项目名或编码..."
            className={`${inputCls} !pl-8 !py-2`}
          />
        </div>
        {isAdmin && !editing && (
          <button onClick={() => setEditing({ mode: 'create', data: { ...DEFAULT_CHECKUP, code: generateCode(rows) } })} className={btnGold}>
            <Plus size={12} /> 新增体检项目
          </button>
        )}
        {isAdmin && !editing && (
          <>
            <button
              onClick={async () => {
                // 【生产数据保护】走后端 wipeAllCheckupItems 事务接口：
                // 1) 不会漏掉 status=0（之前 list 接口只返回 status!=0，rows 里拿不到，循环删必然漏）
                // 2) 自动 booking_package_items.item_id NOT NULL 兜底（ALTER MODIFY→DELETE），不会因FK静默失败
                // 3) 一次性事务，返回明确的 affected 数量；后端会 console.warn 留审计日志
                // ⚠️ 注意：执行后体检项目库完全为空，编码将从 T00001 重置；
                //        套餐本身不删除，只是 item_id 置空（套餐名/角色方案还在）
                let total = rows.length || 0;
                if (total === 0) total = 999;
                const tip1 = window.prompt(`⚠️ ⚠️ ⚠️ 将删除全部体检项目（含禁用项、组合子项目引用），编码将从 T00001 重置。\n\n✅ 安全：不删套餐本身，只会解除"套餐-体检项目"关联。\n❌ 危险：体检项目库将完全为空，需要重新从PDF导入！\n\n请输入 "确定清空体检项目" 以继续：`);
                if (tip1 !== '确定清空体检项目') { toast.info('已取消'); return; }
                if (!window.confirm(`删除后无法恢复！再次确认？\n（清空后请立即：粘贴PDF→📥从PDF批量导入→🔖批量修正分类/类型）`)) return;
                setSyncProgress({ done: 0, total: 1, msg: '正在批量清空...' });
                try {
                  const info = await bookingApi.wipeAllCheckupItems();
                  setSyncProgress({ done: 1, total: 1, msg: '清空完成' });
                  toast.success(`清空完成：删除体检项目 ${info.deleted} 条，清理组合引用 ${info.subItemsCleared} 条，解除套餐引用 ${info.packageItemsFixed} 条（后端审计日志已记录）`);
                } catch (e: any) {
                  toast.error(e.message || '批量清空失败');
                } finally {
                  setSyncProgress(null);
                  await loadRows();
                }
              }}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm border border-rose-700"
              title="删除所有体检项目（含禁用项）并将编码从T00001重新开始"
            >
              🗑️ 清空全部重导
            </button>
            <button
              onClick={async () => {
                if (!pdfText) { toast.error('请先在「PDF价格对拍」中粘贴PDF文本后再点此按钮'); return; }
                // 用 priceCompare 解析出所有 parsed 行（不管是否 matched），然后对于 DB 里没有的（pdfUnmatchedView + 冲突中没对应的 + 差异里已绑定的跳过）
                // 简单起见：调用 priceCompare 拿到所有已解析的 PDF 行（不区分 match 与否），然后对每一条：
                //   若已在 DB 里存在（通过名称归一化完全相同 或 manualBindMap 绑定）则跳过创建
                //   否则 createCheckupItem，编码按 rows 现有（同步过程中会逐渐增加）
                if (!window.confirm('将对 PDF 中成功解析的项目逐一创建为 DB 体检项目（已存在同名的不重复创建）。确认？')) return;
                // 1. 重新解析出所有 PDF name+insured+price（简单行解析）
                const allPdfRows: Array<{ name: string; insurance_price: number; default_price: number }> = [];
                const lines = pdfText.split(/\r?\n/);
                for (const raw of lines) {
                  const line = raw.replace(/^\s+|\s+$/g, '');
                  if (!line) continue;
                  if (/项目名称|医保价格|定价|2023最新定价/.test(line)) continue;
                  const parts = line.split(/\t+|,|\u3001|\u0020{2,}|\s{2,}|，/).map(s => s.replace(/^\s+|\s+$/g, '')).filter(Boolean);
                  if (parts.length < 2) continue;
                  const digits = parts.map(p => parsePrice(p));
                  let priceIdx = -1, insuredIdx = -1;
                  for (let i = digits.length - 1; i >= 0; i--) {
                    if (digits[i] !== null && priceIdx < 0) { priceIdx = i; continue; }
                    if (digits[i] !== null && insuredIdx < 0) { insuredIdx = i; break; }
                  }
                  if (priceIdx < 0) continue;
                  const nameParts = insuredIdx < 0 ? parts.slice(0, priceIdx) : parts.slice(0, insuredIdx);
                  const name = nameParts.join(' ').trim();
                  const pdfPrice = parsePrice(parts[priceIdx]);
                  const pdfInsured = insuredIdx >= 0 ? parsePrice(parts[insuredIdx]) : null;
                  if (!name || pdfPrice === null) continue;
                  allPdfRows.push({ name, insurance_price: pdfInsured ?? 0, default_price: pdfPrice });
                }
                if (!allPdfRows.length) { toast.error('从PDF文本中未解析出有效行'); return; }
                // 2. 取到当前 rows，归一化 name → row 做快速查重
                const load = await bookingApi.listCheckupItems();
                const createdNames = new Set(load.map(r => normalize(r.name)));
                // 对于 manualBindMap 绑定了的（pdf name → dbId），也视为已存在，不重新建
                for (const [k, v] of Object.entries(manualBindMap || {})) if (v) createdNames.add(k);
                let created = 0, skipped = 0, fail = 0;
                // 临时的 growing rows，生成编码用（每 create 一条往里面 push，保证编码递增连续）
                const forCode: CheckupItemRow[] = load.slice();
                for (let i = 0; i < allPdfRows.length; i++) {
                  const r = allPdfRows[i];
                  if (createdNames.has(normalize(r.name))) { skipped++; continue; }
                  try {
                    const code = generateCode(forCode);
                    const category = inferCategory(r.name);
                    const item_type = inferItemType(r.name);
                    const row = await bookingApi.createCheckupItem({
                      code, name: r.name.trim(),
                      item_type,
                      category,
                      description: '',
                      default_price: r.default_price,
                      insurance_price: r.insurance_price ?? 0,
                      unit: '次',
                      status: 1,
                      sort_order: 100 + i,
                    });
                    forCode.push(row);
                    createdNames.add(normalize(row.name));
                    created++;
                  } catch (e: any) { fail++; console.error('创建失败', r.name, e.message || e); }
                  if (i % 5 === 0) setSyncProgress({ done: i + 1, total: allPdfRows.length, msg: `创建中 ${created} 成功 / ${skipped} 跳过 / ${fail} 失败` });
                }
                setSyncProgress(null);
                toast.success(`PDF 导入完成：成功新建 ${created} 条，已存在跳过 ${skipped} 条，失败 ${fail} 条`);
                await loadRows();
              }}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm border border-emerald-800"
              title="将PDF价目表已解析的所有项目批量创建为DB条目（自动推断分类和类型）"
            >
              📥 从PDF批量导入
            </button>
            <button
              onClick={async () => {
                if (!rows.length) { toast.warning('当前没有体检项目可被修正'); return; }
                if (!window.confirm(`将基于名称关键词推断并批量更新所有 ${rows.length} 条的 分类 + 类型(item/combo)，原有值将被覆盖。确认？`)) return;
                let updated = 0, fail = 0;
                for (let i = 0; i < rows.length; i++) {
                  const r = rows[i];
                  if (!r.id) continue;
                  const category = inferCategory(r.name);
                  const item_type = inferItemType(r.name);
                  if (category === r.category && item_type === r.item_type) continue;
                  try {
                    await bookingApi.updateCheckupItem(r.id, { category, item_type });
                    updated++;
                  } catch (e: any) { fail++; console.error('分类修正失败', r.name, e.message || e); }
                  if (i % 5 === 0) setSyncProgress({ done: i + 1, total: rows.length, msg: `已修正 ${updated}/${rows.length}` });
                }
                setSyncProgress(null);
                toast.success(`分类&类型修正完成：成功更新 ${updated} 条，失败 ${fail} 条`);
                await loadRows();
              }}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm border border-indigo-700"
              title="按名称关键词把全部项目重分到7大类 + 自动标记组合项目(combo)"
            >
              🔖 批量修正分类/类型
            </button>
          </>
        )}
        <button onClick={() => setToolOpen(o => !o)} className={btnGhost}>
          <FileSpreadsheet size={12} />
          PDF 价格对拍 {toolOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* 分类 Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {categoryTabs.map(c => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
              catFilter === c
                ? 'bg-cyan-500 text-white font-medium'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-cyan-200'
            }`}
          >
            {c}
          </button>
        ))}
        {allCategories.extensions.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-amber-600 ml-auto px-2 py-0.5 rounded bg-amber-50 border border-amber-200">
            <AlertTriangle size={11} />
            另有 {allCategories.extensions.length} 个扩展分类（{allCategories.extensions.join('、')}），建议并入 7 大类
          </div>
        )}
      </div>

      {/* 统计栏 */}
      <div className="text-sm text-gray-600">
        共 <span className="font-medium text-gray-900">{filteredRows.length}</span> 条
        {comboCount > 0 && (
          <span className="ml-2 text-amber-600">（含 {comboCount} 个组合项目）</span>
        )}
        ，启用 <span className="text-cyan-600 font-medium">{enabledCount}</span> 条
      </div>

      {/* P5: 价格对拍工具面板 */}
      {toolOpen && (
        <div className="bg-gradient-to-br from-sky-50 to-white border border-sky-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-sky-900 flex items-center gap-2">
              <FileSpreadsheet size={15} />
              PDF 价格对拍工具
            </div>
            <span className="text-[11px] text-sky-600">粘贴 PDF 价目表 → 自动对拍 → 一键同步到数据库</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-sky-800 mb-1">
                粘贴 PDF 文本（每行格式：项目名 /t 医保价 /t 2023最新定价，允许列分隔符为制表符/逗号/中文空格）
              </label>
              <textarea
                value={pdfText}
                onChange={e => setPdfText(e.target.value)}
                rows={10}
                placeholder={'示例：\n血常规\t20\t35\n人体成分分析\t50\t120\n彩超-腹部\t100\t170'}
                className="w-full text-xs font-mono bg-white border border-sky-300 rounded-lg p-2 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-sky-800 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span>对拍结果</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">文本 {compare.totalLines} 行</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono">✅ 已解析 {compare.parsedCount}</span>
                  {compare.skipped.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-mono">❌ 跳过 {compare.skipped.length}（展开详情）</span>
                  )}
                  <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-mono">DB {compare.dbNameMap.size} 条</span>
                  {compare.pdfUnmatchedView.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-800 font-mono border border-rose-400">🔴 DB缺 {compare.pdfUnmatchedView.length} 条（见下方红块）</span>
                  )}
                  {compare.collisionsView.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 font-mono border border-amber-400">🟠 多对一冲突 {compare.collisionsView.length} 处</span>
                  )}
                </div>
                <span className="text-sky-700 font-semibold">差异 {compare.diffsWithManual.length}</span>
              </div>

              {/* C4: PDF 里有但 DB 完全没找到（最最醒目的红色块，避免"少了1条但看不到"） */}
              {pdfText && compare.pdfUnmatchedView.length > 0 && (
                <div className="mt-2 border border-rose-300 bg-rose-50 rounded-lg overflow-hidden p-2">
                  <div className="px-1 py-1 text-[12px] font-bold text-rose-800 mb-1 flex items-center justify-between">
                    <span>🔴 PDF 里有，但 DB 里完全找不到的项目（{compare.pdfUnmatchedView.length} 条）——这就是你说的"DB里缺了"的！</span>
                    <button
                      onClick={() => {
                        const names = compare.pdfUnmatchedView.map(r => r.name).join('，');
                        toast.info(`已复制 ${compare.pdfUnmatchedView.length} 个缺失项名称到剪贴板（可手动新建后再同步）`);
                        navigator.clipboard?.writeText(names);
                      }}
                      className="px-2 py-0.5 rounded bg-white border border-rose-300 text-[11px] text-rose-700 hover:bg-rose-100"
                    >📋 复制缺失名称</button>
                  </div>
                  <div className="max-h-48 overflow-auto bg-white rounded border border-rose-200">
                    <table className="w-full text-[11px]">
                      <thead className="bg-rose-100 text-rose-900 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left w-10">#</th>
                          <th className="px-2 py-1 text-left">PDF 项目名（DB里找不到）</th>
                          <th className="px-2 py-1 text-right w-24">PDF 医保价</th>
                          <th className="px-2 py-1 text-right w-24">PDF 定价</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compare.pdfUnmatchedView.map((r, i) => (
                          <tr key={i} className="border-t border-rose-100">
                            <td className="px-2 py-1 text-rose-500 font-mono">{i + 1}</td>
                            <td className="px-2 py-1 text-rose-900 font-mono break-all">{r.name}</td>
                            <td className="px-2 py-1 text-right text-slate-700 font-mono">¥{r.pdfInsured ?? '—'}</td>
                            <td className="px-2 py-1 text-right text-slate-700 font-mono">¥{r.pdfPrice ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* C4: 多对一冲突（多条不同PDF名共享同一DB行，DB可能少存1条） */}
              {pdfText && compare.collisionsView.length > 0 && (
                <div className="mt-2 border border-amber-300 bg-amber-50 rounded-lg overflow-hidden p-2">
                  <div className="px-1 py-1 text-[12px] font-bold text-amber-800 mb-1">
                    🟠 多条 PDF 行共享同一条 DB 项目（{compare.collisionsView.length} 处冲突）——"总数对但好像少了"的典型表现：PDF 2 条项目被合并匹配到 DB 1 条上，说明 DB 里缺存了其中 1 条的独立项目
                  </div>
                  <div className="space-y-2 max-h-72 overflow-auto">
                    {compare.collisionsView.map(c => (
                      <div key={c.dbId} className="border border-amber-200 rounded bg-white p-2">
                        <div className="text-[11px] font-semibold text-slate-800 mb-1">
                          DB 项目：<span className="font-mono">{c.dbRow.name}</span>
                          <span className="ml-2 text-slate-500 font-mono">医保¥{c.dbRow.insurance_price ?? 0} / 定价¥{c.dbRow.default_price ?? 0}</span>
                        </div>
                        <table className="w-full text-[10.5px]">
                          <thead className="bg-amber-100 text-amber-900">
                            <tr>
                              <th className="px-2 py-0.5 text-left w-20">匹配类型/分</th>
                              <th className="px-2 py-0.5 text-left">PDF 中的行名</th>
                              <th className="px-2 py-0.5 text-right w-24">PDF 医保</th>
                              <th className="px-2 py-0.5 text-right w-24">PDF 定价</th>
                              <th className="px-2 py-0.5 text-left w-14">判断</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.pdfHits.map((h, i) => {
                              const same = normalize(h.pdfName) === normalize(c.dbRow.name);
                              return (
                                <tr key={i} className={`border-t border-amber-100 ${same ? '' : 'bg-rose-50/50'}`}>
                                  <td className="px-2 py-0.5">
                                    <span className="text-sky-700 font-mono">{h.kind ?? '-'}</span>
                                    <span className="ml-1 text-slate-500">{h.score}</span>
                                  </td>
                                  <td className="px-2 py-0.5 font-mono break-all">{h.pdfName}</td>
                                  <td className="px-2 py-0.5 text-right font-mono">¥{h.pdfInsured ?? '—'}</td>
                                  <td className="px-2 py-0.5 text-right font-mono">¥{h.pdfPrice ?? '—'}</td>
                                  <td className="px-2 py-0.5">
                                    {same
                                      ? <span className="text-emerald-700">自身</span>
                                      : <span className="text-rose-700 font-semibold">⚠️ 可能缺</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* A4: 批量同步工具栏 */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <label className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-100/60 text-sky-800">
                    <input
                      type="checkbox"
                      className="accent-sky-600"
                      checked={
                        compare.diffsWithManual.length > 0 &&
                        compare.diffsWithManual
                          .filter(d => d.dbId != null)
                          .every(d => selectedDiffKeys.has(d.diffKey))
                      }
                      onChange={e => {
                        const targets = compare.diffsWithManual.filter(d => d.dbId != null);
                        setSelectedDiffKeys(new Set(e.target.checked ? targets.map(d => d.diffKey) : []));
                      }}
                    />
                    全选（已绑定）
                  </label>
                  <span className="text-gray-500">
                    已选 {compare.diffsWithManual.filter(d => selectedDiffKeys.has(d.diffKey)).length} 条
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => applySelected('name')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold shadow-sm"
                    title="只覆盖项目名称（不改价格）"
                  >
                    <Save size={11} /> 应用PDF名称
                  </button>
                  <button
                    onClick={() => applySelected('price')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 应用PDF定价
                  </button>
                  <button
                    onClick={() => applySelected('insured')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 应用PDF医保价
                  </button>
                  <button
                    onClick={() => applySelected('price+insured')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 同步价格
                  </button>
                  <button
                    onClick={() => applySelected('all')}
                    disabled={!isAdmin || syncProgress !== null}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-semibold shadow-sm"
                  >
                    <Save size={11} /> 全部同步（含名称）
                  </button>
                </div>
              </div>
              {/* A5 进度条 */}
              {syncProgress && (
                <div className="text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-gray-600">
                    <span>同步进度 {syncProgress.done}/{syncProgress.total}</span>
                    <span className="text-gray-500 truncate max-w-[60%]">{syncProgress.msg || syncProgress.curr}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-sky-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-200"
                      style={{ width: `${syncProgress.total ? (syncProgress.done / syncProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {compare.diffsWithManual.length === 0 && pdfText ? (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-4 text-center">
                  ✅ 所有已解析的 PDF 项目与数据库定价完全一致
                </div>
              ) : (
                <div className="max-h-64 overflow-auto border border-sky-200 rounded-lg bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="bg-sky-50 text-sky-900 sticky top-0">
                      <tr>
                        <th className="px-1.5 py-1.5 w-7 text-center">选</th>
                        <th className="text-left px-2 py-1.5">项目 (PDF 名 / 绑定DB名)</th>
                        <th className="text-center px-2 py-1.5 w-20">匹配</th>
                        <th className="text-right px-2 py-1.5">PDF定价</th>
                        <th className="text-right px-2 py-1.5">数据库</th>
                        <th className="text-right px-2 py-1.5">PDF医保</th>
                        <th className="text-right px-2 py-1.5">数据库医保</th>
                        <th className="text-center px-2 py-1.5">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.diffsWithManual.slice(0, 80).map((d) => {
                        const matchBadge = (() => {
                          if (d.matchKind === 'exact') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700">精确</span>;
                          if (d.matchKind === 'short') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-sky-100 text-sky-700">短名{d.matchScore ?? 0}%</span>;
                          if (d.matchKind === 'fuzzy') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800">模糊{(d.matchScore ?? 0)}%</span>;
                          if (d.matchKind === 'manual') return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-indigo-100 text-indigo-700">手绑</span>;
                          return <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500">未匹配</span>;
                        })();
                        const key = normalize(d.name);
                        const isFuzzyLow = d.matchKind === 'fuzzy' && (d.matchScore || 0) < 85;
                        return (
                          <tr key={d.diffKey} className={`border-t border-gray-100 ${
                            d.reason === '缺' ? 'bg-rose-50'
                              : d.reason === '定价差' ? 'bg-amber-50'
                              : d.reason === '医保价差' ? 'bg-violet-50'
                              : isFuzzyLow ? 'bg-gray-50/80'
                              : ''
                          }`}>
                            <td className="text-center px-1.5 py-1.5 align-middle">
                              <input
                                type="checkbox"
                                disabled={d.dbId == null}
                                checked={selectedDiffKeys.has(d.diffKey)}
                                onChange={e => {
                                  const next = new Set(selectedDiffKeys);
                                  if (e.target.checked) next.add(d.diffKey);
                                  else next.delete(d.diffKey);
                                  setSelectedDiffKeys(next);
                                }}
                                className="accent-sky-600 disabled:opacity-30"
                              />
                            </td>
                            <td className="px-2 py-1.5 align-middle">
                              <div className="text-gray-800 font-medium">{d.name}</div>
                              {d.dbName && d.dbName !== d.name && (
                                <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                  ↳ {d.dbCode && <span className="text-slate-400">{d.dbCode}</span>}
                                  {d.dbName}
                                </div>
                              )}
                              {/* A2 手动绑定下拉：始终显示，"缺"和"模糊/短名"都能改绑 */}
                              <div className="mt-1">
                                <select
                                  className="w-full text-[10.5px] bg-sky-50/60 border border-sky-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500 text-gray-700"
                                  value={manualBindMap[key] ?? d.dbId ?? ''}
                                  onChange={e => {
                                    const val = e.target.value || null;
                                    setManualBindMap(prev => {
                                      const next = { ...prev };
                                      if (val === null) delete next[key];
                                      else next[key] = val;
                                      return next;
                                    });
                                  }}
                                >
                                  <option value="">-- 未绑定 / 自动匹配 --</option>
                                  <optgroup label="所有数据库项目（按分类）">
                                    {(() => {
                                      const grouped = new Map<string, CheckupItemRow[]>();
                                      compare.dbRows.forEach(r => {
                                        const cat = r.category || '未分类';
                                        if (!grouped.has(cat)) grouped.set(cat, []);
                                        grouped.get(cat)!.push(r);
                                      });
                                      return Array.from(grouped.entries()).flatMap(([cat, list]) =>
                                        list.map(r => (
                                          <option key={r.id} value={r.id}>
                                            [{cat}] {r.code} {r.name} {Number(r.default_price) > 0 ? `¥${r.default_price}` : ''}
                                          </option>
                                        ))
                                      );
                                    })()}
                                  </optgroup>
                                </select>
                              </div>
                            </td>
                            <td className="text-center px-2 py-1.5 align-middle">{matchBadge}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.pdfPrice !== null ? '¥' + d.pdfPrice : '-'}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.dbPrice !== null ? '¥' + d.dbPrice : '-'}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.pdfInsured !== null ? '¥' + d.pdfInsured : '-'}</td>
                            <td className="px-2 py-1.5 text-right align-middle font-mono">{d.dbInsured !== null ? '¥' + d.dbInsured : '-'}</td>
                            <td className="px-2 py-1.5 text-center align-middle">
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                                d.reason === '缺' ? 'bg-rose-100 text-rose-700'
                                  : d.reason === '定价差' ? 'bg-amber-100 text-amber-800'
                                  : d.reason === '医保价差' ? 'bg-violet-100 text-violet-800'
                                  : d.reason === '定价差+医保' ? 'bg-orange-100 text-orange-800'
                                  : 'bg-gray-100 text-gray-600'
                              }`}>{d.reason}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {compare.diffsWithManual.length > 80 && (
                        <tr>
                          <td colSpan={8} className="text-center text-[11px] text-gray-400 py-1.5">
                            还有 {compare.diffsWithManual.length - 80} 条，请缩小粘贴范围或直接在数据库查看
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {compare.matchedCount > 0 && (
                <div className="text-[10.5px] text-emerald-700">
                  ✔ 对拍一致 {compare.matchedCount} 条（定价 + 医保价都相等）
                </div>
              )}
              {compare.unknownNames.length > 0 && (
                <div className="text-[10.5px] text-sky-700">
                  🟡 PDF 里有 {compare.unknownNames.length} 条未在数据库找到：{compare.unknownNames.slice(0, 5).join('、')}{compare.unknownNames.length > 5 ? '...' : ''}
                  （可点该行"未绑定"下拉手动绑定到 DB 中最相似的项目）
                </div>
              )}
              <div className="text-[10.5px] text-slate-500 mt-2 leading-relaxed">
                ⚠️ 说明：由于 PDF 表格的 OCR 或人工导出格式可能有误差，建议配合"匹配"列确认：
                <span className="mx-1 px-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">精确</span>
                <span className="mx-1 px-1 rounded bg-sky-50 text-sky-700 border border-sky-200">短名70%~100%</span>
                <span className="mx-1 px-1 rounded bg-amber-50 text-amber-800 border border-amber-200">模糊75%~85%</span>
                <span className="mx-1 px-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">手绑</span>
                。<span className="text-rose-600">模糊 &lt;85% 的行默认不勾选</span>，请人工核对后再勾选同步。
              </div>

              {/* 解析跳过明细（skipped） + 反向未匹配表 */}
              {pdfText && compare.skipped.length > 0 && (
                <details className="mt-2 border border-rose-200 rounded-lg overflow-hidden">
                  <summary className="px-3 py-1.5 bg-rose-50 text-[11px] text-rose-800 cursor-pointer font-medium">
                    ⚠️ 解析失败/跳过的 {compare.skipped.length} 行（含行号 + 原始内容 + 跳过原因，方便你修正粘贴文本）
                  </summary>
                  <div className="max-h-40 overflow-auto bg-white">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 w-14 text-center">行号</th>
                          <th className="px-2 py-1 text-left">原始内容</th>
                          <th className="px-2 py-1 text-left">跳过原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compare.skipped.slice(0, 100).map(s => (
                          <tr key={s.lineNo} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-center text-gray-500 font-mono">{s.lineNo}</td>
                            <td className="px-2 py-1 text-gray-800 break-all font-mono">{s.raw}</td>
                            <td className="px-2 py-1 text-rose-700">{s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* A3 反向未匹配表：DB有但PDF未提及 */}
              {pdfText && compare.dbUnmatched.length > 0 && (
                <details className="mt-2 border border-sky-200 rounded-lg overflow-hidden">
                  <summary className="px-3 py-1.5 bg-sky-50 text-[11px] text-sky-800 cursor-pointer font-medium">
                    ℹ️ DB中有但PDF未提及的项目：{compare.dbUnmatched.length} 条
                    （其中 <span className="text-amber-700">{compare.dbUnmatched.filter(r => Number(r.insurance_price) || 0 === 0).length}</span> 条无医保价，
                    <span className="text-gray-700">{compare.dbUnmatched.filter(r => Number(r.status) === 1).length}</span> 条已启用）
                  </summary>
                  <div className="max-h-40 overflow-auto bg-white">
                    <table className="w-full text-[10.5px]">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left">编码</th>
                          <th className="px-2 py-1 text-left">名称</th>
                          <th className="px-2 py-1 text-left">分类</th>
                          <th className="px-2 py-1 text-right">定价</th>
                          <th className="px-2 py-1 text-right">医保价</th>
                          <th className="px-2 py-1 text-center">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compare.dbUnmatched.slice(0, 50).map(r => {
                          const missIns = (Number(r.insurance_price) || 0) === 0;
                          return (
                            <tr key={r.id} className={`border-t border-gray-100 ${missIns ? 'bg-amber-50/60' : ''}`}>
                              <td className="px-2 py-1 text-gray-600">{r.code}</td>
                              <td className="px-2 py-1 text-gray-800">{r.name}</td>
                              <td className="px-2 py-1 text-gray-600">{r.category || '-'}</td>
                              <td className="px-2 py-1 text-right font-mono">¥{Number(r.default_price) || 0}</td>
                              <td className="px-2 py-1 text-right font-mono">
                                {missIns ? <span className="text-amber-700">⚠未录入</span> : `¥${Number(r.insurance_price) || 0}`}
                              </td>
                              <td className="px-2 py-1 text-center">
                                {Number(r.status) === 1
                                  ? <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px]">启用</span>
                                  : <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 text-[10px]">停用</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-500 text-sm bg-white rounded-lg border border-dashed border-gray-200">
          <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
          加载中...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-20">编码</th>
                <th className="px-3 py-2 text-left font-medium">名称</th>
                <th className="px-3 py-2 text-left font-medium w-20">类型</th>
                <th className="px-3 py-2 text-left font-medium w-24">分类</th>
                <th className="px-3 py-2 text-right font-medium w-28">默认定价(¥)</th>
                <th className="px-3 py-2 text-right font-medium w-28">医保价格(¥)</th>
                <th className="px-3 py-2 text-center font-medium w-16">单位</th>
                <th className="px-3 py-2 text-center font-medium w-16">排序</th>
                <th className="px-3 py-2 text-center font-medium w-16">状态</th>
                <th className="px-3 py-2 text-center font-medium w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {isCreating && (
                <>
                  <tr className="bg-cyan-50/50 border-b border-gray-100">
                    <td className="px-2 py-1.5"><Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /></td>
                    <td className="px-2 py-1.5">
                      <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} />
                      {(() => {
                        const lb = appRoleLabel(editing!.data.applicable_roles as any);
                        return lb ? <div className="mt-1"><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800">{lb}</span></div> : null;
                      })()}
                      {/* 体检意义 */}
                      <input
                        value={editing!.data.clinical_significance || ''}
                        onChange={(e) => setField('clinical_significance', e.target.value)}
                        placeholder="体检意义（客户展示页可见）"
                        className="mt-1 w-full text-[10px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-400"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={editing!.data.item_type || 'item'}
                        onChange={(e) => setField('item_type', e.target.value)}
                        className={inputCls + ' text-xs !py-1'}
                      >
                        <option value="item">普通项目</option>
                        <option value="combo">组合项目</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={editing!.data.category || DEFAULT_CATEGORY}
                        onChange={(e) => setField('category', e.target.value)}
                        className={inputCls + ' text-xs !py-1'}
                      >
                        {categoryTabs.filter(c => c !== '全部').concat(allCategories.extensions).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} /></td>
                    <td className="px-2 py-1.5">
                      <Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0}
                        onChange={(v) => setField('insurance_price', v)}
                        warn={Number(editing?.data.default_price) > 0 && (Number(editing?.data.insurance_price) || 0) === 0}
                        placeholder={Number(editing?.data.default_price) > 0 ? '⚠ 建议补录医保价' : ''}
                      />
                    </td>
                    <td className="px-2 py-1.5"><Upd value={editing!.data.unit} onChange={(v) => setField('unit', v)} /></td>
                    <td className="px-2 py-1.5"><Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /></td>
                    <td className="px-2 py-1.5 text-center"><Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} /></td>
                    <td className="px-2 py-1.5 text-center space-x-1">
                      <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => handleSave(editing!.data)}>
                        {saving ? '保存中' : <><Save size={10} /> 保存</>}
                      </RowBtn>
                      <RowBtn onClick={() => setEditing(null)}>取消</RowBtn>
                    </td>
                  </tr>
                  {renderSubItemPickerSummary()}
                  {renderApplicablePicker()}
                </>
              )}
              {filteredRows.length === 0 && !isCreating && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-gray-400 text-sm">暂无匹配的体检项目</td>
                </tr>
              )}
              {filteredRows.map(r => {
                const editRow = isEditingThis(r);
                const defaultPrice = Number(r.default_price || 0);
                const insurancePrice = Number(r.insurance_price || 0);
                const insuranceMissing = defaultPrice > 0 && insurancePrice === 0;
                return (
                  <React.Fragment key={r.id}>
                    <tr className={`border-t border-gray-100 hover:bg-gray-50/50 ${insuranceMissing ? 'bg-amber-50/30' : ''}`}>
                      <td className="px-3 py-2 font-mono">
                        {editRow ? <Upd value={editing!.data.code} onChange={(v) => setField('code', v)} /> : <span className="font-semibold">{r.code}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? (
                          <div>
                            <Upd value={editing!.data.name} onChange={(v) => setField('name', v)} />
                            {(() => {
                              const lb = appRoleLabel(editing!.data.applicable_roles as any);
                              return lb ? <div className="mt-1"><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800">{lb}</span></div> : null;
                            })()}
                            {/* 体检意义 */}
                            <input
                              value={editing!.data.clinical_significance || ''}
                              onChange={(e) => setField('clinical_significance', e.target.value)}
                              placeholder="体检意义（客户展示页可见）"
                              className="mt-1 w-full text-[10px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-cyan-400"
                            />
                          </div>
                        ) : (
                          <div>
                            <span className="inline-flex items-center">
                              {insuranceMissing && <AlertTriangle size={12} className="text-amber-500 mr-1" aria-label="医保价未录入" />}
                              <span>{r.name}</span>
                              {typeLabel(r)}
                            </span>
                            {(() => {
                              const lb = appRoleLabel(r.applicable_roles);
                              return lb ? <div className="mt-0.5"><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800">{lb}</span></div> : null;
                            })()}
                            {/* 展示体检意义摘要 */}
                            {r.clinical_significance && (
                              <div className="mt-0.5 text-[10px] text-gray-400 truncate max-w-[240px]">
                                体检意义：{r.clinical_significance}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? (
                          <select value={editing!.data.item_type || 'item'} onChange={(e) => setField('item_type', e.target.value)}
                            className={inputCls + ' text-xs !py-1'}>
                            <option value="item">普通项目</option>
                            <option value="combo">组合项目</option>
                          </select>
                        ) : r.item_type === 'combo' ? (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">组合</span>
                        ) : (
                          <span className="text-[10px] text-gray-400">普通</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editRow ? (
                          <select value={editing!.data.category || r.category} onChange={(e) => setField('category', e.target.value)}
                            className={inputCls + ' text-xs !py-1'}>
                            {categoryTabs.filter(c => c !== '全部').concat(allCategories.extensions).map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : r.category}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {editRow ? <Upd type="number" step="0.01" value={editing!.data.default_price} onChange={(v) => setField('default_price', v)} />
                          : `¥${defaultPrice.toLocaleString()}`}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${insuranceMissing ? 'text-amber-600 font-semibold' : 'text-indigo-600'}`}>
                        {editRow ? (
                          <Upd type="number" step="0.01" value={editing!.data.insurance_price ?? 0}
                            onChange={(v) => setField('insurance_price', v)}
                            warn={Number(editing?.data.default_price) > 0 && (Number(editing?.data.insurance_price) || 0) === 0}
                          />
                        ) : insuranceMissing
                          ? <span className="inline-flex items-center gap-1" title="医保价未录入，请补录"><AlertTriangle size={11} /> 未录入</span>
                          : `¥${insurancePrice.toLocaleString()}`
                        }
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editRow ? <Upd value={editing!.data.unit} onChange={(v) => setField('unit', v)} /> : r.unit}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editRow ? <Upd type="number" value={editing!.data.sort_order} onChange={(v) => setField('sort_order', v)} /> : r.sort_order}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {editRow ? <Checkbox value={editing!.data.status} onChange={(v) => setField('status', v)} />
                          : r.status === 1 ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">● 禁用</span>}
                      </td>
                      <td className="px-3 py-2 text-center space-x-1">
                        {editRow ? (
                          <>
                            <RowBtn cls="!bg-green-500 !text-white !border-green-500 hover:!bg-green-600" onClick={() => handleSave(editing!.data)}>
                              {saving ? '保存中' : <><Save size={10} /> 保存</>}
                            </RowBtn>
                            <RowBtn onClick={() => setEditing(null)}>取消</RowBtn>
                          </>
                        ) : (
                          <>
                            {isAdmin && (
                              <>
                                <RowBtn onClick={() => setEditing({ mode: 'update', data: { ...r, sub_item_ids: (r.sub_items || []).map((si: any) => si.sub_item_id ?? si.id) } })}>
                                  {insuranceMissing ? '补录' : '编辑'}
                                </RowBtn>
                                <RowBtn cls="!text-red-500 hover:!bg-red-50 !border-red-200" onClick={() => handleDel(r)}>
                                  <Trash2 size={10} /> 禁用
                                </RowBtn>
                              </>
                            )}
                            {!isAdmin && <span className="text-[10px] text-gray-400">仅管理员</span>}
                          </>
                        )}
                      </td>
                    </tr>
                    {editRow && renderSubItemPickerSummary()}
                    {editRow && renderApplicablePicker()}
                    {!editRow && r.item_type === 'combo' && r.sub_items && r.sub_items.length > 0 && (
                      <tr className="bg-amber-50/30 border-t-0">
                        <td colSpan={10} className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[10px] text-gray-400">包含：</span>
                            {r.sub_items.map((si: any, i: number) => (
                              <span key={i} className="text-[10px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">
                                {si.name} ¥{Number(si.default_price || 0)}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 子项目选择弹窗 */}
      {renderSubItemPickerModal()}
    </div>
  );
}

// --------- P5: 价格对拍解析（升级版：A1 3层匹配 + 括号内token排序 + 别名表）---------
interface DiffRow {
  name: string;
  pdfPrice: number | null;
  dbPrice: number | null;
  pdfInsured: number | null;
  dbInsured: number | null;
  reason: '缺' | '定价差' | '医保价差' | '定价差+医保' | '其他';
  // A1 匹配增强字段
  dbId?: string | null;
  dbName?: string | null;
  dbCode?: string | null;
  matchKind?: 'exact' | 'short' | 'fuzzy' | 'manual' | null;
  matchScore?: number; // 0~100
}
interface PriceCompareResult {
  parsedCount: number;
  totalLines: number; // 文本非空行数
  diffs: DiffRow[];
  matchedCount: number;
  unknownNames: string[];
  skipped: Array<{ lineNo: number; raw: string; reason: string; parts?: string[]; digits?: (number|null)[] }>;
  dbNameMap: Map<string, CheckupItemRow>;
  dbRows: CheckupItemRow[];
  // A3: DB侧未被PDF引用的项目
  dbUnmatched: CheckupItemRow[];
  // A1 已被 PDF 命中过的 db id 集合，用于计算 dbUnmatched
  hitDbIds: Set<string>;
  // C4: 多对一冲突 —— 1 条 DB 行被 ≥2 条不同 PDF 行同时命中
  collisions: Array<{
    dbId: string;
    dbRow: CheckupItemRow;
    pdfHits: Array<{ pdfName: string; pdfPrice: number|null; pdfInsured: number|null; kind: any; score: number }>;
  }>;
  // C4: PDF 侧完全没匹配到任何 DB 行的明细（比 unknownNames 更详细，含价格）
  pdfUnmatched: Array<{ name: string; pdfPrice: number|null; pdfInsured: number|null }>;
}

// 常见别名（等价词）：PDF里的写法 ↔ DB里的写法。命中任意一个别名即视为相同主体
const ALIASES: [string, string[]][] = [
  ['免疫三项', ['igaiggigm三项', '免疫三项igaiggigm', '免疫3项', 'iga、igm、igg三项']],
  ['三系统', ['三对', '乙肝三系统', '乙肝三对']],
  ['乙肝两对半', ['乙型肝炎病毒5项', '乙肝5项', '乙型肝炎五项', 'hbv-m']],
  ['肝功能', ['肝功']],
  ['肾功能', ['肾功']],
  ['甲状腺功能', ['甲功', '甲功五项', '甲功5项']],
  ['肿瘤标志物', ['肿瘤标记物', '肿瘤筛查标志物', '肿标']],
  ['微量元素', ['微量元']],
  ['微量元素检测5项', ['微量元素5项', '微量元素检测五项']],
  ['微量元素检测6项', ['微量元素6项', '微量元素检测六项']],
  ['微量元素检测7项', ['微量元素7项', '微量元素检测七项']],
  ['人乳头瘤病毒', ['hpv', '人乳头状瘤病毒']],
  ['eb病毒壳抗原iga抗体', ['eb病毒壳抗原iga', ['eb病毒vca-iga'] as any, ['ebvca-iga'] as any]],
  ['血脂四项', ['血脂4项']],
  ['血常规', ['血细胞分析', ['血rt'] as any]],
  ['尿常规', ['尿液分析', ['尿rt'] as any]],
  ['粪常规', ['便常规', ['粪rt'] as any, ['便rt'] as any]],
  ['肝纤维化', ['肝纤四项', '肝纤4项']],
  ['血清肌钙蛋白', ['肌钙蛋白i', '肌钙蛋白t']],
  ['过敏原检测', ['过敏原筛查', '过敏源检测']],
  ['幽门螺杆菌', ['c14呼气', 'c13呼气', ['hp呼气'] as any, ['h.pylori'] as any]],
  ['彩超-腹部', ['腹部彩超', '彩超腹部']],
  ['彩超-甲状腺', ['甲状腺彩超', '彩超甲状腺']],
  ['彩超-心脏', ['心脏彩超', '彩超心脏', '心脏彩色多普勒超声']],
  ['彩超-妇科', ['妇科彩超', '彩超妇科']],
  ['ct-胸部', ['胸部ct', ['ct胸部'] as any]],
  ['胸部正侧位片', ['胸片', '胸部x线']],
  ['心电图', ['12导联心电图', '静息心电图']],
  ['肺功能', ['肺功能测定']],
  ['人体成分分析', ['inbody', '体成分分析']],
  ['骨密度', ['骨密度测定']],
  ['动脉硬化', ['动脉硬化检测']],
  ['碳13', ['c13']],
  ['碳14', ['c14']],
];

// 规范化：去掉所有空格 / 中英文括号统一 / 大小写 / 常见符号
function normalize(s: string) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/％/g, '%')
    .replace(/·/g, '')
    .replace(/﹣/g, '-').replace(/－/g, '-')
    .replace(/，/g, ',').replace(/：/g, ':')
    .replace(/①/g, '1').replace(/②/g, '2').replace(/③/g, '3').replace(/④/g, '4')
    .replace(/⑤/g, '5').replace(/⑥/g, '6').replace(/⑦/g, '7').replace(/⑧/g, '8')
    .replace(/⑨/g, '9').replace(/⑩/g, '10')
    .replace(/Ⅰ/g, 'i').replace(/Ⅱ/g, 'ii').replace(/Ⅲ/g, 'iii').replace(/Ⅳ/g, 'iv').replace(/Ⅴ/g, 'v')
    .replace(/Ⅵ/g, 'vi').replace(/Ⅶ/g, 'vii').replace(/Ⅷ/g, 'viii').replace(/Ⅸ/g, 'ix').replace(/Ⅹ/g, 'x')
    .replace(/\u00A0/g, '')
    .replace(/[\[\]]/g, '')
    .toLowerCase();
}

// 提取 括号外主名 + 括号内容 tokens 排序后拼接
function decompose(s: string): { main: string; bracketSorted: string; tokens: Set<string> } {
  const n = normalize(s);
  // 去掉所有括号及内容得到"主名"
  const main = n.replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '');
  // 收集括号内容，去空
  const bracketMatchList = [...n.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
  const bracket = bracketMatchList.join(',');
  // 括号内容切分成 token：按 顿号/逗号/空格/分号/斜线/加号/和 拆分
  const tokensRaw = bracket.split(/[、，,\/\\+;\s]/).map(t => t.trim()).filter(Boolean);
  // 常见元素短别名展开：ca=钙, fe=铁, zn=锌, se=硒, cu=铜, mn=锰, mg=镁, sr=锶, cr=镉, pb=铅, hg=汞, as=砷, k=钾, na=钠, cl=氯
  const ELEM_ALIAS: Record<string, string> = {
    ca: '钙', fe: '铁', zn: '锌', se: '硒', cu: '铜', mn: '锰', mg: '镁',
    sr: '锶', cr: '镉', pb: '铅', hg: '汞', as: '砷', k: '钾', na: '钠', cl: '氯',
    p: '磷', s: '硫', i: '碘', mo: '钼', co: '钴', ni: '镍', ge: '锗', v: '钒',
    iga: '免疫球蛋白a', igg: '免疫球蛋白g', igm: '免疫球蛋白m',
    'hp-iii': '幽门螺杆菌iii型', 'hp-c-iv': '幽门螺杆菌civ型', 'cv-iv': 'cv4型', 'cv-iv-ln': 'cv4层粘连蛋白',
    'eb-vca-igm': 'eb病毒壳抗原igm', 'ebvca-igm': 'eb病毒壳抗原igm',
    'eb-vca-iga': 'eb病毒壳抗原iga', 'ebvca-iga': 'eb病毒壳抗原iga',
  };
  const tokens = new Set<string>();
  tokensRaw.forEach(t => {
    const e = ELEM_ALIAS[t.toLowerCase()] || t.toLowerCase();
    tokens.add(e);
  });
  // 主名也跑一遍别名展开（主名作为独立token加入集合，提升主名相似时的得分）
  const mainExpanded = expandAliases(main);
  if (mainExpanded && mainExpanded !== main) tokens.add(mainExpanded);
  const bracketSorted = [...tokens].sort().join('|');
  return { main, bracketSorted, tokens };
}

// 展开别名：若 s 命中某个别名列表，则替换成"标准名"（返回标准名 normalize 后的值）
function expandAliases(s: string): string {
  const n = normalize(s);
  for (const [std, alist] of ALIASES) {
    const ns = normalize(std);
    if (n === ns) return ns;
    if ((alist as any[]).map(String).map(normalize).includes(n)) return ns;
  }
  return n;
}

// Jaccard 相似度 = 交集/并集
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  a.forEach(v => { if (b.has(v)) inter++; });
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// 最长公共子序列长度 / 平均长度占比
function lcsRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (m * n > 250000) {
    // 字符串太大改用更便宜的"最长公共子串"
    return longestCommonSubstringRatio(a, b);
  }
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcsLen = dp[m][n];
  return (lcsLen * 2) / (m + n);
}
function longestCommonSubstringRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let max = 0;
  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > max) max = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    for (let j = 0; j <= n; j++) { prev[j] = curr[j]; curr[j] = 0; }
  }
  return (max * 2) / (m + n);
}

// 3 层匹配：返回 {db, matchKind, score}
function matchDbRow(
  pdfName: string,
  dbKeyMap: Map<string, CheckupItemRow>,        // exact key → row
  dbShortMap: Map<string, CheckupItemRow>,      // 去括号主名 → row（第一个）
  dbRows: CheckupItemRow[],
  allDecomposedDb: WeakMap<CheckupItemRow, ReturnType<typeof decompose>>,
): { db: CheckupItemRow | null; kind: DiffRow['matchKind']; score: number } {
  const pdfExp = expandAliases(pdfName);
  const { main: pdfMain, bracketSorted: pdfBracket, tokens: pdfTokens } = decompose(pdfExp);

  // 第 1 层：完全精确 key（主名 + 排序括号tokens）
  const exactKey = `${pdfMain}__${pdfBracket}`;
  const exact = dbKeyMap.get(exactKey);
  if (exact) return { db: exact, kind: 'exact', score: 100 };

  // 第 2 层：主名去括号后完全相同；若两边括号token jaccard ≥ 0.6 则算 short 命中（否则走模糊再兜底）
  const shortHit = dbShortMap.get(pdfMain);
  if (shortHit) {
    const d = allDecomposedDb.get(shortHit) || decompose(shortHit.name);
    const j = jaccard(pdfTokens, d.tokens);
    // 主名相同本身权重极高；即使括号内完全不同（j=0）也命中 short，但分数较低
    const score = 70 + Math.round(j * 30);
    return { db: shortHit, kind: 'short', score };
  }

  // 第 3 层：全局模糊，评分 = 主名 LCS 比*0.6 + tokens Jaccard*0.3 + 全名 LCS*0.1，≥75 命中
  let best: { row: CheckupItemRow; score: number } | null = null;
  for (const r of dbRows) {
    const d = allDecomposedDb.get(r) || decompose(r.name);
    const mainSim = lcsRatio(pdfMain, d.main);
    const fullSim = lcsRatio(normalize(pdfExp), normalize(r.name));
    const tokSim = jaccard(pdfTokens, d.tokens);
    const score100 = Math.round(mainSim * 60 + tokSim * 30 + fullSim * 10);
    if (!best || score100 > best.score) best = { row: r, score: score100 };
  }
  if (best && best.score >= 75) {
    return { db: best.row, kind: 'fuzzy', score: best.score };
  }
  return { db: null, kind: null, score: 0 };
}

function priceCompare(rows: CheckupItemRow[], text: string): PriceCompareResult {
  const diffs: DiffRow[] = [];
  let matchedCount = 0;
  const unknownNames: string[] = [];
  const skipped: PriceCompareResult['skipped'] = [];
  const pdfUnmatched: PriceCompareResult['pdfUnmatched'] = [];
  const dbNameMap = new Map<string, CheckupItemRow>();
  rows.forEach(r => {
    const k = normalize(r.name);
    if (!dbNameMap.has(k)) dbNameMap.set(k, r);
  });

  // A1: 构造 key 索引
  const dbDecomposed = new WeakMap<CheckupItemRow, ReturnType<typeof decompose>>();
  const dbKeyMap = new Map<string, CheckupItemRow>();
  const dbShortMap = new Map<string, CheckupItemRow>();
  rows.forEach(r => {
    const dec = decompose(r.name);
    dbDecomposed.set(r, dec);
    const key = `${dec.main}__${dec.bracketSorted}`;
    if (!dbKeyMap.has(key)) dbKeyMap.set(key, r);
    if (dec.main && !dbShortMap.has(dec.main)) dbShortMap.set(dec.main, r);
  });

  // C4 多对一冲突检测 Map：dbId -> [pdf命中明细]
  const dbToPdfHits = new Map<string, PriceCompareResult['collisions'][number]['pdfHits']>();
  const dbIdToRow = new Map<string, CheckupItemRow>();
  rows.forEach(r => { if (r.id) dbIdToRow.set(r.id, r); });

  const hitDbIds = new Set<string>();
  const rawLines = text.split(/\r?\n/);
  let parsedCount = 0;
  let totalLines = 0;

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li];
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line) continue;
    totalLines++;
    const lineNo = li + 1;
    if (/项目名称|医保价格|定价|2023最新定价/.test(line)) { skipped.push({lineNo, raw:line, reason:'表头行'}); continue; }
    const parts = line.split(/\t+|,|\u3001|\u0020{2,}|\s{2,}|，/).map(s => s.replace(/^\s+|\s+$/g, '')).filter(Boolean);
    if (parts.length < 2) { skipped.push({lineNo, raw:line, reason:`切分后列数<2（只有${parts.length}列，可能没按 tab/逗号/多空格隔开）`, parts}); continue; }
    const digits = parts.map(p => parsePrice(p));
    let priceIdx = -1;
    let insuredIdx = -1;
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] !== null && priceIdx < 0) { priceIdx = i; continue; }
      if (digits[i] !== null && insuredIdx < 0) { insuredIdx = i; break; }
    }
    if (priceIdx < 0) { skipped.push({lineNo, raw:line, reason:'没找到定价数字（可能价格被写在名称里，或价格列包含符号如：~、元）', parts, digits}); continue; }
    let nameParts: string[];
    if (insuredIdx < 0) { nameParts = parts.slice(0, priceIdx); }
    else { nameParts = parts.slice(0, insuredIdx); }
    const name = nameParts.join(' ').replace(/^\s+|\s+$/g, '');
    if (!name) { skipped.push({lineNo, raw:line, reason:'名称为空', parts}); continue; }
    const pdfPrice = parsePrice(parts[priceIdx]);
    const pdfInsured = insuredIdx >= 0 ? parsePrice(parts[insuredIdx]) : null;
    if (pdfPrice === null) { skipped.push({lineNo, raw:line, reason:'定价列解析为空', parts}); continue; }
    parsedCount++;

    const { db, kind, score } = matchDbRow(name, dbKeyMap, dbShortMap, rows, dbDecomposed);

    if (!db) {
      unknownNames.push(name);
      pdfUnmatched.push({ name, pdfPrice, pdfInsured });
      diffs.push({ name, pdfPrice, dbPrice: null, pdfInsured, dbInsured: null, reason: '缺', matchKind: null, matchScore: 0 });
      continue;
    }
    // 命中 DB
    if (db.id) {
      hitDbIds.add(db.id);
      // C4: 记入多对一冲突 map
      if (!dbToPdfHits.has(db.id)) dbToPdfHits.set(db.id, []);
      dbToPdfHits.get(db.id)!.push({ pdfName: name, pdfPrice, pdfInsured, kind, score });
    }
    const dbPrice = Math.round((Number(db.default_price) || 0) * 100) / 100;
    const dbInsured = Math.round((Number(db.insurance_price) || 0) * 100) / 100;
    const priceDiff = Math.abs(dbPrice - pdfPrice);
    let insuredDiff = 0;
    if (pdfInsured !== null) insuredDiff = Math.abs(dbInsured - pdfInsured);
    if (priceDiff < 0.001 && (pdfInsured === null || insuredDiff < 0.001)) {
      matchedCount++;
      continue;
    }
    let reason: DiffRow['reason'] = '其他';
    if (priceDiff >= 0.001 && pdfInsured !== null && insuredDiff >= 0.001) reason = '定价差+医保';
    else if (priceDiff >= 0.001) reason = '定价差';
    else reason = '医保价差';
    diffs.push({
      name, pdfPrice, dbPrice, pdfInsured, dbInsured, reason,
      dbId: db.id ?? null, dbName: db.name, dbCode: db.code,
      matchKind: kind, matchScore: score,
    });
  }

  // C4: 多对一冲突（同1条DB被≥2条PDF行命中，且PDF行名称不是完全相同——相同是重复行，不报警）
  const collisions: PriceCompareResult['collisions'] = [];
  for (const [dbId, pdfHits] of dbToPdfHits.entries()) {
    if (pdfHits.length < 2) continue;
    const uniqueNames = new Set(pdfHits.map(h => normalize(h.pdfName)));
    if (uniqueNames.size < 2) continue;  // 重复粘贴的同名行忽略（不是冲突）
    const dbRow = dbIdToRow.get(dbId);
    if (dbRow) collisions.push({ dbId, dbRow, pdfHits });
  }
  // 按命中条数倒序排（问题大的在前）
  collisions.sort((a, b) => b.pdfHits.length - a.pdfHits.length);

  const order = (r: DiffRow) => ({
    '缺': 0, '定价差+医保': 1, '定价差': 2, '医保价差': 3, '其他': 4,
  } as any)[r.reason];
  diffs.sort((a, b) => {
    if (order(a) !== order(b)) return order(a) - order(b);
    const absAmt = (r: DiffRow) => Math.max(
      Math.abs((r.pdfPrice || 0) - (r.dbPrice || 0)),
      Math.abs((r.pdfInsured || 0) - (r.dbInsured || 0)),
    );
    return absAmt(b) - absAmt(a);
  });

  // A3: DB 中未被 PDF 引用的项目（按启用状态优先、有医保价缺失优先排）
  const dbUnmatched = rows
    .filter(r => r.id ? !hitDbIds.has(r.id) : false)
    .sort((a, b) => {
      const miss = (r: any) => (Number(r.insurance_price) || 0) === 0 ? 1 : 0;
      if (miss(a) !== miss(b)) return miss(b) - miss(a);
      return Number(b.status || 0) - Number(a.status || 0);
    });

  return { parsedCount, totalLines, diffs, matchedCount, unknownNames, skipped, dbNameMap, dbRows: rows, dbUnmatched, hitDbIds, collisions, pdfUnmatched };
}

function parsePrice(s: string): number | null {
  if (!s) return null;
  const raw = String(s).replace(/^\s+|\s+$/g, '').replace(/[¥￥,，\s]/g, '');
  if (/^\d+(?:\.\d+)?\s*[\/:：]\s*\d+(?:\.\d+)?$/.test(raw)) {
    const parts = raw.split(/[\/:：]/).map(Number).filter(n => !isNaN(n));
    if (parts.length >= 2) return parts[1];
  }
  const n = Number(raw);
  if (!isNaN(n) && isFinite(n)) return Math.round(n * 100) / 100;
  return null;
}
