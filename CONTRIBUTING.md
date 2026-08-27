# OA 管理系统 — 开发协作 & 上线约定（CONTRIBUTING.md）

本文件是**新对话 / 新开发者的「自助上岗手册」**。功能开发 AI 对话只要先读这一份文件，就知道什么可以做、什么不能碰、提交什么格式的 PR 会被快速合并。**所有功能对话不需要理解任何部署细节，按本文件约定行事即可。**

> 部署/上线的守门人（Gatekeeper）：@aonetpc。功能越线/碰了不该碰的文件、迁移 SQL 不合规，PR 会被 Gatekeeper 打回。

---

## 0. 新对话的固定启动词（复制到对话首条消息即可）

> 你是本 OA 管理系统的「{填写模块名}」模块开发助手。
> 请先读取以下文件建立上下文，再开始回答或编码：
> 1. `CONTRIBUTING.md`（本文件 — 协作 & 上线约定，必须遵守）
> 2. `README.md`（技术栈 & 目录结构 & 部署说明）
> 3. `PROJECT_SUMMARY.md`（系统模块总览与边界）
> 4. `.trae/documents/` 下与本次任务直接相关的 PRD / 技术文档
> 5. `docs/work-log/` 下最近两周日志
>
> 请严格遵守 CONTRIBUTING.md 里所有红线。不要修改 `.github/workflows/*` / `backend/db.js` / `backend/server.js` / `backend/migrations/migrate.js` / `*.env*`，这些由 Gatekeeper 管理；如需修改请先停止并通知 Gatekeeper。

---

## 1. 项目模块边界（避免跨模块改文件）

每个功能只改对应模块的代码，公共能力的变更必须在 PR 里单独说明。

| 模块 | 后端路由 / 目录 | 前端页面 | 数据迁移编号段（经验值，非强制） |
|---|---|---|---|
| RBAC / 登录 / 用户 / 角色 / 权限菜单 | `routes/rbacRoutes.js` / `auth*` | `pages/Login/` | 001–009 |
| 食材采购（日采购、食材、供应商、确认单、采购统计） | `routes/purchase*` / `routes/ingredients*` | `pages/DailyPurchase/` `pages/Ingredients/` | 011–049 |
| 仓库采购入库 / 库存 / 盘点 / 移库 / 即时使用 | `routes/warehouse*` / `routes/inventory*` / `routes/stock-takes*` / `routes/stock-movements*` | `pages/Warehouse*` `pages/Inventory/` | 050–069 |
| 外请人员（打卡、岗位、考核、统计） | `routes/temp-*.js` | `pages/TempWorker/` | 010、070–079 |
| 预订 / 体检 / 体检套餐 / 企微卡片 / 预订模板卡 / 审核员 | `routes/booking-board.js` / `routes/checkup*` / `wecom*` | `pages/BookingBoard/` `pages/Checkup*` `pages/TemplateCard/` | 080–099、100+ |
| 新增模块（如人事、薪资、财务等） | `routes/<模块>*.js` | `pages/<模块名>/` | 200 起，每个模块留 50 号空间 |

公共模块（跨模块使用）：`backend/signature.js`（签名）、`backend/utils/`（工具）、`backend/pdf/`（PDF 生成）、前端 `src/api/` `src/store/` `src/routes/` `src/components/`。改公共模块必须说明影响范围。

---

## 2. 绝对红线（功能对话不能做，否则 PR 直接打回）

1. **禁止修改部署基础设施 / 凭证文件**，包括但不限于：
   - `.github/workflows/*.yml`（GitHub Actions 流水线）
   - `backend/db.js`（数据库连接池与凭证加载）
   - `backend/server.js`（后端入口与 env 加载）
   - `backend/migrations/migrate.js`（迁移工具）
   - `*.env` / `.env.example`（任何形式的凭证文件）
   - `CONTRIBUTING.md` / `.github/CODEOWNERS` / `README.md` / `PROJECT_SUMMARY.md`（协作约定本身）

   > 如果你确信这些文件有问题，请先停止编码，把问题描述给 Gatekeeper。

2. **禁止在代码中硬编码任何密码 / token / Secret**（包括数据库密码、企微应用 secret、腾讯云 COS secret）。
   - 数据库：统一用 `process.env.DB_HOST / DB_USER / DB_PASSWORD / DB_NAME`。Node 脚本顶部：
     ```js
     require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
     if (!process.env.DB_PASSWORD) { console.error('[脚本名] DB_PASSWORD missing'); process.exit(1); }
     ```
   - 企微 / COS：读 `process.env.WECOM_*` / `TENCENT_*`，不要把真密钥写进代码。

3. **禁止把一次性业务 DML 写在迁移 SQL 里每次重跑覆盖用户数据**。详见第 3 章。

---

## 3. 数据库迁移（Migration SQL）约定

### 3.1 文件位置与命名
- 路径：`backend/migrations/`
- 命名：`NNN_小写英文描述.sql`（NNN 为编号，任意位数整数；编号越大越晚。不要大幅跳号）
- 示例：`102_add_booking_review_columns.sql`

### 3.2 两类迁移必须严格区分

**A 类（Schema DDL —— 建表 / 加字段 / 建索引 / 改类型）**
- 必须**幂等**：可重复执行不报错
- 推荐写法：
  - 建表：`CREATE TABLE IF NOT EXISTS tbl (...)`
  - 加字段：优先用 MySQL 8 的 `ALTER TABLE tbl ADD COLUMN IF NOT EXISTS col ...`；若需兼容 MySQL 5.7，请改用「查询 `information_schema.COLUMNS` → 不存在才 ALTER」的条件语句模式，但**不要用 `DELIMITER` + 存储过程**（见 3.3）
  - 建索引：`CREATE INDEX IF NOT EXISTS idx_xxx ON tbl(col)` 或 `ALTER TABLE tbl ADD INDEX idx_xxx(col)` 失败幂等跳过即可
  - 删字段/索引：`ALTER TABLE tbl DROP COLUMN IF NOT EXISTS col` / `DROP INDEX IF NOT EXISTS idx ON tbl`

**B 类（一次性业务数据 DML —— INSERT / UPDATE / DELETE 初始化业务数据）**
- **绝对不要每次部署都跑它**！它应该只执行一次。处理方式二选一：
  - 方案 A：直接放在迁移 SQL，提交前先让 Gatekeeper 在生产手动执行一次，成功后立刻**改名为 `NNN_描述_DONE.sql`**。migrate.js 会跳过所有 `_DONE.sql`。
  - 方案 B：做成一次性 Node 脚本，放到 `backend/scripts/xxx.js`，保证幂等 + 读 env；在 `.github/workflows/deploy.yml` 的 `migrate` job 末尾追加一行 `node scripts/xxx.js 2>&1 || echo "⚠️ xxx failed, continuing..."`。需 Gatekeeper 同意再加。

### 3.3 迁移 SQL 里禁用的语法（会被 migrate.js 的 mysql2 驱动直接拒绝）

- ❌ `DELIMITER $$ ... DELIMITER ;` —— 这是**mysql 命令行元命令**，不是 SQL，mysql2 不识别。
  - 如果你确实需要存储过程做条件 DDL：请改用纯 SQL 条件、或把存储过程放到 `backend/scripts/xxx.js` 里 Node 条件执行，或者直接在服务器手动跑后改名 `_DONE.sql`。
- ❌ `GRANT / REVOKE` —— 迁移执行账号没有授权权限。需要加权限请让 Gatekeeper 在 root 账号下手动处理。
- ❌ `SOURCE xxx.sql`、`\. xxx.sql` 等命令行客户端元命令。

### 3.4 三类特殊数据有 grep 保护，直接写迁移里也会被跳过
以下三张表的 INSERT/UPDATE/DELETE/REPLACE 如果出现在任何迁移 SQL，migrate.js 会自动跳过（保护用户录入的体检项目/套餐/组合项目业务数据不被初始化数据覆盖）：
- `booking_checkup_items`
- `booking_checkup_packages`
- `booking_package_items`

涉及这些表的初始化数据 DML，必须：
1. 手动在生产 MySQL 命令行执行一次，确认无误；
2. 将该 SQL 改名为 `_DONE.sql` 提交。

---

## 4. 提 PR 流程（功能对话必读）

### 4.1 分支命名
```
feat/<编号>-<功能简称>   新功能（例：feat/123-salary-module）
fix/<编号>-<bug简称>     Bug 修复（例：fix/99-booking-dedup-temp-user）
refactor/<简称>          纯重构不涉及行为
chore/<简称>             配置/依赖/文档
```

### 4.2 本地自检（push 前必须过，否则 Actions `ci-check` 直接挂）
```bash
npm run check      # TS 类型检查（如果项目里没这个脚本就跳过，但仍建议跑 tsc -b --noEmit）
npm run build      # 前端生产构建
```

### 4.3 PR 描述模板（必须填写，否则 Gatekeeper 不会开始 review）

粘贴这段到 PR 描述：

```
## 变更摘要
（一句话概括这次改了什么、为什么改）

## 影响模块
勾选影响的模块：
- [ ] RBAC / 登录
- [ ] 食材采购
- [ ] 仓库采购 / 库存 / 盘点
- [ ] 外请人员
- [ ] 预订 / 体检 / 企微卡片
- [ ] 公共模块（签名 / PDF / 企微 / 工具等）

## 数据库变更（如无填"无"）
- [ ] 新增迁移 SQL：NNN_xxx.sql（编号 & 文件名）
  - 类型：□ Schema DDL（幂等已确认） □ 一次性业务 DML（已手动执行并改名 _DONE.sql）
  - 涉及表：`xxx`、`yyy`
  - 是否包含 `booking_checkup_items / booking_checkup_packages / booking_package_items` 业务数据 DML？ □ 是 □ 否
- [ ] 新增一次性 Node 脚本：backend/scripts/xxx.js（说明是否已加入 deploy.yml migrate job 末尾）

## 后端新增文件 / 路由
（如有列出；rsync 自动同步不用改 deploy.yml，但列出来方便 Gatekeeper 快速扫）

## 前端新增文件 / 路由
（如有列出）

## 接口变更（与现有前端/企微/外部系统的契约）
- [ ] 无  □ 新增接口  □ 修改接口字段  □ 废弃接口
（若变更请列：路由 / 入参变化 / 出参变化 / 是否影响已有前端或企微卡片）

## 验证方式
（你本地做了什么验证：某个 API 用 curl 测通、某个页面构建无 TS 报错、写了步骤）

## 风险 & 回滚点
- 可能影响的线上功能点：
- 回滚方式：□ 纯前端/纯后端代码回滚 □ 需要恢复数据库备份 □ 迁移回滚（说明怎么回）
```

### 4.4 PR 合并规则
- `main` 分支受保护：必须 PR，不能直推。
- `ci-check` status check 必须通过（前端构建成功）。
- 触碰 CODEOWNERS 里的文件 → Gatekeeper 本人强制 review。
- 带迁移 SQL 的 PR → Gatekeeper 本人 review（因为迁移不可逆）。

---

## 5. Gatekeeper（@aonetpc）上线 SOP

> 这一章是给**部署守门人**看的，功能开发 AI 可以不用读。

每次合并 PR 并 push main 前后，按这份清单执行。

### Step 1. PR 审查
- [ ] CODEOWNERS 文件变更：必须理解再 approve，或直接打回
- [ ] 迁移 SQL：
  - [ ] 命名合规、编号合理
  - [ ] DDL 幂等已确认（读 SQL 走一遍"重复执行会不会错"）
  - [ ] 没有 `DELIMITER`、`GRANT`、`SOURCE` 等禁用语法
  - [ ] 若是一次性 DML，要么已改名 `_DONE.sql`，要么已做成脚本。含 `booking_checkup_*` 业务数据的必须手动执行
- [ ] 新增后端脚本：是否正确读 env、无硬编码凭证
- [ ] `ci-check` 状态已绿

### Step 2. 生产备份（每次部署前强烈建议）
服务器 SSH 执行：
```bash
mysqldump -u food_purchase -p --no-tablespaces --single-transaction food_purchase > ~/backup_before_$(date +%Y%m%d_%H%M).sql
ls -lh ~/backup_before_*.sql
```
确认备份文件大小 > 1MB、`grep -c "CREATE TABLE"` 数量与历史一致。

### Step 3. 合并 PR & 看 Actions
合并 Squash and merge（PR 历史更干净）→ 看 Actions 的 5 个 job：
```
ci-check(35s) → deploy-frontend(1-2m) → deploy-backend(20-30s) → migrate(5-20s) → restart(health check)
```
任何一个红叉：打开日志定位，不要硬着头皮往下走。migrate job 报错时，**restart job 不会执行**，旧后端继续跑，线上安全。

### Step 4. 线上抽查
- `sudo systemctl status food-purchase-backend` 看 active
- `sudo journalctl -u food-purchase-backend -n 50 --no-pager` 没有 DB_PASSWORD 缺失 / 大量报错
- 浏览器抽查 1–2 个本次改动直接相关的功能页面 + API
- 如改了迁移：抽查"新字段/新表"是否存在（服务器 `mysql -e "DESC db.tbl"`）
- 如改了企微卡片：走一遍实际流程（撤回 → 重提 → 确认），看模板卡状态是否符合预期

### Step 5. 打回 / 回滚
- 代码回滚：
  ```bash
  cd ~/food-purchase-manager
  git log --oneline -5
  git reset --hard <上一个正常 commit hash>
  sudo rsync -a --delete --exclude node_modules --exclude uploads --exclude '.env' backend/ /opt/food-purchase/backend/
  cd /opt/food-purchase/backend && npm ci --production
  sudo systemctl restart food-purchase-backend
  ```
- 数据库回滚（迁移破坏了数据）：
  ```bash
  mysql -u food_purchase -p food_purchase < ~/backup_before_XXXXXXXX_XXXX.sql
  ```
  然后再做代码回滚。**回滚后务必抽查页面与数据完整性，再对外宣布恢复。**

---

## 6. 常见问题

**Q1：migrate job 出现类似 "You have an error in your SQL syntax near 'DELIMITER $$'" 怎么办？**
A：这条迁移用了 mysql2 驱动不支持的 DELIMITER 元命令。按 3.3 处理：如果是一次性存储过程脚本，服务器手动 mysql 命令行执行后改名 `_DONE.sql` 提交，不要进 migrate.js。不要因为这个就去放松 migrate.js 严格失败语义。

**Q2：新增了 `backend/routes/xxx.js`，deploy.yml 里要不要加一行 `sudo cp backend/routes/xxx.js`？**
A：不用。deploy-backend job 用的是 `rsync -a backend/ /opt/food-purchase/backend/`，只要文件放在 backend 子目录下任何位置都会同步。

**Q3：后端脚本报 DB_PASSWORD 不存在？**
A：检查脚本顶部是否加了 `require('dotenv').config(...)` 并 `process.exit(1)` 当缺 env。生产环境下 `/opt/food-purchase/backend/.env` 必须存在，权限 `600`，属主 `ubuntu`。

**Q4：前端有大量存量 TS 类型错误，ci-check 里 `npm run check` 过不了？**
A：短期 Gatekeeper 可以允许 ci-check 只跑 `npm run build`（不阻塞）。长期目标是让 `check` 从 warnings 开始逐步清零，再切严格 block。

---

## 7. 文件清单速查

| 文件 | 作用 | 能改吗？ |
|---|---|---|
| `.github/workflows/deploy.yml` | 5 阶段部署流水线 | ❌ Gatekeeper 专属 |
| `.github/CODEOWNERS` | 强制 review 规则 | ❌ Gatekeeper 专属 |
| `CONTRIBUTING.md` | 本文件 | ❌ Gatekeeper 专属 |
| `backend/db.js` | DB 连接池 & 凭证加载 | ❌ Gatekeeper 专属 |
| `backend/server.js` | 后端入口 & env 加载 | ❌ Gatekeeper 专属 |
| `backend/migrations/migrate.js` | 迁移工具 & 追踪表 | ❌ Gatekeeper 专属 |
| `backend/migrations/*.sql` | 迁移 SQL（DDL + DML） | ⚠️ 功能对话可新建，但必须 Gatekeeper review |
| `backend/migrations/*_DONE.sql` | 已手动执行完的一次性 SQL，不再执行 | ⚠️ 只能改名进去，不能删 |
| `backend/routes/*.js` | 后端路由 | ✅ 功能对话 |
| `backend/scripts/*.js` | 一次性/运维脚本 | ✅ 功能对话，但要读 env |
| `src/*` | 前端全部 | ✅ 功能对话 |
| `backend/fix-*.js` | 历史数据修复脚本（幂等，migrate job 每次跑） | ⚠️ 新增须 Gatekeeper 同意追加到 migrate job 末尾 |
| `.env` | 生产凭证（已 gitignore） | ❌ 服务器本机，不入仓库 |
