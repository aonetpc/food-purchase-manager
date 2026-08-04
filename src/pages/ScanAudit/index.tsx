import { useState, useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Check,
  X,
  Clock,
  Package,
  User,
  Phone,
  Calendar,
  ChevronRight,
  QrCode,
  Copy,
  Download,
  Printer,
  Link as LinkIcon,
} from 'lucide-react';
import { api } from '@/lib/api';

interface RequisitionItem {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
}

interface Requisition {
  id: string;
  requisition_no: string;
  temp_user_id: string;
  user_name: string;
  user_phone: string;
  warehouse_id: string;
  warehouse_name: string;
  outbound_warehouse_id?: string;
  outbound_warehouse_name?: string;
  items: RequisitionItem[];
  status: 'pending' | 'approved' | 'rejected' | 'auto';
  auditor_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

interface Warehouse {
  id: string;
  name: string;
  department_name?: string;
  type?: 'main' | 'dept';
  status?: number;
}

const statusConfig = {
  pending: { label: '待审核', color: 'bg-amber-100 text-amber-700', icon: Clock },
  approved: { label: '已通过', color: 'bg-green-100 text-green-700', icon: Check },
  rejected: { label: '已驳回', color: 'bg-red-100 text-red-700', icon: X },
  auto: { label: '自动出库', color: 'bg-blue-100 text-blue-700', icon: Package },
};

export default function ScanAudit() {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [selected, setSelected] = useState<Requisition | null>(null);
  const [approveWarehouse, setApproveWarehouse] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState('');

  // 扫码入口相关
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [copiedId, setCopiedId] = useState<string>('');
  const qrRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  // 扫码入口 URL（按仓库维度）
  const scanBaseUrl = window.location.origin + '/scan-requisition';
  const buildScanUrl = (whId?: string) => (whId ? `${scanBaseUrl}?wh=${whId}` : scanBaseUrl);

  useEffect(() => {
    fetchList();
    fetchWarehouses();
  }, [filterStatus]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Requisition[]; total: number }>('/scan-requisition/pending', {
        params: { status: filterStatus, pageSize: 100 },
      });
      setRequisitions(res.data || []);
    } catch (err: any) {
      setError(err.message || '获取列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await api.get<Warehouse[]>('/warehouses');
      // 保留全部启用仓库（含总仓，用于二维码面板）；审核弹窗选入库仓库时再用 type='dept' 过滤
      setWarehouses(res.filter((w: any) => w.status === 1));
    } catch {}
  };

  const handleApprove = async () => {
    if (!selected) return;
    if (!approveWarehouse) { setError('请选择入库仓库（领料部门）'); return; }
    setActioning(true);
    setError('');
    try {
      await api.post(`/scan-requisition/${selected.id}/approve`, { inbound_warehouse_id: approveWarehouse });
      setSelected(null);
      setApproveWarehouse('');
      await fetchList();
    } catch (err: any) {
      setError(err.message || '审核失败');
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActioning(true);
    setError('');
    try {
      await api.post(`/scan-requisition/${selected.id}/reject`, { reason: rejectReason });
      setSelected(null);
      setRejectReason('');
      await fetchList();
    } catch (err: any) {
      setError(err.message || '驳回失败');
    } finally {
      setActioning(false);
    }
  };

  const formatTime = (str: string) => {
    if (!str) return '-';
    const d = new Date(str);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const calcTotal = (items: RequisitionItem[]) =>
    items.reduce((sum, i) => sum + i.quantity * (i.unit_price || 0), 0);

  // 复制 URL 到剪贴板
  const handleCopyUrl = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(''), 1500);
    } catch {
      // 降级方案
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(''), 1500);
    }
  };

  // 下载某个仓库的二维码 PNG
  const handleDownloadQr = (wh: Warehouse) => {
    const url = buildScanUrl(wh.id);
    const canvas = qrRefs.current[wh.id];
    if (!canvas) return;
    // 加白底 + 文字
    const out = document.createElement('canvas');
    const pad = 40;
    const titleH = 80;
    const subH = 40;
    out.width = canvas.width + pad * 2;
    out.height = canvas.height + pad * 2 + titleH + subH;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    // 标题
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${wh.name} · 扫码领料`, out.width / 2, pad + 30);
    // 二维码
    ctx.drawImage(canvas, pad, pad + titleH);
    // 副标题
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.fillText('微信扫一扫，进入领料页面', out.width / 2, out.height - 15);

    const link = document.createElement('a');
    link.download = `扫码领料_${wh.name}.png`;
    link.href = out.toDataURL('image/png');
    link.click();
  };

  // 打印所有仓库二维码（A4 一页）
  const handlePrintAll = () => {
    const printWin = window.open('', '_blank');
    if (!printWin) return;
    const items = warehouses.map((w) => {
      const url = buildScanUrl(w.id);
      // 直接用已渲染的 ref canvas 转图
      const src = qrRefs.current[w.id]?.toDataURL('image/png') || '';
      return { name: w.name, url, src };
    });
    printWin.document.write(`
      <html>
      <head>
        <title>扫码领料二维码汇总</title>
        <style>
          body { font-family: -apple-system, "PingFang SC", sans-serif; padding: 24px; }
          h1 { text-align: center; font-size: 20px; margin-bottom: 6px; }
          .sub { text-align: center; color: #888; font-size: 12px; margin-bottom: 20px; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
          .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; text-align: center; page-break-inside: avoid; }
          .card img { width: 160px; height: 160px; }
          .wh-name { font-size: 14px; font-weight: 600; margin-top: 8px; color: #1f2937; }
          .wh-url { font-size: 10px; color: #9ca3af; margin-top: 2px; word-break: break-all; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <h1>扫码领料二维码</h1>
        <div class="sub">微信扫一扫 · 进入对应仓库领料页面 · 首次使用需审核绑定</div>
        <div class="grid">
          ${items.map(it => `
            <div class="card">
              <img src="${it.src}" alt="${it.name}" />
              <div class="wh-name">${it.name}</div>
              <div class="wh-url">${it.url}</div>
            </div>
          `).join('')}
        </div>
        <div class="no-print" style="text-align:center;margin-top:20px;">
          <button onclick="window.print()" style="padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;">打印此页</button>
        </div>
      </body>
      </html>
    `);
    printWin.document.close();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">领料审核</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowQrPanel(!showQrPanel)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              showQrPanel ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <QrCode size={16} /> 扫码入口
          </button>
          {(['pending', 'approved', 'rejected', 'auto', 'all'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterStatus === s ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {s === 'all' ? '全部' : statusConfig[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* 扫码入口面板 */}
      {showQrPanel && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <QrCode size={16} className="text-green-600" /> 扫码领料入口（按仓库生成）
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                打印贴在各仓库门口 · 微信扫码后自动选中该仓库 · 首次使用需审核绑定
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrintAll}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 flex items-center gap-1"
              >
                <Printer size={14} /> 打印全部
              </button>
              <button
                onClick={() => handleCopyUrl(scanBaseUrl, 'base')}
                className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 flex items-center gap-1"
              >
                {copiedId === 'base' ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === 'base' ? '已复制' : '复制通用入口'}
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-500 mb-3 break-all bg-gray-50 p-2 rounded">
            <LinkIcon size={12} className="inline mr-1" />
            通用入口：{scanBaseUrl}
          </div>
          {warehouses.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">暂无仓库，请先在仓库管理中创建</div>
          ) : (
            <>
              {/* 总仓单独置顶大卡片（最常用） */}
              {warehouses.filter(w => w.type === 'main').map(wh => {
                const url = buildScanUrl(wh.id);
                return (
                  <div key={wh.id} className="mb-3 border-2 border-green-300 bg-green-50/40 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex-shrink-0">
                      <QRCodeCanvas
                        value={url}
                        size={180}
                        ref={(el: any) => { qrRefs.current[wh.id] = el?.getCanvas?.() || el; }}
                        includeMargin
                      />
                    </div>
                    <div className="flex-1 text-center sm:text-left">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-500 text-white rounded-full text-xs font-medium mb-1">
                        <Package size={12} /> 总仓 · 最常用
                      </div>
                      <div className="text-lg font-bold text-gray-800">{wh.name}</div>
                      <p className="text-xs text-gray-500 mt-1">各仓库常来总仓扫码领料，建议打印贴在总仓门口</p>
                      <div className="flex gap-2 mt-2 justify-center sm:justify-start">
                        <button
                          onClick={() => handleDownloadQr(wh)}
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 flex items-center gap-1"
                        >
                          <Download size={13} /> 下载 PNG
                        </button>
                        <button
                          onClick={() => handleCopyUrl(url, wh.id)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 flex items-center gap-1"
                        >
                          {copiedId === wh.id ? <Check size={13} /> : <Copy size={13} />}
                          {copiedId === wh.id ? '已复制' : '复制链接'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 部门仓库二维码网格 */}
              {warehouses.filter(w => w.type !== 'main').length > 0 && (
                <>
                  <div className="text-xs font-medium text-gray-500 mb-2 mt-1">部门仓库</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {warehouses.filter(w => w.type !== 'main').map(wh => {
                      const url = buildScanUrl(wh.id);
                      return (
                        <div key={wh.id} className="border border-gray-200 rounded-lg p-3 text-center hover:shadow-sm transition-shadow">
                          <div className="flex justify-center mb-2">
                            <QRCodeCanvas
                              value={url}
                              size={140}
                              ref={(el: any) => { qrRefs.current[wh.id] = el?.getCanvas?.() || el; }}
                              includeMargin
                            />
                          </div>
                          <div className="text-sm font-semibold text-gray-800">{wh.name}</div>
                          {wh.department_name && (
                            <div className="text-[10px] text-gray-400 mt-0.5">{wh.department_name}</div>
                          )}
                          <div className="flex gap-1 mt-2 justify-center">
                            <button
                              onClick={() => handleDownloadQr(wh)}
                              className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-[10px] hover:bg-gray-200 flex items-center gap-0.5"
                              title="下载二维码 PNG"
                            >
                              <Download size={11} /> PNG
                            </button>
                            <button
                              onClick={() => handleCopyUrl(url, wh.id)}
                              className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-[10px] hover:bg-blue-100 flex items-center gap-0.5"
                              title="复制链接"
                            >
                              {copiedId === wh.id ? <Check size={11} /> : <Copy size={11} />}
                              {copiedId === wh.id ? '已复制' : '链接'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* 列表 */}
      <div className="grid gap-3">
        {loading ? (
          <div className="text-center py-16 text-gray-400">加载中...</div>
        ) : requisitions.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>暂无领料记录</p>
          </div>
        ) : (
          requisitions.map(req => {
            const sc = statusConfig[req.status];
            const Icon = sc.icon;
            const total = calcTotal(req.items);
            return (
              <div key={req.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-sm text-gray-500">{req.requisition_no}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                        <Icon className="w-3 h-3 inline mr-1" />{sc.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{req.user_name}</span>
                      {req.user_phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{req.user_phone}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatTime(req.created_at)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {req.items.map((item, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 rounded text-xs text-gray-600">
                          {item.item_name} ×{item.quantity}{item.unit}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="text-gray-400">合计：</span>
                      <span className="font-semibold text-gray-800">¥{total.toFixed(2)}</span>
                      {req.warehouse_name && <span className="ml-3 text-gray-400">仓库：{req.warehouse_name}</span>}
                    </div>
                    {req.status === 'approved' && req.auditor_name && (
                      <div className="mt-1 text-xs text-gray-400">审核人：{req.auditor_name} · {formatTime(req.approved_at || '')}</div>
                    )}
                    {req.status === 'rejected' && req.reject_reason && (
                      <div className="mt-1 text-xs text-red-400">驳回原因：{req.reject_reason}</div>
                    )}
                  </div>
                  {req.status === 'pending' && (
                    <button onClick={() => { setSelected(req); setApproveWarehouse(req.warehouse_id || ''); setRejectReason(''); }}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 active:scale-95 transition-all flex items-center gap-1">
                      审核 <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 审核弹窗 */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800">领料审核</h2>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>

              {/* 领料人信息 */}
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-400">领料人：</span><span className="font-medium">{selected.user_name}</span></div>
                  <div><span className="text-gray-400">手机号：</span>{selected.user_phone || '-'}</div>
                  <div><span className="text-gray-400">编号：</span>{selected.requisition_no}</div>
                  <div><span className="text-gray-400">时间：</span>{formatTime(selected.created_at)}</div>
                </div>
              </div>

              {/* 物资清单 */}
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">物资清单</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left">物资名称</th>
                        <th className="px-3 py-2 text-right">数量</th>
                        <th className="px-3 py-2 text-right">单价</th>
                        <th className="px-3 py-2 text-right">金额</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selected.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-gray-700">{item.item_name}</td>
                          <td className="px-3 py-2 text-right">{item.quantity} {item.unit}</td>
                          <td className="px-3 py-2 text-right">¥{(item.unit_price || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">¥{(item.quantity * (item.unit_price || 0)).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right text-gray-500">合计</td>
                        <td className="px-3 py-2 text-right font-bold">¥{calcTotal(selected.items).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* 出库仓库（只读，扫码时确定） */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">出库仓库（扫码来源）</label>
                <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                  {selected.outbound_warehouse_name || selected.warehouse_name || '未指定'}
                </div>
                <p className="text-xs text-gray-400 mt-1">物资从此仓库出库扣减库存（领料人扫码时确定）</p>
              </div>

              {/* 入库仓库选择（领料部门） */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">入库仓库（领料部门） <span className="text-red-500">*</span></label>
                <select value={approveWarehouse} onChange={e => setApproveWarehouse(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                  <option value="">请选择入库部门仓库...</option>
                  {warehouses.filter(w => w.type !== 'main').map(w => (
                    <option key={w.id} value={w.id}>{w.name}{w.department_name ? `（${w.department_name}）` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">审核通过后将绑定该入库仓库给领料人，后续扫码免审核</p>
              </div>

              {/* 驳回原因 */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">驳回原因（选填）</label>
                <input type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  placeholder="如需驳回，请填写原因"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20" />
              </div>

              {error && <div className="mb-3 p-2 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

              {/* 操作按钮 */}
              <div className="flex gap-3">
                <button onClick={handleApprove} disabled={actioning || !approveWarehouse}
                  className="flex-1 py-2.5 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                  <Check className="w-4 h-4" /> 审核通过
                </button>
                <button onClick={handleReject} disabled={actioning}
                  className="flex-1 py-2.5 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1">
                  <X className="w-4 h-4" /> 驳回
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
