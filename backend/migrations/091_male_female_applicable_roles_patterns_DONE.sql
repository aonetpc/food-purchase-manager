-- 091: 对名称含(男)/（男）或(女)/（女）后缀的体检项目，批量填充 applicable_roles
-- 背景：083 迁移仅按项目名关键词（前列腺/HPV/乳腺等）填充 applicable_roles，
--       但像"肿瘤标志11项（男）""肿瘤指标(女)11项"这类靠后缀区分配套的组合项目
--       083 没覆盖到，导致 SharePage 读取时 applicable_roles 为 NULL，
--       退化为关键词可见性判断，而关键词又未包含 (男)/(女)，
--       最终肿瘤男/女两个专属组合在所有角色方案里同时显示，
--       并导致 original_total / 折扣价计算错误。
-- 规则：
--   名称里只出现 "(男)/（男）男士/男性专用" 且不出现任何 "(女)/（女）女士" 关键字
--     → applicable_roles = ["male"]
--   名称里只出现 "(女)/（女）女士/女性专用" 且不出现任何 "(男)/（男）男士" 关键字
--     → applicable_roles = ["female_married","female_single"]
--   如 "肿瘤5项（男）/（女）" → 两种标记都出现 → 跳过（男女通用）
--
-- 幂等：仅 UPDATE applicable_roles IS NULL 或 JSON 长度为 0 的行，
-- 已手动填过的 / 已被 083 正确填充的保持不变。

-- 第一段：男性专属（名称里只有"男"标记且没有"女"标记）
UPDATE booking_checkup_items
SET applicable_roles = JSON_ARRAY('male')
WHERE status != 0
  AND (applicable_roles IS NULL OR JSON_LENGTH(applicable_roles) = 0)
  AND (
    -- 括号 + 男 的模式
    name REGEXP '[（(]男[)）]'
 OR name LIKE '%男士%'
 OR name LIKE '%男专用%'
 OR (name LIKE '%男性%' AND name NOT LIKE '%女性%')
  )
  AND NOT (
    -- 出现任何"女"标记 → 取消（如"肿瘤5项（男）/（女）"）
    name REGEXP '[（(]女[)）]'
 OR name LIKE '%女士%'
 OR name LIKE '%女专用%'
 OR name LIKE '%女性%'
  );

-- 第二段：女性专属（名称里只有"女"标记且没有"男"标记）
UPDATE booking_checkup_items
SET applicable_roles = JSON_ARRAY('female_married', 'female_single')
WHERE status != 0
  AND (applicable_roles IS NULL OR JSON_LENGTH(applicable_roles) = 0)
  AND (
    name REGEXP '[（(]女[)）]'
 OR name LIKE '%女士%'
 OR name LIKE '%女专用%'
 OR (name LIKE '%女性%' AND name NOT LIKE '%男性%')
  )
  AND NOT (
    name REGEXP '[（(]男[)）]'
 OR name LIKE '%男士%'
 OR name LIKE '%男专用%'
 OR name LIKE '%男性%'
  );
