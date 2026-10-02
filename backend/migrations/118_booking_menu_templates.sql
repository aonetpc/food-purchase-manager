-- 118_booking_menu_templates.sql
-- 预订调度-菜单模板库
-- 解决午餐/晚餐菜单被粘贴在 remark（特殊要求）字段导致可读性差的问题
-- 模板库 + 多图 + 文本，可在 PC/H5 两端折叠展示

CREATE TABLE IF NOT EXISTS booking_menu_templates (
  id            VARCHAR(36)  PRIMARY KEY,
  name          VARCHAR(100) NOT NULL COMMENT '模板名称（如：标准商务套餐A）',
  scope         VARCHAR(20)  NOT NULL DEFAULT 'both' COMMENT '适用范围：lunch/dinner/both',
  content_text  TEXT         COMMENT '菜单文本（多行，可包含菜品分组）',
  content_json  JSON         COMMENT '可选：结构化分组（冷菜/热菜/汤/主食等）',
  image_urls    JSON         COMMENT '菜单图片URL数组（多图）',
  sort_order    INT          NOT NULL DEFAULT 100,
  status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用',
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scope_status (scope, status),
  INDEX idx_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订调度-菜单模板库';
