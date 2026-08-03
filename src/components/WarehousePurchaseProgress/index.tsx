import { Check } from 'lucide-react';

// 采购流程节点定义
interface ProgressNode {
  key: string;
  label: string;
}

// 不同采购类型的流程节点
const FLOW_NODES: Record<string, ProgressNode[]> = {
  // 现购：草稿 → 审批 → 收货 → 确认 → 报销 → 完成
  normal: [
    { key: 'draft', label: '草稿' },
    { key: 'pending_approval', label: '审批' },
    { key: 'approved', label: '收货' },
    { key: 'received', label: '确认' },
    { key: 'confirmed', label: '报销' },
    { key: 'reimbursed', label: '完成' },
  ],
  // 预付：草稿 → 审批 → 预付 → 收货 → 确认 → 核销 → 完成
  prepay: [
    { key: 'draft', label: '草稿' },
    { key: 'pending_approval', label: '审批' },
    { key: 'prepay', label: '预付' },
    { key: 'approved', label: '收货' },
    { key: 'received', label: '确认' },
    { key: 'confirmed', label: '核销' },
    { key: 'reimbursed', label: '完成' },
  ],
  // 月结：草稿 → 审批 → 收货 → 确认 → 月结 → 完成
  monthly: [
    { key: 'draft', label: '草稿' },
    { key: 'pending_approval', label: '审批' },
    { key: 'approved', label: '收货' },
    { key: 'received', label: '确认' },
    { key: 'confirmed', label: '月结' },
    { key: 'reimbursed', label: '完成' },
  ],
};

interface Props {
  status: string;
  purchaseType?: string;
  prepayStatus?: string;
  writeoffStatus?: string;
}

// 计算当前所处的节点索引
function getCurrentIndex(status: string, purchaseType: string, prepayStatus?: string, writeoffStatus?: string): number {
  const nodes = FLOW_NODES[purchaseType] || FLOW_NODES.normal;

  // 预付采购特殊处理
  if (purchaseType === 'prepay') {
    // 预付审批通过后，进入收货阶段（approved）
    if (status === 'approved') {
      // 如果预付审批已通过，说明已经过了预付节点
      if (prepayStatus === 'approved' || prepayStatus === 'paid') {
        return nodes.findIndex((n) => n.key === 'approved');
      }
      // 预付审批尚未发起或进行中，停留在预付节点
      return nodes.findIndex((n) => n.key === 'prepay');
    }
  }

  // 根据状态匹配节点
  const statusMap: Record<string, string> = {
    draft: 'draft',
    rejected: 'draft', // 驳回回到草稿
    cancelled: 'draft',
    pending_approval: 'pending_approval',
    received: 'received',
    confirming: 'received', // 确认中视同收货阶段
    confirmed: 'confirmed',
    reimbursing: 'confirmed', // 报销中视同已确认阶段
    reimbursed: 'reimbursed',
  };

  const nodeKey = statusMap[status] || 'draft';
  return nodes.findIndex((n) => n.key === nodeKey);
}

// 判断节点是否已完成
function isNodeCompleted(nodeIndex: number, currentIndex: number): boolean {
  return nodeIndex < currentIndex;
}

// 判断是否是当前节点
function isCurrentNode(nodeIndex: number, currentIndex: number): boolean {
  return nodeIndex === currentIndex;
}

export default function WarehousePurchaseProgress({ status, purchaseType = 'normal', prepayStatus, writeoffStatus }: Props) {
  const nodes = FLOW_NODES[purchaseType] || FLOW_NODES.normal;
  const currentIndex = getCurrentIndex(status, purchaseType, prepayStatus, writeoffStatus);

  // 预付核销完成（writeoff_status = auto）且已报销，标记为完成
  const isFullyDone = status === 'reimbursed';

  return (
    <div className="flex items-center w-full mt-2 px-1">
      {nodes.map((node, idx) => {
        const completed = isFullyDone ? true : isNodeCompleted(idx, currentIndex);
        const current = isCurrentNode(idx, currentIndex) && !isFullyDone;
        const isLast = idx === nodes.length - 1;

        return (
          <div key={node.key} className="flex items-center flex-1 last:flex-none">
            {/* 圆点 */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border ${
                  completed
                    ? 'bg-green-500 border-green-500 text-white'
                    : current
                    ? 'bg-blue-500 border-blue-500 text-white animate-pulse'
                    : 'bg-gray-100 border-gray-300 text-gray-400'
                }`}
              >
                {completed ? <Check size={11} strokeWidth={3} /> : idx + 1}
              </div>
              <span
                className={`mt-0.5 text-[10px] leading-tight whitespace-nowrap ${
                  completed ? 'text-green-600' : current ? 'text-blue-600 font-medium' : 'text-gray-400'
                }`}
              >
                {node.label}
              </span>
            </div>
            {/* 连线 */}
            {!isLast && (
              <div className={`flex-1 h-0.5 mx-1 mb-3 ${completed ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
