-- 083: 按项目名关键字批量填写 booking_checkup_items.applicable_roles
-- 目标：男性视角不显示妇科（乳腺/宫颈/阴超/阴道镜/白带/HPV/TCT/妇科内诊）项目
--       已婚女/未婚女视角不显示男科（前列腺/阴囊/精液/男科/睾丸）项目
--       未婚女视角不显示阴超/阴道镜/宫腔镜/妇科内诊（侵入性检查禁做）
-- 幂等：只 UPDATE applicable_roles IS NULL 的行，已手动填过的保留原值

-- ============================================================
-- 第一组：男性专属（applicable_roles = ["male"]）
-- ============================================================
UPDATE booking_checkup_items
SET applicable_roles = JSON_ARRAY('male')
WHERE applicable_roles IS NULL
  AND (
    name LIKE '%前列腺%'
 OR name LIKE '%阴囊%'
 OR name LIKE '%精液%'
 OR name LIKE '%男科%'
 OR name LIKE '%睾丸%'
 OR name LIKE '%勃起%'
 OR name LIKE '%包皮%'
 OR name LIKE '%精索%'
 OR name LIKE '%附睾%'
 OR name LIKE '%PSA%'
 OR name LIKE '%男性激素%'
);

-- ============================================================
-- 第二组：已婚女专属（applicable_roles = ["female_married"]）
--   阴道侵入性检查：未婚女禁做
-- ============================================================
UPDATE booking_checkup_items
SET applicable_roles = JSON_ARRAY('female_married')
WHERE applicable_roles IS NULL
  AND (
    name LIKE '%阴超%'
 OR name LIKE '%阴道B%'
 OR name LIKE '%阴道镜%'
 OR name LIKE '%宫腔镜%'
 OR name LIKE '%妇科内诊%'
 OR name LIKE '%双合诊%'
 OR name LIKE '%白带%'
 OR name LIKE '%宫颈刮片%'
 OR name LIKE '%TCT%'
 OR name LIKE '%液基%'
 OR name LIKE '%HPV%'
 OR name LIKE '%宫颈%'        -- 宫颈相关（宫颈糜烂/宫颈囊肿/宫颈纳氏/宫颈筛查）
 OR name LIKE '%阴道%'        -- 阴道分泌物/阴道分泌物常规（注意要放在"阴超/阴道镜"后面，上面已匹配的不会被本句重复覆盖）
);

-- ============================================================
-- 第三组：已婚女+未婚女通用（applicable_roles = ["female_married","female_single"]）
--   非侵入性的女性通用项目
-- ============================================================
UPDATE booking_checkup_items
SET applicable_roles = JSON_ARRAY('female_married', 'female_single')
WHERE applicable_roles IS NULL
  AND (
    name LIKE '%乳腺%'         -- 乳腺彩超/钼靶/乳腺触诊（男女都可能做，但男性极少，默认女性）
 OR name LIKE '%卵巢%'         -- 卵巢超声/卵巢功能
 OR name LIKE '%子宫%'         -- 子宫超声（经腹，未婚女也可做）
 OR name LIKE '%盆腔%'         -- 盆腔超声（默认经腹 = 通用）
 OR name LIKE '%附件%'         -- 附件超声
 OR name LIKE '%性激素%'       -- 性激素六项
 OR name LIKE '%雌激素%'
 OR name LIKE '%孕酮%'
 OR name LIKE '%妇科%'         -- 妇科彩超/妇科常规（未明确侵入性的默认通用）
 OR name LIKE '%妇产科%'
 OR name LIKE '%产前%'
 OR name LIKE '%唐筛%'
 OR name LIKE '%孕检%'
 OR name LIKE '%HCG%'          -- β-HCG 人绒毛膜促性腺激素
 OR name LIKE '%人绒毛膜%'
 OR name LIKE '%月经%'
 OR name LIKE '%痛经%'
);

-- ============================================================
-- 第三组之后的特殊修正（处理第三组里的"冲突"项目）
--   例："盆腔超声（经阴道）"被第三组设成了通用，应改回已婚女
-- ============================================================
UPDATE booking_checkup_items
SET applicable_roles = JSON_ARRAY('female_married')
WHERE (
    name LIKE '%盆腔%阴道%'
 OR name LIKE '%阴道%盆腔%'
 OR name LIKE '%盆腔%经阴道%'
 OR name LIKE '%子宫%经阴道%'
 OR name LIKE '%附件%经阴道%'
)
  AND JSON_CONTAINS(applicable_roles, JSON_ARRAY('female_single'));  -- 只修正被第三组误归类为"通用"的
