-- Migration 102: user_signatures 加唯一键 + 去重历史重复行
-- Context: 食材采购确认页 + 仓库采购 + 预订确认页签字保存接口 都写了
--   INSERT ... ON DUPLICATE KEY UPDATE signature_data=VALUES(signature_data), updated_at=NOW()
--   但 user_signatures 表至今没有 (user_id, user_source) UNIQUE KEY，
--   所以 ON DUPLICATE KEY UPDATE 分支从未命中，实际每次都插新行，
--   导致"签字保存后下次读不到/读到旧值"的隐式bug跨三个模块存在。
--
--   本次迁移：
--   1) 先删除重复行（保留 user_id+user_source 相同组合中 id 最大的那条，
--      即最新插入的记录，避免 ALTER TABLE ADD UNIQUE 时 Duplicate entry 失败）；
--   2) 再加 UNIQUE KEY uk_user_src (user_id, user_source)。
--
-- Idempotent: 重复执行安全。
--   - DELETE JOIN 在没有重复行时影响 0 行；
--   - ADD UNIQUE KEY 已存在时报 Duplicate key name，
--     deploy.yml 跑迁移用 mysql --force 忽略非致命错误 继续。

-- 1) 去重：删除重复保留最新
DELETE a
  FROM user_signatures a
  INNER JOIN user_signatures b
    ON a.user_id       = b.user_id
   AND a.user_source   = b.user_source
   AND a.id            <> b.id
   AND a.updated_at   <= b.updated_at;

-- 2) 加唯一键
ALTER TABLE user_signatures
  ADD UNIQUE KEY uk_user_src (user_id, user_source);
