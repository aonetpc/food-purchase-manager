# 数据库迁移脚本

## 目录结构

```
migrations/
├── README.md                          # 本文件
├── 001_init_rbac_tables.sql           # RBAC基础表创建
├── 002_migrate_user_roles.sql         # 迁移现有用户角色
├── 003_add_user_fields.sql            # 用户表扩展字段
├── 004_init_module_permissions.sql    # 初始化模块和权限数据
├── 005_create_login_methods.sql       # 创建登录方式关联表
├── 006_create_operation_logs.sql      # 创建操作日志表
├── rollback_001_to_006.sql            # 回滚脚本（回滚全部）
└── migrate.js                         # 迁移执行工具
```

## 执行顺序

脚本按编号顺序执行，每个脚本都是幂等的（可重复执行不会报错）。

## 使用方法

### 方式1：使用迁移工具（推荐）

```bash
# 查看迁移状态
node migrate.js status

# 执行所有未执行的迁移
node migrate.js up

# 回滚最近一次迁移
node migrate.js down

# 回滚所有迁移（危险操作）
node migrate.js reset
```

### 方式2：手动执行

```bash
# 1. 备份数据库（必须）
mysqldump -u food_purchase -p food_purchase > backup_$(date +%Y%m%d).sql

# 2. 按顺序执行迁移脚本
mysql -u food_purchase -p food_purchase < 001_init_rbac_tables.sql
mysql -u food_purchase -p food_purchase < 002_migrate_user_roles.sql
mysql -u food_purchase -p food_purchase < 003_add_user_fields.sql
mysql -u food_purchase -p food_purchase < 004_init_module_permissions.sql
mysql -u food_purchase -p food_purchase < 005_create_login_methods.sql
mysql -u food_purchase -p food_purchase < 006_create_operation_logs.sql

# 3. 验证迁移结果
mysql -u food_purchase -p food_purchase -e "SHOW TABLES;"
```

## 迁移记录表

迁移工具会自动创建 `schema_migrations` 表记录已执行的迁移。

## 回滚

如果迁移出问题，执行回滚脚本：

```bash
mysql -u food_purchase -p food_purchase < rollback_001_to_006.sql
```

然后恢复备份：

```bash
mysql -u food_purchase -p food_purchase < backup_YYYYMMDD.sql
```

## 重要说明

1. **执行前必须备份数据库**
2. 迁移期间建议停止后端服务
3. 新旧字段共存过渡，不影响现有功能
4. 迁移完成后，现有代码无需立即修改
