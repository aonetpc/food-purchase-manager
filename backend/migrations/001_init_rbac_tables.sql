-- ================================================
-- 001 - RBAC 基础表结构创建
-- 创建角色表、模块表、权限表、角色权限关联表
-- 幂等执行：可重复执行不会报错
-- ================================================

-- ================================================
-- 1. 角色表（替代 users.role 硬编码字段）
-- ================================================
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT '角色编码',
  name VARCHAR(50) NOT NULL COMMENT '角色名称',
  description VARCHAR(200) COMMENT '描述',
  is_system TINYINT DEFAULT 0 COMMENT '是否系统内置角色（1=内置不可删除）',
  sort_order INT DEFAULT 0 COMMENT '排序',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色表';

-- ================================================
-- 2. 模块表（业务模块定义）
-- ================================================
CREATE TABLE IF NOT EXISTS modules (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE COMMENT '模块编码',
  name VARCHAR(50) NOT NULL COMMENT '模块名称',
  icon VARCHAR(50) COMMENT '图标',
  description VARCHAR(200) COMMENT '描述',
  sort_order INT DEFAULT 0 COMMENT '排序',
  status TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业务模块表';

-- ================================================
-- 3. 权限表（菜单/按钮/API 级别权限）
-- ================================================
CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(36) PRIMARY KEY,
  module_id VARCHAR(36) NOT NULL COMMENT '所属模块ID',
  code VARCHAR(100) NOT NULL COMMENT '权限编码（如 menu:daily, action:entry:create）',
  name VARCHAR(100) NOT NULL COMMENT '权限名称',
  type ENUM('menu', 'button', 'api') NOT NULL DEFAULT 'menu' COMMENT '权限类型',
  parent_id VARCHAR(36) DEFAULT NULL COMMENT '父权限ID（用于树形结构）',
  path VARCHAR(200) COMMENT '前端路由路径',
  icon VARCHAR(50) COMMENT '图标',
  sort_order INT DEFAULT 0 COMMENT '排序',
  status TINYINT DEFAULT 1 COMMENT '状态：1启用 0禁用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_module_code (module_id, code),
  INDEX idx_module (module_id),
  INDEX idx_type (type),
  INDEX idx_parent (parent_id),
  INDEX idx_status (status),
  CONSTRAINT fk_perm_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限表';

-- ================================================
-- 4. 角色权限关联表
-- ================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id VARCHAR(36) PRIMARY KEY,
  role_id VARCHAR(36) NOT NULL COMMENT '角色ID',
  permission_id VARCHAR(36) NOT NULL COMMENT '权限ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_perm (role_id, permission_id),
  INDEX idx_role (role_id),
  INDEX idx_permission (permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色权限关联表';

-- ================================================
-- 5. 迁移记录表（供 migrate.js 使用）
-- ================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(100) PRIMARY KEY COMMENT '迁移脚本编号（如 001）',
  filename VARCHAR(200) NOT NULL COMMENT '脚本文件名',
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '执行时间',
  INDEX idx_id (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='迁移执行记录';

-- ================================================
-- 完成提示
-- ================================================
SELECT '001_init_rbac_tables.sql 执行完成' AS message;
