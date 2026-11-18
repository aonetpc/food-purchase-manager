// ============================================================
// 企微审批状态统一映射
//   - 入参统一为企微 sp_status（字符串或数字）
//   - 按单据类型返回「目标字段 + 动作 + 是否冻结/告警」
//   - 约定：解析失败 / 未知状态一律返回 null，调用方不得写库
//
// sp_status 取值：
//   1 审批中   2 已通过   3 已驳回   4 已撤销
//   6 通过后撤销   7 已删除   10 已支付（本模块不处理，返回 null）
// ============================================================

const SP_STATUS = Object.freeze({
  PENDING: 1,
  APPROVED: 2,
  REJECTED: 3,
  REVOKED: 4,
  REVOKED_AFTER_APPROVED: 6,
  DELETED: 7,
});

// 本模块只负责这 6 个状态；10（已支付）等其他状态返回 null，避免误写业务状态
const MAPPABLE_STATUS = [1, 2, 3, 4, 6, 7];

// 允许被 applyFields 写入的表（内部白名单，避免表名拼接风险）
const ALLOWED_TABLES = new Set(['warehouse_purchases', 'purchase_confirmations']);

/**
 * 解析企微 sp_status
 * @param {number|string|null|undefined} raw
 * @returns {number|null} 1/2/3/4/6/7，无法识别返回 null
 */
function parseSpStatus(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(num)) return null;
  return MAPPABLE_STATUS.includes(num) ? num : null;
}

function buildResult(spStatus, action, fields, extra = {}) {
  return {
    spStatus,
    action,
    fields,
    frozen: false,
    alert: false,
    message: '',
    ...extra,
  };
}

/**
 * 采购审批单映射
 *   1 → pending_approval/pending
 *   2 → approved/approved
 *   3 → rejected/rejected
 *   4 → draft/canceled（可重新提交）
 *   6/7 → 冻结（approval_status=frozen），禁止自动回退
 */
function mapPurchaseApproval(raw) {
  const spStatus = parseSpStatus(raw);
  if (spStatus === null) return null;

  switch (spStatus) {
    case 1:
      return buildResult(spStatus, 'pending', {
        status: 'pending_approval',
        approval_status: 'pending',
      });
    case 2:
      return buildResult(spStatus, 'approve', {
        status: 'approved',
        approval_status: 'approved',
      });
    case 3:
      return buildResult(spStatus, 'reject', {
        status: 'rejected',
        approval_status: 'rejected',
      });
    case 4:
      return buildResult(spStatus, 'revoke', {
        status: 'draft',
        approval_status: 'canceled',
      });
    case 6:
    case 7:
    default:
      return buildResult(spStatus, 'freeze', { approval_status: 'frozen' }, {
        frozen: true,
        alert: true,
        message: '采购审批单在企业微信已通过后被撤销/删除，OA 状态已冻结，请人工核对',
      });
  }
}

/**
 * 报销审批单映射
 *   1 → reimbursing/processing（显式保留，避免界面从「报销中」退回）
 *   2 → reimbursed/approved
 *   3 → reimbursement_status=rejected（status 保持不变，与现有行为一致）
 *   4 → 未完成报销：confirmed/revoked（可重新发起）
 *       已完成报销（reimbursed/completed）：冻结，禁止回退与重发
 *   6/7 → 冻结（reimbursement_status=frozen）
 * @param {number|string} raw
 * @param {object} current 当前单据行（至少包含 status）
 */
function mapReimbursement(raw, current = {}) {
  const spStatus = parseSpStatus(raw);
  if (spStatus === null) return null;

  switch (spStatus) {
    case 1:
      return buildResult(spStatus, 'pending', {
        status: 'reimbursing',
        reimbursement_status: 'processing',
      });
    case 2:
      return buildResult(spStatus, 'approve', {
        status: 'reimbursed',
        reimbursement_status: 'approved',
      });
    case 3:
      return buildResult(spStatus, 'reject', {
        reimbursement_status: 'rejected',
      });
    case 4:
      if (current.status === 'reimbursed' || current.status === 'completed') {
        return buildResult(spStatus, 'freeze', { reimbursement_status: 'frozen' }, {
          frozen: true,
          alert: true,
          message: '报销已完成（已通过审批）后在企业微信被撤销，OA 状态已冻结，请人工核对',
        });
      }
      return buildResult(spStatus, 'revoke', {
        status: 'confirmed',
        reimbursement_status: 'revoked',
      });
    case 6:
    case 7:
    default:
      return buildResult(spStatus, 'freeze', { reimbursement_status: 'frozen' }, {
        frozen: true,
        alert: true,
        message: '报销审批单在企业微信已通过后被撤销/删除，OA 状态已冻结，请人工核对',
      });
  }
}

/**
 * 预付款审批单映射
 *   1 → pending  2 → approved  3 → rejected  4 → revoked
 *   6/7 → frozen（禁止自动回退）
 */
function mapPrepayApproval(raw) {
  const spStatus = parseSpStatus(raw);
  if (spStatus === null) return null;

  switch (spStatus) {
    case 1:
      return buildResult(spStatus, 'pending', { prepay_status: 'pending' });
    case 2:
      return buildResult(spStatus, 'approve', { prepay_status: 'approved' });
    case 3:
      return buildResult(spStatus, 'reject', { prepay_status: 'rejected' });
    case 4:
      return buildResult(spStatus, 'revoke', { prepay_status: 'revoked' });
    case 6:
    case 7:
    default:
      return buildResult(spStatus, 'freeze', { prepay_status: 'frozen' }, {
        frozen: true,
        alert: true,
        message: '预付款审批单在企业微信已通过后被撤销/删除，OA 状态已冻结，请人工核对',
      });
  }
}

/**
 * 判断映射结果是否已经落库（用于回调幂等，避免重复 UPDATE）
 */
function isApplied(current, fields) {
  if (!current || !fields) return true;
  return Object.keys(fields).every((key) => String(current[key] ?? '') === String(fields[key]));
}

/**
 * 按映射结果写库；fields 为空时不做任何写入
 * @returns {Promise<boolean>} 是否执行了 UPDATE
 */
async function applyFields(db, table, id, fields) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`applyFields 不支持的表: ${table}`);
  }
  const keys = Object.keys(fields || {});
  if (keys.length === 0 || !id) return false;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await db.query(sql, [...keys.map((k) => fields[k]), id]);
  return true;
}

/**
 * 审批异常告警：只写审计日志，不改业务状态
 * 出错不抛出，避免告警失败影响主流程
 */
async function writeAlertLog(db, { purchaseId, spNo, docType, spStatus, message }) {
  try {
    const logId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    await db.query(
      'INSERT INTO user_operation_logs (id, user_id, target_user_id, module, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        logId,
        'system',
        null,
        'warehouse_purchase',
        'approval_frozen',
        JSON.stringify({ purchase_id: purchaseId || null, sp_no: spNo || null, doc_type: docType || null, sp_status: spStatus, message }),
        '',
        'system',
      ]
    );
  } catch (err) {
    console.error('[审批异常告警] 写审计日志失败:', err.message);
  }
}

module.exports = {
  SP_STATUS,
  parseSpStatus,
  mapPurchaseApproval,
  mapReimbursement,
  mapPrepayApproval,
  isApplied,
  applyFields,
  writeAlertLog,
};
