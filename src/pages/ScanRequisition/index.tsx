import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Plus, Minus, Check, ShoppingCart, AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

// 会话存储
const SCAN_SESSION_KEY = 'scan_requisition_session';

interface ScanSession {
  token: string;
  user: { id: string; name: string; phone: string };
  has_bound_warehouse: boolean;
  bound_warehouses: { id: string; name: string }[];
}

interface InventoryItem {
  item_id: string;
  warehouse_id: string;
  item_name: string;
  sku: string;
  quantity: number;
  unit: string;
  reference_price: number;
  category_name: string;
  instant_use: boolean;
}

interface CartItem extends InventoryItem {
  cartQty: number;
}

interface Warehouse {
  id: string;
  name: string;
  department_name?: string;
}

function getSession(): ScanSession | null {
  try {
    const s = localStorage.getItem(SCAN_SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function saveSession(s: ScanSession) { localStorage.setItem(SCAN_SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SCAN_SESSION_KEY); }

export default function ScanRequisition() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState<ScanSession | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // 数据
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [outboundWarehouse, setOutboundWarehouse] = useState<{ id: string; name: string } | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [resultSuccess, setResultSuccess] = useState(false);

  // 从 URL 读取仓库 ID（扫码二维码对应的出库仓库，物资从这里出）
  const whFromUrl = searchParams.get('wh') || '';

  // ================================================
  // 初始化
  // ================================================
  const initLogin = useCallback(async () => {
    try {
      // 优先从 URL 参数恢复 session
      const token = searchParams.get('token');
      if (token) {
        // 尝试用 token 拉取信息
        const res = await fetch(`${api.getBaseUrl()}/scan-requisition/my-warehouses`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const myWhs = await res.json();
          // 用 token 做 wx-login 的替代：直接用 session
          const stored = getSession();
          if (stored && stored.token === token) {
            setSession(stored);
            // 始终拉取物资（设置出库仓库 + 物资列表）；未绑定额外拉入库仓库列表
            await fetchItems(token);
            if (!stored.has_bound_warehouse) {
              await fetchWarehouses(token);
            }
            setLoading(false);
            return;
          }
        }
      }

      // 检查本地 session
      const stored = getSession();
      if (stored) {
        // 从后端刷新绑定状态（审核通过后可能已变化）
        let refreshed = stored;
        try {
          const whRes = await fetch(`${api.getBaseUrl()}/scan-requisition/my-warehouses`, {
            headers: { 'Authorization': `Bearer ${stored.token}` }
          });
          if (whRes.ok) {
            const myWhs = await whRes.json();
            const bound = Array.isArray(myWhs) && myWhs.length > 0;
            if (bound !== stored.has_bound_warehouse) {
              refreshed = {
                ...stored,
                has_bound_warehouse: bound,
                bound_warehouses: Array.isArray(myWhs) ? myWhs : [],
              };
              saveSession(refreshed);
            }
          }
        } catch { /* 刷新失败不影响主流程 */ }

        setSession(refreshed);
        // 始终拉取物资（设置出库仓库 + 物资列表）；未绑定额外拉入库仓库列表
        await fetchItems(refreshed.token);
        if (!refreshed.has_bound_warehouse) {
          await fetchWarehouses(refreshed.token);
        }
        setLoading(false);
        return;
      }

      // 微信授权流程
      await handleWechatAuth();
    } catch (err: any) {
      console.error('初始化失败:', err);
      setError(err.message || '初始化失败');
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => { initLogin(); }, [initLogin]);

  // ================================================
  // 微信授权
  // ================================================
  const handleWechatAuth = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const whFromUrl = urlParams.get('wh') || '';

    if (!code) {
      // 获取 appid 并跳转授权
      try {
        const configRes = await api.get<{ app_id: string }>('/scan-requisition/config');
        const appId = configRes.app_id;
        if (!appId) { setError('微信配置未初始化'); setLoading(false); return; }

        // redirect_uri 保留 wh 参数，授权回跳后仍能定位到对应仓库
        const redirectPath = whFromUrl
          ? `${window.location.origin}/scan-requisition?wh=${whFromUrl}`
          : `${window.location.origin}/scan-requisition`;
        const redirectUri = encodeURIComponent(redirectPath);
        const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=${Date.now()}#wechat_redirect`;
        window.location.href = authUrl;
      } catch (err: any) {
        setError(err.message || '获取微信配置失败');
        setLoading(false);
      }
      return;
    }

    // 用 code 换 token
    try {
      const res = await api.post<any>('/scan-requisition/wx-login', { code });
      if (!res.success) { setError(res.error || '登录失败'); setLoading(false); return; }

      const newSession: ScanSession = {
        token: res.token,
        user: res.user,
        has_bound_warehouse: res.has_bound_warehouse,
        bound_warehouses: res.bound_warehouses || [],
      };
      saveSession(newSession);
      setSession(newSession);

      // 清除 URL 中的 code
      searchParams.delete('code');
      searchParams.delete('state');
      setSearchParams(searchParams, { replace: true });

      // 始终拉取物资（设置出库仓库 + 物资列表）；未绑定额外拉入库仓库列表
      await fetchItems(res.token);
      if (res.is_new_user) {
        setShowRegister(true);
        setLoading(false);
      } else if (!res.has_bound_warehouse) {
        await fetchWarehouses(res.token);
      }
    } catch (err: any) {
      setError(err.message || '微信登录失败');
      setLoading(false);
    }
  };

  // ================================================
  // 数据获取
  // ================================================
  const fetchItems = async (token: string) => {
    try {
      const url = whFromUrl
        ? `${api.getBaseUrl()}/scan-requisition/items?wh=${encodeURIComponent(whFromUrl)}`
        : `${api.getBaseUrl()}/scan-requisition/items`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.items) {
        setItems(data.items);
      }
      if (data.warehouse) {
        setOutboundWarehouse({ id: data.warehouse.id, name: data.warehouse.name });
      }
    } catch (err: any) {
      setError(err.message || '获取物资列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchWarehouses = async (token: string) => {
    try {
      const res = await fetch(`${api.getBaseUrl()}/scan-requisition/warehouses`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setWarehouses(data);
      // 注意：wh 参数是出库仓库（物资来源），不预选为入库仓库；入库仓库由用户选择或绑定
    } catch (err: any) {
      setError(err.message || '获取仓库列表失败');
    } finally {
      setLoading(false);
    }
  };

  // ================================================
  // 注册
  // ================================================
  const handleRegister = async () => {
    if (!name.trim()) { setError('请输入姓名'); return; }
    if (!session) { setError('登录状态失效'); return; }

    try {
      const res = await fetch(`${api.getBaseUrl()}/scan-requisition/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '注册失败'); }

      const updated = { ...session, user: { ...session.user, name: name.trim(), phone: phone.trim() } };
      saveSession(updated);
      setSession(updated);
      setShowRegister(false);
      // 注册后同时拉取出库仓库物资 + 入库仓库列表（供选择）
      await Promise.all([fetchItems(updated.token), fetchWarehouses(updated.token)]);
    } catch (err: any) { setError(err.message); }
  };

  // ================================================
  // 购物车操作
  // ================================================
  const addToCart = (item: InventoryItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.item_id === item.item_id);
      if (existing) {
        return prev.map(c => c.item_id === item.item_id ? { ...c, cartQty: c.cartQty + 1 } : c);
      }
      return [...prev, { ...item, cartQty: 1 }];
    });
  };

  const updateCartQty = (itemId: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.item_id !== itemId) return c;
      const newQty = c.cartQty + delta;
      return { ...c, cartQty: Math.max(0, Math.min(newQty, c.quantity)) };
    }).filter(c => c.cartQty > 0));
  };

  const setCartQty = (itemId: string, qty: number) => {
    setCart(prev => {
      const item = items.find(i => i.item_id === itemId);
      if (!item) return prev;
      const clamped = Math.max(0, Math.min(qty, item.quantity));
      if (clamped === 0) return prev.filter(c => c.item_id !== itemId);
      const existing = prev.find(c => c.item_id === itemId);
      if (existing) return prev.map(c => c.item_id === itemId ? { ...c, cartQty: clamped } : c);
      return [...prev, { ...item, cartQty: clamped }];
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => prev.filter(c => c.item_id !== itemId));
  };

  // ================================================
  // 提交领料
  // ================================================
  const handleSubmit = async () => {
    if (cart.length === 0) { setError('请至少选择一项物资'); return; }
    if (!session) { setError('登录状态失效'); return; }

    if (!session.has_bound_warehouse && !selectedWarehouse) {
      setError('请选择入库仓库（领料部门）'); return;
    }

    setSubmitting(true);
    setError('');
    try {
      const payload = {
        items: cart.map(c => ({
          item_id: c.item_id,
          item_name: c.item_name,
          quantity: c.cartQty,
          unit: c.unit,
          unit_price: c.reference_price,
        })),
        // warehouse_id = 出库仓库（扫码二维码对应仓库，物资从这里出）
        warehouse_id: outboundWarehouse?.id || whFromUrl || '',
        warehouse_name: outboundWarehouse?.name || '',
        // inbound_warehouse_id = 入库仓库（领料目标部门仓库，物资入到这里）
        inbound_warehouse_id: selectedWarehouse,
        inbound_warehouse_name: warehouses.find(w => w.id === selectedWarehouse)?.name || '',
      };

      const res = await fetch(`${api.getBaseUrl()}/scan-requisition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { throw new Error(data.error || '提交失败'); }

      setResultSuccess(true);
      setResultMsg(data.message || '领料成功');
      setCart([]);

      // 如果首次绑定成功，更新 session
      if (data.status === 'auto' && !session.has_bound_warehouse) {
        const updated = { ...session, has_bound_warehouse: true };
        saveSession(updated);
        setSession(updated);
      }

      // 刷新库存列表
      await fetchItems(session.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ================================================
  // 渲染
  // ================================================
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500 font-medium">正在通过微信登录...</p>
        </div>
      </div>
    );
  }

  if (showRegister) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-block w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-3xl shadow-lg flex items-center justify-center mb-4">
              <Package className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">完善信息</h1>
            <p className="text-gray-500 text-sm mt-1">首次使用，请输入您的姓名和手机号</p>
          </div>
          {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm text-center">{error}</div>}
          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                placeholder="请输入您的姓名" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                placeholder="请输入手机号（选填）" />
            </div>
            <button onClick={handleRegister}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform">
              确认提交
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (resultSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-block w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">{resultMsg}</h2>
          <button onClick={() => { setResultSuccess(false); setResultMsg(''); }}
            className="mt-6 px-8 py-3 bg-blue-500 text-white rounded-xl font-medium active:scale-95 transition-transform">
            继续领料
          </button>
        </div>
      </div>
    );
  }

  // 主界面
  const filteredItems = items.filter(item =>
    !searchKeyword || item.item_name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  // 按分类分组
  const groupedItems = filteredItems.reduce((acc, item) => {
    const cat = item.category_name || '未分类';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);

  const cartTotal = cart.reduce((sum, c) => sum + c.cartQty * c.reference_price, 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* 顶部 */}
      <div className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-4 py-3 sticky top-0 z-20 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            <span className="font-bold text-base">
              {outboundWarehouse ? `${outboundWarehouse.name} · 领料` : '扫码领料'}
            </span>
          </div>
          <div className="text-xs">
            <span className="font-medium">{session?.user.name}</span>
            {session?.user.phone && <span className="ml-2 opacity-75">{session.user.phone}</span>}
          </div>
        </div>
        <div className="mt-0.5 text-[11px] opacity-80">
          {outboundWarehouse
            ? `从「${outboundWarehouse.name}」出库`
            : '微信扫码领料'}
          {session?.has_bound_warehouse && session.bound_warehouses.length > 0 && (
            <span className="ml-2">· 入库至：{session.bound_warehouses.map(w => w.name).join('、')}</span>
          )}
        </div>
      </div>

      {/* 首次选择入库仓库（领料部门） */}
      {!session?.has_bound_warehouse && warehouses.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <label className="block text-sm font-medium text-amber-800 mb-1">选择入库仓库（领料部门，首次需审核）</label>
          <select value={selectedWarehouse} onChange={(e) => setSelectedWarehouse(e.target.value)}
            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20">
            <option value="">请选择入库部门仓库...</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}{w.department_name ? `（${w.department_name}）` : ''}</option>
            ))}
          </select>
          {outboundWarehouse && (
            <p className="text-xs text-amber-600 mt-1">物资将从「{outboundWarehouse.name}」出库到所选部门仓库</p>
          )}
        </div>
      )}

      {/* 搜索 */}
      {items.length > 0 && (
        <div className="px-4 py-3 bg-white border-b">
          <input type="text" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索物资名称..."
            className="w-full px-4 py-2 bg-gray-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        </div>
      )}

      {/* 物资列表（按分类分组） */}
      <div className="px-4 py-3">
        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>暂无可领用物资</p>
          </div>
        ) : (
          Object.entries(groupedItems).map(([cat, catItems]) => (
            <div key={cat} className="mb-4">
              <div className="text-[11px] font-medium text-gray-400 px-1 mb-1.5">{cat}</div>
              <div className="space-y-1.5">
                {catItems.map(item => {
                  const inCart = cart.find(c => c.item_id === item.item_id);
                  const lowStock = item.quantity <= 5;
                  return (
                    <div key={item.item_id} className={`bg-white rounded-xl p-2.5 shadow-sm flex items-center justify-between ${item.instant_use ? 'border-l-3 border-l-orange-400' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{item.item_name}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2">
                          <span className={lowStock ? 'text-red-500 font-medium' : ''}>库存: {item.quantity} {item.unit}</span>
                          {item.reference_price > 0 && <span>¥{item.reference_price.toFixed(2)}/{item.unit}</span>}
                          {item.instant_use && <span className="text-orange-500">即采即用</span>}
                        </div>
                      </div>
                      {inCart ? (
                        <div className="flex items-center gap-2 ml-3">
                          <button onClick={() => updateCartQty(item.item_id, -1)}
                            className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center active:scale-90 transition-transform">
                            <Minus className="w-3.5 h-3.5 text-gray-600" />
                          </button>
                          <input type="number" value={inCart.cartQty}
                            onChange={(e) => setCartQty(item.item_id, parseInt(e.target.value) || 0)}
                            className="w-12 text-center text-xs border border-gray-200 rounded-lg py-1" />
                          <button onClick={() => updateCartQty(item.item_id, 1)}
                            className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center active:scale-90 transition-transform"
                            disabled={inCart.cartQty >= item.quantity}>
                            <Plus className="w-3.5 h-3.5 text-white" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => addToCart(item)}
                          className="ml-3 px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium active:scale-95 transition-transform">
                          + 领用
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部领料清单栏 */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-30">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm">
                <ShoppingCart className="w-4 h-4 text-blue-500" />
                <span className="font-medium">领料清单 ({cart.length})</span>
                <span className="text-gray-400">合计：¥{cartTotal.toFixed(2)}</span>
              </div>
              <button onClick={() => setCart([])} className="text-xs text-gray-400">清空</button>
            </div>
            {/* 清单明细 */}
            <div className="max-h-24 overflow-y-auto mb-2">
              {cart.map(c => (
                <div key={c.item_id} className="flex items-center justify-between text-xs py-1">
                  <span className="text-gray-600">{c.item_name}</span>
                  <span className="text-gray-500">×{c.cartQty} {c.unit}</span>
                </div>
              ))}
            </div>
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-50">
              {submitting ? '提交中...' : session?.has_bound_warehouse ? '确认领料' : '提交领料（需审核）'}
            </button>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-50 text-red-600 px-4 py-2 rounded-lg shadow-lg text-sm z-50 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button onClick={() => setError('')} className="ml-2">×</button>
        </div>
      )}
    </div>
  );
}
