# backend/migrations/ 迁移文件命名与运行约定（体检/套餐数据保护）

> 最后更新：2026-08-15
> 维护者：部署团队
> 适用范围：本目录下 `0*.sql` 所有迁移文件（在 `.github/workflows/deploy.yml` 的 mysql 管道 for 循环中被自动执行）

---

## 一、核心原则 ⚠️

**本目录是「schema 迁移目录」，不是「一次性业务 DML 脚本目录」。**

✅ 放到这里的文件应该是：**幂等的 schema DDL**（CREATE TABLE IF NOT EXISTS / ADD COLUMN IF MISSING / CREATE INDEX…）

❌ 严禁把「一次性业务 DML」（INSERT 种子数据 / UPDATE 批量改分类或价格 / DELETE 清空表）长期留在这里，除非立刻按约定改名收尾。

---

## 二、两类文件的正确做法

### 类型 A：Schema DDL（幂等，可每次部署重复执行）✅

```sql
CREATE TABLE IF NOT EXISTS booking_checkup_items (...)
ALTER TABLE xxx ADD COLUMN IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
```

- 命名规则：`082_add_sales_checkup_memo_column.sql`
- 无需改名 `_DONE.sql`，每次部署自动幂等跑一遍即可

### 类型 B：一次性业务 DML（改用户数据，**绝对不能重复跑**）⛔️

典型就是：
- `INSERT INTO booking_checkup_items ...` —— 插体检项目种子
- `UPDATE booking_checkup_items SET category=..., default_price=...` —— 批量改分类/价格
- `DELETE FROM booking_checkup_items` / `DELETE FROM booking_package_items` —— 清库重导
- `UPDATE booking_checkup_packages SET ...` —— 批量改套餐数据

这类文件的**标准三步收尾流程**（少一步都会出生产事故）：

1. **本地/测试环境验证没问题**
2. **手动在目标服务器跑 1 次**（SSH 登录后 mysql < 081_xxx.sql）
3. **立刻改名加 `_DONE.sql` 后缀提交到 git**

```bash
# 例子：
mv backend/migrations/081_fix_checkup_items_cat_v2.sql \
   backend/migrations/081_fix_checkup_items_cat_v2_DONE.sql
```

deploy.yml 的 for 循环已配：**`*_DONE.sql` → 直接 continue 跳过**，不会再重复执行。

---

## 三、二次兜底保护（即使你忘了改名 _DONE.sql）

`.github/workflows/deploy.yml` for 循环里有 grep 规则：

```bash
grep -Ei '
  (INSERT|UPDATE|DELETE|REPLACE) booking_checkup_items |
  booking_checkup_packages |
  booking_package_items
' *.sql
```

只要 SQL 文件内出现上述 **3 张用户数据表的 DML** → **本轮 deploy 自动 skip**，日志会打印：

```
Skip (contains DML on user data tables booking_checkup_items/packages/package_items):
  081_fix_checkup_items_cat_v2.sql → 如需执行请手动跑一次后改名 _DONE.sql
```

并在 Actions 日志末尾汇总本轮跳过清单（肉眼可见 = 保护生效）。

---

## 四、历史命名参考（`_DONE.sql` 已落地的例子）

- `068_checkup_add_package_sub_items_DONE.sql`
- `069_checkup_role_plan_commission_DONE.sql`
- `070_checkup_add_sort_code_DONE.sql`
- `075_correct_checkup_data_DONE.sql`  —— 一次性 UPDATE 改 200+ 条价格/分类，若重复跑会盖回旧版
- `076_rebuild_checkup_items_seed_DONE.sql` —— INSERT 201 条旧种子，若重复跑会清空后插回旧数据
- `077_category_remap_DONE.sql` —— 分类映射 UPDATE，若重复跑会盖回 v1 半成品分类

---

## 五、违规排查清单（提交 PR / 发版前扫一遍）

- [ ] 是否又新往 `backend/migrations/` 放了 `08*_*.sql`，里面含 `booking_checkup_items` 的 INSERT/UPDATE/DELETE？
  - 是 → 立刻按第二节「类型 B 三步收尾流程」做，跑完就改名 `*_DONE.sql` 再提交
- [ ] 是否把"临时改几条数据的 SQL"写成了文件？
  - 是 → 不要提交到 `backend/migrations/`，放到 `backend/scripts/` 文件夹并加锁（参考 reimport-checkup-items.js / fix-checkup-items-prices.js 的 3 层保护锁模式）
- [ ] 是否想把「按前端 v2 规则批量刷新分类」做成 SQL？
  - ✅ 正确做法：直接点前端按钮「🔖 批量修正分类/类型」。按钮逻辑是用 CheckupItemsTab.tsx 中 CATEGORY_RULES v2 关键词实时推断，UPDATE 对应行。不需要写 migration SQL。
