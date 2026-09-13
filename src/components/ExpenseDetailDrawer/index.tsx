/**
 * 费用审批详情抽屉（共用组件）
 * 被 ExpensePaymentMonitor 和 MyExpenseSummary 共用
 */
import { ExpenseApprovalDetail } from '@/lib/api';

// ---- 工具函数 ----

export function formatAmount(val: string | number | null | undefined): string {
  const n = Number(val);
  if (!n || isNaN(n)) return '0.00';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatTime(val: string | null | undefined): string {
  if (!val) return '-';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return val; }
}

function formatControlValue(controlType: string | undefined, rawValue: any): string {
  if (!rawValue) return '-';
  try {
    const val = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (controlType === 'Money') {
      const money = val?.new_money ?? val?.value ?? val;
      return `¥${formatAmount(money)}`;
    }
    if (controlType === 'Selector') {
      return val?.value || val?.text || JSON.stringify(val);
    }
    if (controlType === 'BankAccount') {
      const parts = [val?.account_name, val?.account_number, val?.bank_name, val?.subbranch].filter(Boolean);
      return parts.join(' / ') || JSON.stringify(val);
    }
    if (typeof val === 'object') {
      return val?.text || val?.value || JSON.stringify(val);
    }
    return String(val);
  } catch {
    return String(rawValue);
  }
}

// ---- 子组件 ----

function StatusBadge({ status, label }: { status: number; label: string }) {
  const colorMap: Record<number, string> = {
    1: 'bg-blue-100 text-blue-700',
    2: 'bg-green-100 text-green-700',
    3: 'bg-red-100 text-red-700',
    4: 'bg-gray-100 text-gray-700',
  };
  const color = colorMap[status] || 'bg-gray-100 text-gray-700';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${color}`}>{label}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-900 border-b border-gray-100 pb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="w-28 flex-shrink-0 text-gray-500">{label}</span>
      <span className="flex-1 text-gray-900">{value}</span>
    </div>
  );
}

// ---- 主组件 ----

export interface DetailDrawerProps {
  spNo: string;
  data: ExpenseApprovalDetail | null;
  loading: boolean;
  onClose: () => void;
  /** 是否显示底部"标记已支付"操作栏（监控页=有权限时true，我的报销页=false） */
  canMarkPaid?: boolean;
  /** 是否显示底部"标记已收到"操作栏（我的报销页=true，监控页=false） */
  canMarkReceived?: boolean;
  receivedStatus?: 'unreceived' | 'received';
  onMarkPaid?: (spNo: string, action: 'paid' | 'unpaid') => void;
  onMarkReceived?: (spNo: string, action: 'received' | 'unreceived') => void;
}

export function DetailDrawer({
  spNo, data, loading, onClose, canMarkPaid, canMarkReceived, receivedStatus, onMarkPaid, onMarkReceived,
}: DetailDrawerProps) {
  const nodes = data?.nodes || [];
  const forms = data?.forms || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抽屉头部 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">审批单详情</h2>
            <p className="text-sm text-gray-500 font-mono">{spNo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>

        {/* 抽屉内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-gray-400">加载中...</div>
          ) : data ? (
            <div className="space-y-6">
              {/* 基本信息 */}
              <Section title="基本信息">
                <DetailRow label="审批名称" value={data.sp_name || '-'} />
                <DetailRow label="申请人" value={data.applyer_name || data.applyer_userid || '-'} />
                <DetailRow label="申请时间" value={formatTime(data.apply_time)} />
                <DetailRow label="审批状态" value={data.sp_status_name || '-'} />
                <DetailRow label="当前节点" value={data.current_node_name || '-'} />
                <DetailRow label="当前待审人" value={data.current_approver_name || '-'} />
                <DetailRow label="支付状态" value={data.payment?.payment_status === 'paid' ? '✓ 已支付' : '未支付'} />
                {data.payment?.paid_time && (
                  <DetailRow label="支付时间" value={formatTime(data.payment.paid_time)} />
                )}
                {data.payment?.paid_by_name && (
                  <DetailRow label="支付操作人" value={data.payment.paid_by_name} />
                )}
                {data.payment?.payment_remark && (
                  <DetailRow label="支付备注" value={data.payment.payment_remark} />
                )}
                {canMarkReceived && (
                  <DetailRow label="收到状态" value={receivedStatus === 'received' ? '✓ 已收到' : '未收到'} />
                )}
              </Section>

              {/* 表单值 */}
              {forms.length > 0 && (
                <Section title="申请表单">
                  {forms.map((f: any, i: number) => (
                    <DetailRow
                      key={i}
                      label={f.control_title || f.control_type || `字段${i + 1}`}
                      value={formatControlValue(f.control_type, f.control_value)}
                    />
                  ))}
                </Section>
              )}

              {/* 审批节点 timeline */}
              {nodes.length > 0 && (
                <Section title="审批流程">
                  <div className="space-y-3">
                    {nodes.map((node: any, i: number) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`h-3 w-3 rounded-full ${
                            node.is_current ? 'bg-blue-500 ring-4 ring-blue-100' :
                            node.sp_status === 2 ? 'bg-green-500' :
                            node.sp_status === 3 ? 'bg-red-500' : 'bg-gray-300'
                          }`} />
                          {i < nodes.length - 1 && <div className="h-8 w-px bg-gray-200" />}
                        </div>
                        <div className="pb-4">
                          <p className="text-sm font-medium text-gray-900">
                            {node.node_name || `节点${node.node_index + 1}`}
                            {node.is_current === 1 && (
                              <span className="ml-2 text-xs text-blue-600">（当前）</span>
                            )}
                          </p>
                          {node.approver_name && (
                            <p className="text-xs text-gray-500">
                              {node.approver_name}
                              {node.speech && `: ${node.speech}`}
                            </p>
                          )}
                          {node.approve_time && (
                            <p className="text-xs text-gray-400">{formatTime(node.approve_time)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">加载失败</div>
          )}
        </div>

        {/* 抽屉底部：标记已支付（监控页） */}
        {canMarkPaid && data && (data.sp_status === 1 || data.sp_status === 2) && (
          <div className="border-t border-gray-200 p-4">
            {data.payment?.payment_status === 'unpaid' ? (
              <button
                onClick={() => onMarkPaid?.(spNo, 'paid')}
                className="btn-primary w-full"
              >标记为已支付</button>
            ) : (
              <button
                onClick={() => onMarkPaid?.(spNo, 'unpaid')}
                className="btn-secondary w-full"
              >撤销已支付标记</button>
            )}
          </div>
        )}

        {/* 抽屉底部：标记已收到（我的报销页） */}
        {canMarkReceived && data && (data.sp_status === 1 || data.sp_status === 2) && (
          <div className="border-t border-gray-200 p-4">
            {receivedStatus === 'unreceived' ? (
              <button
                onClick={() => onMarkReceived?.(spNo, 'received')}
                className="btn-primary w-full"
              >标记为已收到</button>
            ) : (
              <button
                onClick={() => onMarkReceived?.(spNo, 'unreceived')}
                className="btn-secondary w-full"
              >撤销已收到标记</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { StatusBadge };
