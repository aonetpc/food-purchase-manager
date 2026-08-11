# HYWellness 接待业务调度画板 — 开发文档

> 版本：v1.1  
> 文件：`index.html`（单文件 SPA，无构建依赖）  
> 技术栈：原生 HTML + CSS + JavaScript（无框架、无外部 JS 库）

---

## 一、项目概述

### 1.1 产品定位

面向康养中心/接待型酒店的**预订调度画板**，供预订员、销售员、总经理三方协作完成团队接待订单的录入、确认、审核与排期。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 7 日 Gantt 画板 | 按业务类型分行 × 日期分列，一图总览一周排期 |
| 多业务整单录入 | 体检、住宿、早餐、午餐、晚餐、会务、康乐 7 类业务，一单可含多项 |
| 连续日期合并显示 | 住宿连住、连续多天用餐等自动合并为长条卡片 |
| 早餐自动派生 | 早餐无需手动录入，由体检 + 住宿数据自动推算 |
| 复制为新单 | 老客户返单一键复制业务配置，仅需改客户信息 + 重新上传体检名单 |
| Excel 整单导入 | CSV 多 sheet 格式，一次导入完整订单（客户信息 + 所有业务项目） |
| 体检名单导入/导出 | 支持 Excel 复制粘贴 / CSV 格式 |
| 移动端适配 | 980px 以下切换为日期选择 + 列表视图 |

### 1.3 用户角色与审批流

```
预订员录入 → 待确认(pending) → 销售员企微确认 → 待审核(reviewing) → 总经理审核
  → 已确认(confirmed) / 已驳回(rejected)
  → 服务完成 → 已完成(completed)
```

---

## 二、文件结构

整个应用为单文件 `index.html`，结构如下：

```
index.html
├── <style> CSS 样式（行 10-368）
│   ├── CSS 变量定义（行 11）
│   ├── 顶部导航栏（行 19-36）
│   ├── Tab 切换（行 37-43）
│   ├── 统计卡片（行 45-56）
│   ├── 工具栏与筛选（行 58-69）
│   ├── Gantt 画板（行 71-151）
│   ├── 移动端列表（行 153-179）
│   ├── 详情弹层 Modal（行 181-227）
│   ├── 下单页表单（行 229-299）
│   ├── 抽屉 Drawer（行 301-362）
│   └── Toast（行 364-367）
├── <body> HTML 结构（行 370-521）
│   ├── 顶部导航 topbar
│   ├── Tab 栏 tabbar
│   ├── 画板视图 viewBoard
│   ├── 下单视图 viewOrder
│   ├── Toast 容器
│   ├── 抽屉 Drawer
│   └── 弹层 Modal
└── <script> JavaScript 逻辑（行 523-2763）
    ├── 常量定义（行 524-581）
    ├── 工具函数（行 583-631）
    ├── 全局状态（行 633-652）
    ├── Mock 数据生成（行 654-788）
    ├── 画板渲染（行 792-1357）
    ├── 详情弹层（行 1359-1472）
    ├── Tab 切换（行 1474-1521）
    ├── 项目列表渲染（行 1524-1616）
    ├── 抽屉系统（行 1618-2180）
    ├── 保存逻辑（行 2182-2262）
    ├── 提交逻辑（行 2264-2321）
    ├── 复制为新单（行 2323-2390）
    ├── Excel 导入（行 2392-2732）
    └── 初始化（行 2734-2762）
```

---

## 三、设计系统

### 3.1 CSS 变量（[行 11](file:///workspace/index.html#L11)）

```css
:root{
  /* 深色主题（画板/表单/抽屉背景） */
  --bg-deep:#0E1217;      /* 最深背景 */
  --bg-panel:#161B22;     /* 面板背景 */
  --bg-panel-2:#1C232C;   /* 面板渐变第二色 */
  
  /* 浅色主题（卡片/弹层背景） */
  --bg-card:#FAFAF7;      /* 卡片背景（浅色） */
  --bg-card-2:#F3F2EC;    /* 卡片二级背景 */
  
  /* 文字色 */
  --ink:#0E1217;          /* 主文字（深色，用于浅色背景上） */
  --ink-2:#3A434F;        /* 次要文字 */
  --ink-3:#6B7480;        /* 辅助文字/标签 */
  
  /* 线条 */
  --line:#262D36;         /* 深色分割线 */
  --line-light:#E6E3DA;   /* 浅色分割线 */
  
  /* 品牌色 */
  --gold:#C8A24B;         /* 金色主品牌色 */
  --gold-soft:#E8C97A;    /* 金色浅色变体 */
  
  /* 状态色 */
  --st-pending:#E8B339;   /* 待确认-黄 */
  --st-reviewing:#3B82F6; /* 待审核-蓝 */
  --st-confirmed:#10B981; /* 已确认-绿 */
  --st-rejected:#EF4444;  /* 已驳回-红 */
  --st-completed:#6366F1; /* 已完成-紫 */
  
  /* 业务色 */
  --biz-checkup:#0EA5E9;  /* 体检-青 */
  --biz-lodging:#8B5CF6;  /* 住宿-紫 */
  --biz-breakfast:#F59E0B;/* 早餐-橙 */
  --biz-lunch:#EF4444;    /* 午餐-红 */
  --biz-dinner:#EC4899;   /* 晚餐-粉 */
  --biz-meeting:#14B8A6;  /* 会务-青绿 */
  --biz-wellness:#84CC16; /* 康乐-绿 */
}
```

**设计原则**：画板/表单/抽屉使用深色主题（暗金质感），订单卡片和弹层使用浅色背景（提高可读性）。卡片浮在深色画板上，形成层次感。

### 3.2 字体

| 字体 | 用途 |
|------|------|
| Noto Sans SC | 正文（中文） |
| Fraunces | 标题/品牌名（衬线体） |
| JetBrains Mono | 数字/日期/金额/编码 |

### 3.3 响应式断点

| 断点 | 行为 |
|------|------|
| ≥980px | 显示 Gantt 画板，隐藏移动端列表 |
| <980px | 隐藏 Gantt，显示移动端日期选择 + 列表 |
| ≤680px | 表单多列布局降为单列 |
| ≤560px | 统计卡片隐藏、弹层网格单列、表格头部隐藏 |

---

## 四、数据结构

### 4.1 业务常量

#### BUSINESS（[行 525-533](file:///workspace/index.html#L525-L533)）

```javascript
const BUSINESS=[
  {type:'checkup',label:'体检',unit:'人',color:'var(--biz-checkup)',icon:'🩺'},
  {type:'lodging',label:'住宿',unit:'间',color:'var(--biz-lodging)',icon:'🛏'},
  {type:'breakfast',label:'早餐',unit:'人',color:'var(--biz-breakfast)',icon:'🌅',derived:true},
  {type:'lunch',label:'午餐',unit:'桌',color:'var(--biz-lunch)',icon:'🍽'},
  {type:'dinner',label:'晚餐',unit:'桌',color:'var(--biz-dinner)',icon:'🌙'},
  {type:'meeting',label:'会务',unit:'场',color:'var(--biz-meeting)',icon:'📊'},
  {type:'wellness',label:'康乐',unit:'项',color:'var(--biz-wellness)',icon:'🎯'},
];
```

- `derived:true` 表示该业务为派生项（早餐），不可手动添加，由体检 + 住宿自动推算。

#### 体检套餐 CHECKUP_PACKAGES（[行 555-560](file:///workspace/index.html#L555-L560)）

| 代码 | 名称 | 价格 |
|------|------|------|
| A | 基础体检套餐 | ¥588 |
| B | 综合体检套餐 | ¥1,288 |
| C | 深度体检套餐 | ¥2,888 |
| D | VIP体检套餐 | ¥5,888 |

#### 房型 LODGING_TYPES（[行 563-568](file:///workspace/index.html#L563-L568)）

| 代码 | 名称 | 单价/晚 |
|------|------|---------|
| standard | 标准间 | ¥480 |
| bigbed | 大床房 | ¥520 |
| suite | 套房 | ¥880 |
| vipsuite | VIP套房 | ¥1,880 |

#### 会议厅 MEETING_HALLS（[行 547-552](file:///workspace/index.html#L547-L552)）

| 代码 | 名称 | 容量 | 半天价 | 全天价 |
|------|------|------|--------|--------|
| siji | 四季厅 | 80人 | ¥2,000 | ¥3,500 |
| shanshui | 山水厅 | 40人 | ¥1,200 | ¥2,200 |
| qingquan | 清泉厅 | 20人 | ¥600 | ¥1,100 |
| wanghu | 望湖厅 | 120人 | ¥3,000 | ¥5,800 |

#### 康乐项目 WELLNESS_TYPES（[行 536-544](file:///workspace/index.html#L536-L544)）

| 代码 | 名称 | 起订时长 | 单价/小时 | 免费 |
|------|------|----------|-----------|------|
| mahjong | 棋牌室 | 4小时 | ¥80 | 否 |
| fishing | 钓鱼 | 2小时 | ¥60 | 否 |
| ktv | KTV | 2小时 | ¥120 | 否 |
| swimming | 游泳池 | 0 | ¥0 | 是 |
| gym | 健身房 | 0 | ¥0 | 是 |
| billiards | 台球室 | 0 | ¥0 | 是 |
| tabletennis | 乒乓房 | 0 | ¥0 | 是 |

#### 订单状态 STATUS（[行 570-576](file:///workspace/index.html#L570-L576)）

| 状态码 | 标签 | 颜色 |
|--------|------|------|
| pending | 待确认 | #E8B339 |
| reviewing | 待审核 | #3B82F6 |
| confirmed | 已确认 | #10B981 |
| rejected | 已驳回 | #EF4444 |
| completed | 已完成 | #6366F1 |

### 4.2 全局状态

#### state（[行 635-640](file:///workspace/index.html#L635-L640)）

```javascript
let state={
  orders:[],              // 所有订单数组
  startDay:new Date(),    // 画板起始日（周一）
  today:new Date(),       // 当前日期
  bizFilter:new Set(...), // 业务筛选（默认全选）
  statusFilter:new Set(...), // 状态筛选（默认全选）
  selectedDate:null,      // 移动端选中的日期
  editingGroupId:null,    // 正在编辑的订单ID
};
```

#### draftGroup（[行 642](file:///workspace/index.html#L642)）

下单页的草稿订单，结构与 `state.orders[]` 中的订单一致：

```javascript
let draftGroup={
  id:null,                // 订单ID（提交后生成）
  customerName:'',        // 客户/单位名称
  contactName:'',         // 联系人
  contactPhone:'',        // 联系电话
  salesPerson:'',         // 销售员
  payment:'',             // 付款方式
  remark:'',              // 备注
  items:[],               // 业务项目数组
  status:null,            // 状态
  createdAt:null,         // 创建时间
};
```

#### drawerState（[行 652](file:///workspace/index.html#L652)）

抽屉的当前状态，根据 `itemType` 动态决定 `extra` 字段结构：

```javascript
let drawerState={
  mode:'add'|'edit',      // 模式
  editIdx:-1,             // 编辑时的项目索引
  itemType:'checkup',     // 当前业务类型
  extra:{},               // 业务配置（结构因类型而异）
};
```

### 4.3 Item 数据结构

每个业务项目的统一结构：

```javascript
{
  id:'IT0001',             // 项目ID
  itemType:'checkup',      // 业务类型
  date:'2026-07-25',       // 主日期（首场日期）
  startTime:'08:00',       // 主开始时间
  endTime:'',              // 结束时间（当前未使用）
  pax:5,                   // 数量（人/间/桌/场/项）
  extra:{},                // 业务专属配置（见下）
  amount:2940,             // 金额
}
```

#### 各业务 extra 结构

**体检 checkup**：
```javascript
extra:{
  paxList:[{name,idCard,phone,gender,married,package}],
  packageTotal:2940,  // 套餐合计
}
```

**住宿 lodging**：
```javascript
extra:{
  lodgingType:'standard',   // 房型代码
  dateCheckIn:'2026-07-24', // 入住日期
  dateCheckOut:'2026-07-26',// 离店日期
  arrivalTime:'14:00',      // 抵店时间
  nights:2,                 // 入住晚数（自动计算）
}
```

**午餐/晚餐 lunch/dinner**：
```javascript
extra:{
  dateStart:'2026-07-24',   // 日期范围开始（抽屉用）
  dateEnd:'2026-07-26',     // 日期范围结束（抽屉用）
  defaultTime:'12:00',      // 默认用餐时间
  defaultTables:2,          // 默认桌数
  defaultPerTable:10,       // 默认每桌人数
  sessions:[{date,time,tables,perTable}],
}
```

**会务 meeting**：
```javascript
extra:{
  sessions:[{date,startTime,hall,slotType:'half'|'full',pax}],
}
```

**康乐 wellness**：
```javascript
extra:{
  sessions:[{date,startTime,wellnessType,hours,pax}],
}
```

**早餐 breakfast**（派生项，不持久化）：
```javascript
extra:{
  derived:true,
  sessions:[{date,startTime:'07:30',pax,source:{checkup,lodging}}],
}
```

---

## 五、核心模块详解

### 5.1 Gantt 画板渲染

#### 5.1.1 布局结构（[行 79-93](file:///workspace/index.html#L79-L93)）

```
.gantt (overflow-x:auto)
├── .gantt-header (sticky top:0)
│   ├── .corner (sticky left:0, 200px固定列)
│   └── .gantt-day × 7 (minmax(130px,1fr))
└── .gantt-body
    └── .gantt-row × 7 (每种业务一行)
        ├── .gantt-lane (sticky left:0, 200px固定列，业务名称)
        ├── .gantt-cell × 7 (日期单元格，背景层)
        └── .gantt-overlay (绝对定位，卡片层)
            └── .order-card / .merged-card (绝对定位)
```

**关键 CSS**：
```css
.gantt-header,.gantt-row{
  grid-template-columns:200px repeat(7,minmax(130px,1fr));
}
```
表头和行使用完全相同的列定义，确保对齐。

#### 5.1.2 renderGantt()（[行 980-1127](file:///workspace/index.html#L980-L1127)）

渲染流程：

1. **生成 7 天日期数组** `weekDates[]`
2. **渲染表头**：每天显示 星期/日期/月份/单数
3. **遍历每种业务**（BUSINESS），为每种业务创建一行 `.gantt-row`
4. **创建业务标签列** `.gantt-lane`（sticky 固定）
5. **创建 7 个日期单元格** `.gantt-cell`（背景层，含今日/周末高亮）
6. **合并连续日期项目** → `mergeConsecutiveItems()`
7. **收集所有卡片**（合并卡片 + 单日卡片）
8. **分轨道计算** → 避免不同团队叠压
9. **动态调整行高**：`minHeight = max(118, tracks * 84 + (tracks-1) * 8 + 16)`
10. **创建 overlay 层**，将卡片绝对定位到对应位置

#### 5.1.3 连续日期合并算法 mergeConsecutiveItems()（[行 1129-1191](file:///workspace/index.html#L1129-L1191)）

```javascript
function mergeConsecutiveItems(items, weekDates){
  // 1. 对每个 item，根据业务类型获取日期范围
  //    - lodging: dateCheckIn ~ dateCheckOut
  //    - lunch/dinner: sessions 中的日期范围
  //    - meeting/wellness: sessions 中的日期范围
  //    - checkup: 不合并（单日）
  //    - breakfast: 不合并（派生项）
  
  // 2. 计算日期在 weekDates 中的列索引 startCol, endCol
  
  // 3. 收集范围内的所有卡片，标记 isMerged=true
  
  // 4. 仅当 mcItems.length > 1 时才创建合并卡片
  //    单日项目保持原样
  
  return merged; // [{items, startCol, endCol}]
}
```

**合并规则**：
- 同一个 item（相同 item.id）在连续日期出现时合并
- 合并卡片横跨 `startCol` 到 `endCol` 的列范围
- 单日项目（如体检）不合并，保持独立卡片

#### 5.1.4 分轨道算法（[行 1023-1076](file:///workspace/index.html#L1023-L1076)）

解决多个团队在同一天/同一行业务的卡片叠压问题：

```javascript
// 航班调度式轨道分配
allCards.forEach(card=>{
  let placed=false;
  for(let t=0;t<tracks.length;t++){
    // 检查该 track 是否与当前卡片有列重叠
    const conflict=tracks[t].some(c=>
      !(card.endCol<c.startCol || card.startCol>c.endCol)
    );
    if(!conflict){
      card.track=t;  // 放入此 track
      tracks[t].push(card);
      placed=true;
      break;
    }
  }
  if(!placed){
    card.track=tracks.length;  // 新建 track
    tracks.push([card]);
  }
});
```

**效果**：同一行内，时间不重叠的卡片共享同一 track（垂直位置相同），时间重叠的卡片分到不同 track（垂直错开）。

#### 5.1.5 卡片绝对定位（[行 1095-1113](file:///workspace/index.html#L1095-L1113)）

```javascript
// 每张卡片的位置计算
const leftPct=(card.startCol/7)*100;           // 左边距百分比
const widthPct=((card.endCol-card.startCol+1)/7)*100; // 宽度百分比
el.style.left=`calc(${leftPct}% + 4px)`;
el.style.width=`calc(${widthPct}% - 8px)`;
el.style.top=(card.track*(trackHeight+trackGap))+'px'; // 垂直位置
el.style.height=trackHeight+'px';               // 固定高度 84px
```

- `left/width` 用百分比计算，与 7 列网格自动对齐
- `top` 按 track 索引计算，实现垂直分层
- overlay 层 `pointer-events:none`，卡片单独设 `pointer-events:auto`

#### 5.1.6 卡片类型

**普通卡片 makeOrderCard()**（[行 1257-1327](file:///workspace/index.html#L1257-L1327)）：
- 单日项目使用
- 显示：时间、状态标签、客户名、数量、销售员、业务摘要
- 编辑中的订单显示金色"编辑中"徽章

**合并卡片 makeMergedOrderCard()**（[行 1193-1255](file:///workspace/index.html#L1193-L1255)）：
- 连续日期项目使用
- 实色背景 `var(--bg-card)` + 业务色左边框 3px + 业务色细边框
- 左侧叠加 12% 透明度业务色渐变（视觉点缀）
- 右上角 `↔` 合并指示符
- 显示项目汇总信息（如"标准间 · 3间 · 2晚 · ¥2880"）
- **字体颜色修复**：客户名用 `var(--ink)`（深色 #0E1217），金额也用 `var(--ink)`，确保在浅色卡片背景上可读

**合并卡片样式**（[行 141-151](file:///workspace/index.html#L141-L151)）：

```css
.order-card.merged-card{
  background:var(--bg-card);
  border:1px solid var(--biz-color);
  border-left:3px solid var(--biz-color);
  box-shadow:0 2px 8px rgba(0,0,0,.3);
}
.order-card.merged-card::before{
  content:"";position:absolute;left:0;top:0;right:0;bottom:0;
  background:linear-gradient(90deg,var(--biz-color) 0%,transparent 30%);
  opacity:.12;pointer-events:none;
}
.order-card.merged-card .oc-name{
  color:var(--ink);  /* 深色字体，确保浅色背景上可读 */
}
.order-card.merged-card .oc-amount{
  color:var(--ink);  /* 深色字体 */
}
```

> **修复记录**：合并卡片最初使用 `linear-gradient(rgba(139,92,246,.08),...)` 透明渐变背景 + `#F5F3EE` 浅色字体，导致在浅色 `--bg-card` 背景上几乎看不见。后改为实色背景 + 深色字体（`var(--ink)`）。

### 5.2 早餐派生逻辑 deriveBreakfastSessions()（[行 857-889](file:///workspace/index.html#L857-L889)）

早餐不需要手动录入，根据体检和住宿数据自动派生：

```
派生规则：
1. 体检当天：早餐人数 = 体检人数
2. 住宿期间（入住日+1 至 离店日，含）：早餐人数 = 住宿人数
3. 同一天两者重叠：取 max(体检人数, 住宿人数)
4. 只体检不住宿：体检当天 1 顿
5. 只住宿不体检：入住次日起每天 1 顿，直到离店日
6. 体检+住宿：体检当天 1 顿 + 住宿期间各天（重叠日取 max）
```

**实现**：
```javascript
function deriveBreakfastSessions(group){
  const dayMap={}; // date -> {checkupPax, lodgingPax}
  // 遍历体检项，记录每天体检人数
  // 遍历住宿项，从入住次日到离店日，记录每天住宿人数
  // 合并：每天早餐人数 = max(checkupPax, lodgingPax)
  return sessions; // [{date, startTime:'07:30', pax, source:{checkup,lodging}}]
}
```

早餐在 `filteredItems()` 中作为虚拟 item 展开（[行 938-945](file:///workspace/index.html#L938-L945)），在画板上显示，但不会持久化到订单数据中（提交时过滤掉 `breakfast` 类型，[行 2278](file:///workspace/index.html#L2278)）。

### 5.3 住宿按晚展开 expandLodgingNights()（[行 896-911](file:///workspace/index.html#L896-L911)）

住宿在画板上按每晚展开为独立卡片：

```
住 1 晚（D1 入住 D2 离店）：D1 一张卡
住 2 晚（D1 入住 D3 离店）：D1、D2 各一张卡
住 3 晚（D1 入住 D4 离店）：D1、D2、D3 各一张卡
```

- 第一晚卡片显示抵店时间
- 后续晚显示"续住"
- 合并算法会将这些连续卡片合并为一个长条

### 5.4 住宿连住日期条 renderStayBar()（[行 1753-1789](file:///workspace/index.html#L1753-L1789)）

在住宿抽屉中显示连住日期的可视化条：

- 金色块 = 入住日
- 紫色块 = 中间晚（标注"第N晚"）
- 绿色块 = 离店日
- 用 `→` 箭头连接
- 最多显示 7 天，超过显示"更多"

**CSS**（[行 107-120](file:///workspace/index.html#L107-L120)）：
```css
.stay-bar{display:flex;align-items:center;gap:4px;padding:12px 10px;
  background:var(--bg-deep);border:1px solid var(--line);border-radius:10px}
.stay-bar .sb-day.is-checkin{background:linear-gradient(rgba(200,162,75,.18),...);
  border-color:var(--gold)}
.stay-bar .sb-day.is-during{background:rgba(139,92,246,.08);
  border-color:rgba(139,92,246,.3)}
.stay-bar .sb-day.is-checkout{background:rgba(16,185,129,.08);
  border-color:rgba(16,185,129,.35)}
```

### 5.5 午餐/晚餐抽屉 renderMealDrawer()（[行 1856-1894](file:///workspace/index.html#L1856-L1894)）

采用 **日期范围模式**（与住宿一致的交互）：

1. 选择开始日期 + 结束日期
2. 自动生成每天的场次（`syncMealSessions()`）
3. 默认时间、桌数、每桌人数全局配置
4. 下方表格可单独调整某一天的配置
5. 连续日期条可视化展示（`renderMealDateBar()`）

**syncMealSessions()**（[行 1896-1920](file:///workspace/index.html#L1896-L1920)）：
- 根据日期范围生成 sessions 数组
- 保留已有调整（通过 `existing` Map 匹配日期）
- 修改日期范围时自动同步

### 5.6 抽屉系统

#### 5.6.1 抽屉结构

```
.drawer (右侧滑出, 620px宽)
├── .drawer-head (标题 + 关闭按钮)
├── .drawer-body (可滚动内容)
│   ├── 业务类型选择 (.biz-grid)
│   ├── 时间安排 (renderTimeSection)
│   └── 业务配置 (renderBizSpecific)
└── .drawer-foot (取消 + 保存)
```

#### 5.6.2 各业务抽屉内容

| 业务 | 时间区块 | 业务配置 |
|------|----------|----------|
| 体检 | 日期 + 开始时间 | 人员表格（姓名/身份证/手机/性别/婚否/套餐） |
| 住宿 | 入住/离店日期 + 抵店时间 + 连住条 | 房型 + 房间数 |
| 早餐 | 日期 + 时间 + 自动人数 | 派生规则提示 |
| 午餐/晚餐 | 日期范围 + 默认配置 + 日期条 | 场次表格（日期/时间/桌数/每桌人数） |
| 会务 | 每行独立配置 | 场次表格（日期/开始/会议厅/时段/人数） |
| 康乐 | 每行独立配置 | 场次表格（日期/开始/项目/时长/人数） |

#### 5.6.3 体检名单导入/导出

**导入 importPax()**（[行 2144-2170](file:///workspace/index.html#L2144-L2170)）：
- 支持 CSV / TXT 格式
- 支持从 Excel 复制粘贴（Tab 分隔）
- 自动识别表头行（含"姓名"则跳过）
- 字段映射：姓名/身份证号/手机号/性别/婚否/套餐

**导出 exportPaxTemplate()**（[行 2136-2143](file:///workspace/index.html#L2136-L2143)）：
- 有数据时导出当前名单
- 无数据时导出模板（含示例数据）

### 5.7 详情弹层 openModal()（[行 1360-1469](file:///workspace/index.html#L1360-L1469)）

点击任意卡片弹出详情弹层，包含：

1. **头部**：业务图标 + 订单ID + 客户名（业务色渐变背景）
2. **基础信息网格**：时间安排、项目金额、联系人、联系电话、销售员、付款方式
3. **业务明细表格**：根据业务类型展示不同内容
4. **同单其他项目**：表格列出同一订单的其他业务
5. **整单合计**：金色渐变金额条
6. **审批时间线**：下单提交 → 销售员确认 → 总经理审核 → 服务完成
7. **备注**：黄色提示框
8. **操作按钮**：关闭 / 复制为新单 / 修改此单（仅 pending/reviewing/confirmed 状态可编辑）

---

## 六、方案 1：Excel 整单导入

### 6.1 入口

新建订单页顶部工具栏（[行 451-462](file:///workspace/index.html#L451-L462)）：
- `📥 Excel 整单导入` 按钮 → 触发文件选择
- `⬇ 下载导入模板` 按钮 → 下载 CSV 模板
- `↺ 清空` 按钮 → 重置表单

### 6.2 模板格式 downloadImportTemplate()（[行 2396-2439](file:///workspace/index.html#L2396-L2439)）

CSV 文件用 `[SHEET:xxx]` 分段，6 个 sheet：

```
[SHEET:订单主表]
客户名称,联系人,联系电话,销售员,付款方式,备注

[SHEET:体检名单]
体检日期,开始时间,姓名,身份证号,手机号,性别,婚否,套餐

[SHEET:住宿]
入住日期,离店日期,抵店时间,房型,房间数

[SHEET:用餐]
类型,日期,时间,桌数,每桌人数

[SHEET:会务]
日期,开始时间,会议厅,时段,人数

[SHEET:康乐]
日期,开始时间,项目,时长,人数
```

### 6.3 解析逻辑 parseImportFile()（[行 2441-2465](file:///workspace/index.html#L2441-L2465)）

1. 按 `[SHEET:xxx]` 标记分段
2. 跳过 `#` 开头的注释行
3. 每段第一行为表头，后续为数据行
4. 使用 `parseCSV()` 解析每行（支持引号转义、Tab 分隔）

### 6.4 导入处理 doImport()（[行 2467-2667](file:///workspace/index.html#L2467-L2667)）

按顺序处理 6 个 sheet：

| 顺序 | Sheet | 处理逻辑 |
|------|-------|----------|
| 1 | 订单主表 | 提取客户信息，校验必填项 |
| 2 | 体检名单 | 解析人员列表，校验套餐代码，生成 checkupItem |
| 3 | 住宿 | 支持多行（多房型），校验房型名称，自动计算晚数和金额 |
| 4 | 用餐 | 按"类型"字段分流为午餐/晚餐，支持多场 |
| 5 | 会务 | 校验会议厅名称，识别时段（含"全"=全天，含"半"=半天） |
| 6 | 康乐 | 校验项目名称，自动纠正起订时长 |

**校验规则**：
- 必填项校验（客户名称、联系人、电话、销售员、付款方式）
- 日期必填校验（各业务日期不能为空）
- 名称合法性校验（房型、会议厅、康乐项目必须与预设匹配）
- 康乐起订时长校验（自动纠正并给出警告）
- 套餐代码校验（无效则按 A 处理并警告）
- 身份证号/手机号缺失（仅警告，不阻断）

### 6.5 导入结果展示 showImportResult()（[行 2669-2700](file:///workspace/index.html#L2669-L2700)）

在工具栏下方插入彩色结果卡片：

| 状态 | 颜色 | 说明 |
|------|------|------|
| 成功 | 绿色 | ✅ 导入成功，显示业务明细标签 |
| 成功(有警告) | 黄色 | ⚠ 导入成功，显示警告列表 |
| 失败 | 红色 | ❌ 导入失败，显示错误列表 |

业务明细以标签形式展示（如"🛏 住宿（标准间 3间 2晚）"）。

### 6.6 导入成功后

自动填充 `draftGroup`（客户信息 + 业务项目），预订员检查后可直接提交。

---

## 七、方案 2：复制为新单 duplicateGroup()（[行 2327-2390](file:///workspace/index.html#L2327-L2390)）

### 7.1 入口

订单详情弹层底部 → `⎘ 复制为新单` 按钮

### 7.2 智能清空/保留策略

| 字段类别 | 处理 | 原因 |
|---------|------|------|
| 订单 ID / 状态 / 创建时间 | **清空** | 生成新单 |
| 客户名称 / 联系人 / 电话 | **清空** | 用户重新填 |
| 销售员 / 付款方式 / 备注 | **保留** | 同客户复购通常一致 |
| 体检名单 | **清空** | 需重新上传 |
| 体检日期 / 时间 | **清空** | 需重新选择 |
| 住宿：房型 / 房间数 | **保留** | 通常不变 |
| 住宿：日期 / 抵店时间 | **清空** | 需重新选择 |
| 用餐：桌数 / 每桌人数 | **保留** | 通常不变 |
| 用餐：日期 / 时间 | **清空** | 需重新选择 |
| 会务：会议厅 / 时段 | **保留** | 通常不变 |
| 会务：日期 / 时间 | **清空** | 需重新选择 |
| 康乐：项目 / 时长 | **保留** | 通常不变 |
| 康乐：日期 / 时间 | **清空** | 需重新选择 |
| 金额 | **重新计算** | 基于保留的配置 |

### 7.3 典型使用流程

```
1. 在画板上找到老客户的订单 → 点击卡片
2. 详情弹层 → 点击"复制为新单"
3. 自动跳转到下单页，业务配置已就绪
4. 填写新的客户信息
5. 重新上传体检名单
6. 修改各项目的日期
7. 提交
```

---

## 八、工具函数

| 函数 | 位置 | 说明 |
|------|------|------|
| `pad(n)` | [行 584](file:///workspace/index.html#L584) | 数字补零 |
| `fmt(d)` | [行 585](file:///workspace/index.html#L585) | Date → YYYY-MM-DD |
| `addDays(d,n)` | [行 586](file:///workspace/index.html#L586) | 日期加 N 天 |
| `todayStr()` | [行 587](file:///workspace/index.html#L587) | 今天日期字符串 |
| `daysBetween(d1,d2)` | [行 590](file:///workspace/index.html#L590) | 计算两日期相差天数 |
| `parseCSV(text)` | [行 592-610](file:///workspace/index.html#L592-L610) | CSV 解析（支持引号转义、Tab） |
| `toCSV(rows,headers)` | [行 611-617](file:///workspace/index.html#L611-L617) | 数组转 CSV 字符串 |
| `downloadFile(filename,content,mime)` | [行 618-624](file:///workspace/index.html#L618-L624) | 触发文件下载（含 BOM 头） |
| `showToast(msg,type)` | [行 625-631](file:///workspace/index.html#L625-L631) | 顶部 Toast 提示 |
| `grpColor(gid)` | [行 974-978](file:///workspace/index.html#L974-L978) | 根据订单 ID 哈希生成团队色 |
| `cardTime(x)` | [行 951-954](file:///workspace/index.html#L951-L954) | 提取卡片的日期和时间 |
| `groupTotal(g)` | [行 790](file:///workspace/index.html#L790) | 计算订单总金额 |

---

## 九、Mock 数据生成 generateData()（[行 655-788](file:///workspace/index.html#L655-L788)）

生成 7 天的模拟数据：

- 每天 2-5 个团队（周末偏少）
- 每个团队 1-4 个业务项目
- 状态分布：过去日期偏 completed/rejected，今天偏 confirmed/pending/reviewing，未来偏 confirmed/pending
- 住宿随机生成 1-3 晚连住
- 用餐/会务/康乐随机生成 1-3 场
- 体检人员 3-12 人，随机分配套餐

`WEEK_OFFSET` 变量控制周偏移，用于前后翻页（[行 634](file:///workspace/index.html#L634)）。

---

## 十、优化迭代记录

以下是开发过程中的关键优化，确保后续维护时不遗漏：

### 10.1 Gantt 表头与行对齐修复

**问题**：表头和各行使用独立的 grid 容器，列宽计算偏差导致日期列错位。

**修复**：
- 统一使用 `grid-template-columns:200px repeat(7,minmax(130px,1fr))`
- 所有 grid 子元素 `box-sizing:border-box + min-width:0`
- 添加 `overflow-x:auto` 横向滚动
- 首列 `position:sticky;left:0` 固定

### 10.2 连续日期合并显示

**问题**：连住 3 天的住宿在画板上显示为 3 个独立卡片，视觉上不连续。

**修复**：实现 `mergeConsecutiveItems()` 合并算法 + `makeMergedOrderCard()` 长条卡片。

### 10.3 多团队卡片叠压修复

**问题**：合并卡片都使用 `gridRow='1'`，同一行的多个团队会重叠。

**修复**：改为绝对定位 overlay 层 + 分轨道算法，每个团队占独立 track，垂直错开。

### 10.4 合并卡片透明不可见修复

**问题**：合并卡片使用 `rgba(139,92,246,.08)` 透明渐变背景 + `#F5F3EE` 浅色字体，在浅色 `--bg-card` 背景上几乎看不见。

**修复**：
- 背景改为实色 `var(--bg-card)`
- 客户名改为 `var(--ink)` (#0E1217 深色)
- 金额改为 `var(--ink)` 深色
- 合并指示符背景改为 `rgba(255,255,255,.6)` 白底
- 副标题加 `var(--bg-card-2)` 灰底提升可读性

### 10.5 午餐/晚餐改为日期范围模式

**问题**：原午餐/晚餐抽屉是逐行添加场次，连续日期操作繁琐。

**修复**：改为日期范围选择 + 自动生成场次 + 连续日期条可视化，与住宿交互一致。

### 10.6 住宿连住日期条

**新增**：在住宿抽屉中显示连住日期的可视化条，直观展示入住→中间晚→离店的完整日期范围。

---

## 十一、企业微信联动方案

### 11.1 背景

原有系统已具备用户角色权限（预订员/销售员/总经理）且已对接企业微信（通讯录、消息发送能力）。预订订单的下单审核流程需与企微**群消息通知**和**自建应用交互卡片**联动，实现消息触达 + 卡片内直接操作。

### 11.2 三条通道定位

| 通道 | 定位 | 适用场景 |
|------|------|----------|
| 自建应用·交互卡片 | **主通道** | 销售员确认、总经理审核（带按钮直接操作，回调后端） |
| 群机器人·群消息 | **广播通道** | 新单通知、状态变更广播、执行部门分发（文本 + @提醒） |
| 企微审批应用 | **归档通道（可选）** | 总经理审核阶段正式审批留痕（按需启用） |

### 11.3 审批流程（确认后版本）

```
预订员提交订单
    │
    ├──① 群消息：调度总群（文本消息 @销售员）
    │
    └──② 自建应用·交互卡片：销售员个人（确认/修改按钮）
         │
         ▼ [销售员点 ✅ 确认]
         │   → update_card 更新销售员卡片："已确认，待总经理审核"
         │   → 触发阶段 ③
         │
         ▼ [销售员点 ✏ 修改]
             → 重发驳回卡片给预订员 + 群消息 @预订员
    │
    └──③ 自建应用·交互卡片：总经理个人（通过/驳回按钮）
         │
         ▼ [总经理 ✅ 审核通过]
         │   → ④ 重发新卡片给销售员："已审核通过 🎉"
         │   → ⑤ 群消息：@各相关部门（按业务分发到执行群）
         │
         ▼ [总经理 ❌ 驳回]
             → 重发驳回卡片给预订员 + 群消息 @预订员
```

**与早期方案的差异**：
- 阶段 ① 群消息改为**纯文本消息**（非卡片），仅起通知 + @提醒作用
- 阶段 ② 销售员确认后，用 `update_card` 更新同一张卡片（而非重发）
- 阶段 ④ 总经理通过后，**重发新卡片**给销售员（不用 update_card，因距阶段 ② 可能已超数日）
- 移除了原方案中阶段 ② 的群消息"审核中"广播，精简为卡片驱动

### 11.4 各阶段消息设计

#### ① 预订员提交 → 群消息（文本 @销售员）

**推送群**：调度总群

```
📌 【新预订订单 · 待确认】

 订单号：OG0025
 客户：杭州锐捷科技
 项目：🩺体检 12人 · 🛏住宿 3间2晚 · 🍽午餐 2场
 金额：¥18,640
 日期：7/24 - 7/26
 预订员：小张

@李慧 请确认（2小时内未确认将提醒经理）
```

**实现**：群机器人 webhook，`mentioned_list` 或 `mentioned_mobile_list` 指定 @销售员。

#### ② 提交 → 销售员交互卡片

```
┌──────────────────────────────────────┐
│ 📋 订单待确认 · OG0025                │
│                                      │
│ 客户：杭州锐捷科技                    │
│ 联系人：张总 · 13800138000            │
│ 明细：                                │
│  🩺 体检 12人 · 7/25 08:00            │
│  🛏 住宿 标准间3间 · 7/24→7/26        │
│  🍽 午餐 2场 · 7/24、7/25             │
│ 金额：¥18,640                         │
│ 付款：销售担保挂账                     │
│                                      │
│ [✅ 确认无误]    [✏ 有问题需修改]     │
│ [📄 打开画板查看详情]                  │
└──────────────────────────────────────┘
```

| 按钮 | 回调动作 |
|------|----------|
| ✅ 确认无误 | `update_card` 更新为"✅ 李慧 已于 14:32 确认，待总经理审核" → 触发 ③ |
| ✏ 有问题需修改 | 后端收集修改原因 → 重发驳回卡片给预订员 + 群消息 |
| 📄 查看详情 | 跳转自建应用 H5 页面（兜底入口） |

#### ③ 销售员确认 → 总经理交互卡片

```
┌──────────────────────────────────────┐
│ 📋 订单待审核 · OG0025                │
│                                      │
│ 客户：杭州锐捷科技                    │
│ 销售员：李慧（已确认 ✅）              │
│ 明细：                                │
│  🩺 体检 12人套餐B · ¥15,456          │
│  🛏 住宿 标准间3间2晚 · ¥2,880        │
│  🍽 午餐 2场 · 现点结算                │
│ 整单金额：¥18,640                     │
│ 付款方式：销售担保挂账                 │
│ 备注：VIP客户安排主桌                  │
│                                      │
│ [✅ 审核通过]   [❌ 驳回]              │
│ [📄 打开画板查看详情]                  │
└──────────────────────────────────────┘
```

#### ④ 总经理通过 → 销售员：重发新卡片

> 不使用 `update_card`（距阶段 ② 可能已过数日），直接重发一张状态更新卡片：

```
┌──────────────────────────────────────┐
│ 🎉 订单已审核通过 · OG0025            │
│                                      │
│ 客户：杭州锐捷科技                    │
│ 项目：体检12人 · 住宿3间2晚 · 午餐2场  │
│ 金额：¥18,640                         │
│                                      │
│ 已通知以下执行部门：                   │
│   ✅ 前厅部（住宿）                    │
│   ✅ 体检科（体检）                    │
│   ✅ 餐饮部（午餐）                    │
│                                      │
│ [📄 查看画板执行进度]                  │
└──────────────────────────────────────┘
```

#### ⑤ 总经理通过 → 群消息：@各相关部门

按业务类型分发到对应执行群，每群只推送自己相关的内容：

**前厅执行群：**
```
🛏 【住宿执行通知】
OG0025 · 杭州锐捷科技

 抵店：7/24（周四）14:00
 房型：标准间 × 3 间
 连住：2 晚 → 7/26 离店
 备注：VIP客户，安排朝南房间

 @前厅值班经理 请提前安排房卡
```

**体检执行群：**
```
🩺 【体检执行通知】
OG0025 · 杭州锐捷科技

 日期：7/25（周五）08:00
 人数：12 人（套餐B）
 明细：男7 / 女5 / 已婚6
 名单附件：[12人体检名单.csv]

 @体检科主任 请提前准备体检引导
```

**餐饮执行群：**
```
🍽 【餐饮执行通知】
OG0025 · 杭州锐捷科技

 7/24（周四）午餐 · 2桌 × 10人 · 12:00
 7/25（周五）午餐 · 2桌 × 10人 · 12:00
 备注：客户要求主桌 + 靠窗

 @餐饮部主管 请安排
```

### 11.5 卡片更新策略与 7 天 Token 限制

#### 限制说明

企微交互卡片 `update_card` 接口要求：用户必须在 **7 天内点击过该卡片**，否则卡片交互上下文被清理，后端无法再更新。

#### 当前策略：确保 7 天内完成审批

**不做额外的技术兜底方案**，通过流程管理确保审批在 7 天内完成：

| 阶段 | 建议处理时效 | 说明 |
|------|-------------|------|
| 销售员确认 | 24 小时内 | 卡片发出后 24h 内销售员点击确认，`update_card` 安全 |
| 总经理审核 | 48 小时内 | 销售员确认后立即推送，48h 内总经理操作 |
| 总经理通过后通知销售员 | 重发新卡片 | 不依赖 `update_card`，直接发新卡片 |

**关键设计**：
- 阶段 ② 销售员卡片 → 点击后用 `update_card` 更新（距发送 < 24h，安全）
- 阶段 ④ 销售员通知卡片 → **重发新卡片**（距阶段 ② 可能已过数日，不依赖 update_card）
- 所有卡片都预留 `[📄 打开画板查看详情]` 按钮（跳 H5），作为查看入口

**超时提醒机制**（保障 7 天内完成）：

| 阶段 | 超时阈值 | 动作 |
|------|----------|------|
| 销售员确认 | 2 小时 | 推送提醒卡片 |
| 销售员确认 | 4 小时 | 升级通知销售经理 |
| 销售员确认 | 8 小时 | 群消息 @销售经理，标记超时 |
| 总经理审核 | 4 小时 | 推送提醒卡片 |
| 总经理审核 | 8 小时 | 群消息提醒，标记超时 |

> 后续如果出现审批周期超过 7 天的场景，再考虑"重发新卡片"或"H5 跳转"等技术兜底方案。

### 11.6 驳回路径

不论销售员点"修改"还是总经理点"驳回"，逻辑统一：

```
驳回方填写原因 →
  │
  ├─ 重发新卡片给预订员（不用 update_card，避免过期）：
  │    ⚠️ OG0025 需要修改
  │    驳回人：总经理
  │    原因：住宿房间数改为5间
  │    [📄 去画板修改]
  │
  └─ 群消息（调度总群）：
       ⚠️ OG0025 驳回
       杭州锐捷科技 · 总经理：房间数改为5间
       @预订员小张 请修改后重提
```

预订员修改后重新提交 → 流程回到阶段 ①（群消息 @销售员 + 新交互卡片给销售员）。

### 11.7 群消息分发规则

#### 群的规划

| 群名称 | 成员 | 用途 |
|--------|------|------|
| 调度总群 | 全体预订员 + 销售经理 + 总经理 | 所有订单动态广播 |
| 体检执行群 | 体检科负责人 + 预订员 | 体检相关通知 |
| 前厅执行群 | 前厅部值班 + 预订员 | 住宿相关通知 |
| 餐饮执行群 | 餐饮部主管 + 预订员 | 用餐相关通知 |
| 会务执行群 | 会务负责人 + 预订员 | 会务相关通知 |

#### 分发逻辑

```javascript
function getTargetGroups(order) {
  const groups = ['调度总群']; // 所有订单都推总群
  const bizTypes = new Set(order.items.map(it => it.itemType));
  if (bizTypes.has('checkup'))                       groups.push('体检执行群');
  if (bizTypes.has('lodging'))                       groups.push('前厅执行群');
  if (bizTypes.has('lunch')||bizTypes.has('dinner')||bizTypes.has('breakfast'))
                                                     groups.push('餐饮执行群');
  if (bizTypes.has('meeting'))                       groups.push('会务执行群');
  if (bizTypes.has('wellness'))                      groups.push('康乐执行群');
  return groups;
}
```

### 11.8 交互卡片回调处理

#### 回调流程

```
用户点击卡片按钮
    │
    ▼
企微 POST → 后端 callback_url
    │  Body: {
    │    EventType: "template_card_event",
    │    TaskId: "task_xxx",      // 卡片唯一ID
    │    ButtonKey: "confirm",    // 按钮标识
    │    UserId: "LiHui"          // 操作人
    │  }
    ▼
后端处理：
    1. 验签 + 解密
    2. 根据 TaskId 找到对应订单
    3. 根据 ButtonKey 执行操作：
       - "confirm"  → status=reviewing，推送总经理卡片
       - "reject"   → status=rejected，推送预订员驳回卡片
       - "approve"  → status=confirmed，重发销售员卡片 + 推送执行群
    4. update_card 更新原卡片（按钮禁用 + 显示操作结果）
    ▼
卡片显示"✅ 李慧 已于 14:32 确认"，按钮变灰不可再点
```

#### 卡片状态管理

后端维护 `task_id` 与订单的映射表：

```
task_id          | order_id | stage        | status    | sent_to  | button_clicked
task_001         | OG0025   | sales_confirm| clicked   | LiHui    | confirm
task_002         | OG0025   | mgr_review   | pending   | Manager  | -
```

- 用户点击后立即 `update_card`（按钮禁用 + 显示操作结果）
- 防止重复操作（同一 task_id 只能点一次）

### 11.9 通知规则配置

```javascript
const NOTIFICATION_RULES = {
  order_submitted: {
    card: {
      recipients: order => [order.salesPerson],
      template: 'sales_confirm_card',
      buttons: [
        {key: 'confirm', label: '✅ 确认无误'},
        {key: 'reject',  label: '✏ 有问题需修改'}
      ]
    },
    groupMsg: {
      template: order => buildNewOrderText(order),
      mentioned: order => [order.salesPerson]
    },
    timeout: {delay: 2 * 60 * 60 * 1000}  // 2小时
  },
  sales_confirmed: {
    card: {
      recipients: order => getManagers(),
      template: 'mgr_review_card',
      buttons: [
        {key: 'approve', label: '✅ 审核通过'},
        {key: 'reject',  label: '❌ 驳回'}
      ]
    },
    timeout: {delay: 4 * 60 * 60 * 1000}  // 4小时
  },
  mgr_approved: {
    card: {
      recipients: order => [order.salesPerson],
      template: 'order_confirmed_card',
      // 无操作按钮，仅通知 + 查看详情
    },
    groupMsg: {
      template: (order, group) => buildExecutionMsg(order, group),
      mentioned: (order, group) => getGroupOwners(order, group)
    }
  },
  rejected: {
    card: {
      recipients: order => [order.booker],
      template: 'order_rejected_card',
      buttons: [{key: 'edit', label: '📄 去修改'}]
    },
    groupMsg: {
      template: order => `⚠️ ${order.id} 驳回\n${order.customer} · 原因：${order.rejectReason}\n@${order.booker} 请修改后重新提交`,
      mentioned: order => [order.booker]
    }
  }
};
```

### 11.10 落地优先级

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 自建应用·交互卡片（销售员确认 + 总经理审核） | 核心审批闭环 |
| P0 | 卡片按钮回调 → 后端状态更新 | 操作闭环 |
| P0 | 超时提醒（2h/4h/8h） | 保障 7 天内完成 |
| P1 | 群消息·新单通知（文本 @销售员） | 触达保障 |
| P1 | 群消息·按业务分发到执行群 | 执行效率 |
| P2 | 企微原生审批（总经理审核归档） | 留痕归档（可选） |

---

## 十二、运行与部署

### 12.1 本地运行

```bash
cd /workspace
python3 -m http.server 8000
# 访问 http://localhost:8000/
```

### 12.2 部署

单文件部署，将 `index.html` 上传到任意静态服务器即可。无构建步骤、无外部依赖（仅 Google Fonts CDN）。

### 12.3 数据说明

当前使用前端 Mock 数据（`generateData()`），每次刷新页面重新生成。接入后端时替换 `state.orders` 的数据来源即可，数据结构无需改动。

---

## 十三、后续可扩展方向

| 方向 | 说明 |
|------|------|
| 后端对接 | 替换 Mock 数据为 API 调用 |
| 企微审批落地 | 实现第十一章规划的交互卡片 + 群消息联动 |
| 超时升级 | 7 天 token 限制兜底（重发新卡片 / H5 跳转） |
| 权限控制 | 预订员/销售员/总经理不同视图权限 |
| 拖拽排期 | Gantt 卡片支持拖拽调整日期 |
| 冲突检测 | 同一会议厅/房型时段冲突预警 |
| 数据统计 | 接待量/收入/客户分析报表 |
| 导出功能 | 画板导出 PDF/Excel |
