// ============================================================
// 仓库采购审批对账（管理员一键对账 / 每日核对共用）
//   - 扫描在途单据，逐条查询企微审批详情
//   - 与本地状态比对，输出差异清单
//   - dryRun=true 时只报告，不写库、不发通知
//   - dryRun=false 时按统一映射写库，同时对 6/7 冻结写审计告警
// ============================================================

const pool = require('../db');
const {
  parseSpStatus,
  mapPurchaseApproval,
  mapReimbursement,
  mapPrepayApproval,
  isApplied,
  applyFields,
  writeAlertLog,
} = require('./wecom-approval-status');

// 在途单据：采购审批中 / 报销中 / 预付款审批中 / 月结付款待回款
const IN_FLIGHT_SQL = `
  SELECT id, purchase_no, status, purchase_type,
         approval_sp_no, approval_status,
         reimbursement_sp_no, reimbursement_status, writeoff_status,
         prepay_sp_no, prepay_status,
         monthly_payment_sp_no, monthly_paid_at
  FROM warehouse_purchases
  WHERE (status = 'pending_approval' AND approval_sp_no IS NOT NULL AND approval_sp_no <> '')
     OR (status = 'reimbursing' AND reimbursement_sp_no IS NOT NULL AND reimbursement_sp_no <> '')
     OR (prepay_sp_no IS NOT NULL AND prepay_sp_no <> '' AND prepay_status = 'pending')
     OR (purchase_type = 'monthly' AND monthly_payment_sp_no IS NOT NULL AND monthly_payment_sp_no <> '' AND monthly_paid_at IS NULL)
  ORDER BY created_at ASC
`;

function pickCurrent(row, fields) {
  const current = {};
  Object.keys(fields).forEach((key) => {
    current[key] = row[key] ?? null;
  });
  return current;
}

async function reconcileApprovals({ dryRun = true } = {}) {
  // 延迟 require，避免与 routes/wecom.js 形成加载期循环依赖
  const { getWecomConfig, getApprovalDetail } = require('../routes/wecom');

  const config = await getWecomConfig();
  if (!config || !config.corp_id || !config.app_secret) {
    return { ok: false, error: '请先完成企业微信应用配置' };
  }

  const [rows] = await pool.query(IN_FLIGHT_SQL);
  const differences = [];
  const errors = [];
  let appliedCount = 0;

  const fetchSpStatus = async (row, spNo, docType) => {
    try {
      const detail = await getApprovalDetail(config, spNo);
      const raw = detail?.info?.sp_status ?? detail?.sp_status;
      return { raw };
    } catch (err) {
      errors.push({
        id: row.id,
        purchase_no: row.purchase_no,
        doc_type: docType,
        sp_no: spNo,
        error: err.message,
      });
      return null;
    }
  };

  // 统一处理「映射 → 差异 → 可选写库」
  const handleMapping = async (row, spNo, docType, frozenField, rawSpStatus, mapping, extraFields = {}) => {
    if (!mapping) {
      errors.push({
        id: row.id,
        purchase_no: row.purchase_no,
        doc_type: docType,
        sp_no: spNo,
        error: `sp_status=${rawSpStatus ?? '未知'} 暂不支持自动同步`,
      });
      return;
    }

    const fields = { ...mapping.fields, ...extraFields };
    const changed = !isApplied(row, fields);
    const needAlert = mapping.alert && row[frozenField] !== 'frozen';

    if (!changed && !needAlert) return;

    let applied = false;
    if (!dryRun) {
      if (changed) {
        await applyFields(pool, 'warehouse_purchases', row.id, fields);
        applied = true;
        appliedCount += 1;
      }
      if (needAlert) {
        await writeAlertLog(pool, {
          purchaseId: row.id,
          spNo,
          docType,
          spStatus: mapping.spStatus,
          message: mapping.message,
        });
      }
    }

    differences.push({
      id: row.id,
      purchase_no: row.purchase_no,
      doc_type: docType,
      sp_no: spNo,
      sp_status: mapping.spStatus,
      action: mapping.action,
      frozen: mapping.frozen,
      alert: needAlert,
      from: pickCurrent(row, fields),
      to: fields,
      applied,
      message: mapping.message || '',
    });
  };

  for (const row of rows) {
    // 1) 采购审批
    if (row.status === 'pending_approval' && row.approval_sp_no) {
      const detail = await fetchSpStatus(row, row.approval_sp_no, 'warehouse_purchase_approval');
      if (detail) {
        const mapping = mapPurchaseApproval(detail.raw);
        await handleMapping(row, row.approval_sp_no, 'warehouse_purchase_approval', 'approval_status', detail.raw, mapping);
      }
    }

    // 2) 报销审批
    if (row.status === 'reimbursing' && row.reimbursement_sp_no) {
      const detail = await fetchSpStatus(row, row.reimbursement_sp_no, 'warehouse_purchase_reimbursement');
      if (detail) {
        const mapping = mapReimbursement(detail.raw, row);
        const extraFields = {};
        if (mapping && mapping.action === 'approve' && row.purchase_type === 'prepay' &&
            (row.writeoff_status === 'manual' || row.writeoff_status === 'reimbursing')) {
          extraFields.writeoff_status = 'auto';
        }
        if (mapping && (mapping.action === 'reject' || mapping.action === 'revoke') &&
            row.purchase_type === 'prepay' && row.writeoff_status === 'reimbursing') {
          extraFields.writeoff_status = 'manual';
        }
        await handleMapping(row, row.reimbursement_sp_no, 'warehouse_purchase_reimbursement', 'reimbursement_status', detail.raw, mapping, extraFields);
      }
    }

    // 3) 预付款审批
    if (row.prepay_sp_no && row.prepay_status === 'pending') {
      const detail = await fetchSpStatus(row, row.prepay_sp_no, 'warehouse_purchase_prepay');
      if (detail) {
        const mapping = mapPrepayApproval(detail.raw);
        await handleMapping(row, row.prepay_sp_no, 'warehouse_purchase_prepay', 'prepay_status', detail.raw, mapping);
      }
    }

    // 4) 月结付款：企微通过后应标记已付款
    if (row.purchase_type === 'monthly' && row.monthly_payment_sp_no && !row.monthly_paid_at) {
      const detail = await fetchSpStatus(row, row.monthly_payment_sp_no, 'warehouse_purchase_monthly_payment');
      if (detail) {
        const spStatus = parseSpStatus(detail.raw);
        if (spStatus === null) {
          errors.push({
            id: row.id,
            purchase_no: row.purchase_no,
            doc_type: 'warehouse_purchase_monthly_payment',
            sp_no: row.monthly_payment_sp_no,
            error: `sp_status=${detail.raw ?? '未知'} 暂不支持自动同步`,
          });
        } else if (spStatus === 2) {
          let applied = false;
          if (!dryRun) {
            await pool.query(
              'UPDATE warehouse_purchases SET monthly_paid_at = NOW() WHERE id = ? AND monthly_paid_at IS NULL',
              [row.id]
            );
            applied = true;
            appliedCount += 1;
          }
          differences.push({
            id: row.id,
            purchase_no: row.purchase_no,
            doc_type: 'warehouse_purchase_monthly_payment',
            sp_no: row.monthly_payment_sp_no,
            sp_status: spStatus,
            action: 'mark_paid',
            frozen: false,
            alert: false,
            from: { monthly_paid_at: null },
            to: { monthly_paid_at: 'NOW()' },
            applied,
            message: '',
          });
        } else if (spStatus === 4 || spStatus === 6 || spStatus === 7) {
          differences.push({
            id: row.id,
            purchase_no: row.purchase_no,
            doc_type: 'warehouse_purchase_monthly_payment',
            sp_no: row.monthly_payment_sp_no,
            sp_status: spStatus,
            action: 'manual_review',
            frozen: spStatus === 6 || spStatus === 7,
            alert: true,
            from: { monthly_paid_at: null },
            to: {},
            applied: false,
            message: '月结付款审批已撤销/删除，本地未付款标记保持不变，请人工核对',
          });
        }
      }
    }
  }

  return {
    ok: true,
    dry_run: dryRun,
    scanned: rows.length,
    difference_count: differences.length,
    applied_count: appliedCount,
    differences,
    errors,
  };
}

module.exports = { reconcileApprovals };
