/**
 * 费用支付监控（占位页面 - 第一阶段）
 *
 * 第一阶段：仅建立菜单分类、菜单项、权限分配骨架
 * 第二阶段：实现企微"费用支付申请"审批历史同步落库 + 列表查询 + 状态刷新
 *
 * 监控范围：企业微信审批模板"费用支付申请"
 * 数据来源策略（第二阶段）：
 *   1. 首次全量同步：后台任务按 30 天切片串行拉取企微 oa/getapprovalinfo + oa/getapprovaldetail 落库
 *   2. 增量同步：定时任务每小时拉取上次同步后的新增审批
 *   3. 页面查询：查本地表，毫秒级响应，无企微调用
 *   4. 状态刷新：对本地"非终态"审批按需串行调 getApprovalDetail 刷新（参照 refreshApprovalStatusCore 模式）
 */

import { useAuthStore } from '@/store/authStore';

export default function ExpensePaymentMonitor() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        {/* 页头 */}
        <div className="mb-6 flex items-center gap-3">
          <span className="text-3xl">👁️</span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
              费用支付监控
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              读取企业微信"费用支付申请"审批历史进行监控
            </p>
          </div>
        </div>

        {/* 建设中提示卡片 */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="text-4xl">🚧</span>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-amber-900">
                功能建设中
              </h2>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                该页面为第一阶段占位，仅完成菜单分类与权限分配骨架。
              </p>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                第二阶段将实现：
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                <li>• 首次全量同步企微审批历史到本地表（按 30 天切片串行拉取）</li>
                <li>• 定时增量同步新增审批单</li>
                <li>• 列表查询（毫秒级响应，无企微调用）</li>
                <li>• 非终态审批按需状态刷新（串行避免 45009 限流）</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 监控范围说明 */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">
            监控范围
          </h3>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">审批模板</dt>
              <dd className="mt-1 text-gray-900">费用支付申请</dd>
            </div>
            <div>
              <dt className="text-gray-500">数据来源</dt>
              <dd className="mt-1 text-gray-900">企业微信审批 OpenAPI</dd>
            </div>
            <div>
              <dt className="text-gray-500">涉及接口</dt>
              <dd className="mt-1 text-gray-900">
                oa/getapprovalinfo（列表）<br />
                oa/getapprovaldetail（详情）
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">当前用户</dt>
              <dd className="mt-1 text-gray-900">{user?.name || '-'}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
