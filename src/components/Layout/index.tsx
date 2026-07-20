import { useState, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  TrendingUp,
  BarChart3,
  Search,
  UtensilsCrossed,
  Menu,
  X,
  ClipboardList,
  Tags,
  Package,
  LogOut,
  ChevronDown,
  Building2,
  User,
  Users,
  Receipt,
  Settings,
  Truck,
  PlusCircle,
  Calendar,
  Smartphone,
} from 'lucide-react';
import { useAuthStore, type MenuItem } from '@/store/authStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { formatCurrency } from '@/utils/format';
import { formatDate } from '@/utils/date';

const iconMap: Record<string, any> = {
  ShoppingCart,
  TrendingUp,
  BarChart3,
  Search,
  ClipboardList,
  Tags,
  Package,
  Building2,
  Receipt,
  Settings,
  Truck,
  PlusCircle,
  Calendar,
  Smartphone,
};

export default function Layout() {
  const navigate = useNavigate();
  const { user, isAdmin, canViewMonthly, logout, getUserMenus } = useAuthStore();
  const { fetchRecords, records, fetchLastMonthAveragePrices, getComparePrice } = usePurchaseStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = formatDate(today);

  useEffect(() => {
    fetchRecords(todayKey);
    fetchLastMonthAveragePrices();
    const timer = setInterval(() => {
      fetchRecords(todayKey);
    }, 60000);
    return () => clearInterval(timer);
  }, [fetchRecords, fetchLastMonthAveragePrices, todayKey]);

  const todayItems = records[todayKey] || [];
  const totalAmount = todayItems.reduce((sum, item) => sum + item.amount, 0);
  
  const calculateRate = (item: typeof todayItems[0]) => {
    const compare = getComparePrice(item);
    if (!compare) return { rate: 0, source: null };
    return { 
      rate: ((item.purchaseUnitPrice - compare.price) / compare.price * 100),
      source: compare.source
    };
  };

  const priceChanges = todayItems.map(item => ({ 
    item, 
    ...calculateRate(item) 
  })).filter(r => r.source !== null);
  
  const maxIncrease = priceChanges.length > 0 
    ? [...priceChanges].sort((a, b) => b.rate - a.rate)[0]
    : null;
  const maxDecrease = priceChanges.length > 0
    ? [...priceChanges].sort((a, b) => a.rate - b.rate)[0]
    : null;

  const navItems = useMemo(() => {
    const menus = getUserMenus();
    return menus.filter(m => !m.path.startsWith('/m/'));
  }, [getUserMenus]);

  const adminNavItems = useMemo(() => {
    const menus = getUserMenus();
    return menus.filter(m => 
      ['/purchase-entry', '/departments', '/categories', '/ingredient-manager', '/reimbursement', '/wecom', '/users'].includes(m.path)
    );
  }, [getUserMenus]);

  const visibleNavItems = useMemo(() => {
    const userMenus = getUserMenus();
    const pcMenus = userMenus.filter(m => !m.path.startsWith('/m/'));
    
    const order = ['/daily', '/monthly', '/yearly', '/query', '/purchase-entry', '/reimbursement', '/users', '/categories', '/ingredient-manager', '/departments', '/suppliers', '/wecom'];
    
    return pcMenus.sort((a, b) => {
      const aIdx = order.indexOf(a.path) >= 0 ? order.indexOf(a.path) : 100;
      const bIdx = order.indexOf(b.path) >= 0 ? order.indexOf(b.path) : 100;
      return aIdx - bIdx;
    });
  }, [getUserMenus]);

  const handlePrint = () => {
    window.print();
  };

  const handleLogout = () => {
    logout();
    setUserMenuOpen(false);
    navigate('/login');
  };

  const handleLoginClick = () => {
    navigate('/login');
  };

  const getIcon = (iconName: string) => {
    return iconMap[iconName] || Package;
  };

  return (
    <div className="min-h-screen bg-cream-100">
      <header className="no-print fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-50 shadow-sm">
        <div className="h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors lg:hidden"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center">
                <UtensilsCrossed className="text-white" size={22} />
              </div>
              <div>
                <h1 className="font-serif text-lg font-bold text-gray-800">华医食材采购管理平台</h1>
                <p className="text-xs text-gray-500 -mt-1">Daniel个人开发测试工具</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white font-medium text-sm">
                    {user.name.charAt(0)}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium text-gray-800">{user.name}</p>
                    <p className="text-xs text-gray-500">
                    {user.role === 'admin' ? '管理员' : 
                     user.role === 'finance' ? '财务' : 
                     user.role === 'boss' ? '董事长' : '普通员工'}
                  </p>
                  </div>
                  <ChevronDown size={16} className="text-gray-400 hidden sm:block" />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-1 animate-slide-up">
                    <button
                      onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <User size={16} />
                      个人中心
                    </button>
                    {isAdmin() && (
                      <button
                        onClick={() => { setUserMenuOpen(false); navigate('/users'); }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Users size={16} />
                        用户管理
                      </button>
                    )}
                    <div className="border-t border-gray-100 my-1" />
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <LogOut size={16} />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleLoginClick}
                className="btn-primary text-sm"
              >
                登录
              </button>
            )}
          </div>
        </div>
      </header>

      <aside className={`no-print fixed left-0 top-16 bottom-0 w-60 bg-white border-r border-gray-200 transition-transform duration-300 z-40 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}>
        <nav className="p-4 space-y-1">
          {visibleNavItems.map(item => {
            const Icon = getIcon(item.icon);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={() => window.innerWidth < 1024 && setSidebarOpen(false)}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100">
          <div className="bg-primary-50 rounded-xl p-4">
            <p className="text-sm font-medium text-primary-700 mb-2">💰 今日采购金额</p>
            <p className="text-lg font-bold text-primary-600 mb-3">{formatCurrency(totalAmount)}</p>
            
            {maxIncrease && (
              <div className="mb-2">
                <p className="text-xs font-medium text-red-600">📈 价格上涨提醒</p>
                <p className="text-sm text-gray-700">
                  {maxIncrease.item.ingredientName} +{maxIncrease.rate.toFixed(1)}%
                  <span className="text-xs text-gray-400 ml-1">
                    ({maxIncrease.source === 'lastMonth' ? '较上月平均' : '较基准价'})
                  </span>
                </p>
              </div>
            )}
            
            {maxDecrease && (
              <div>
                <p className="text-xs font-medium text-green-600">📉 价格下跌提醒</p>
                <p className="text-sm text-gray-700">
                  {maxDecrease.item.ingredientName} {maxDecrease.rate.toFixed(1)}%
                  <span className="text-xs text-gray-400 ml-1">
                    ({maxDecrease.source === 'lastMonth' ? '较上月平均' : '较基准价'})
                  </span>
                </p>
              </div>
            )}
            
            {!maxIncrease && !maxDecrease && totalAmount > 0 && (
              <p className="text-xs text-gray-500">暂无明显价格波动</p>
            )}
            
            {totalAmount === 0 && (
              <p className="text-xs text-gray-500">今日暂无采购数据</p>
            )}
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div 
          className="no-print fixed inset-0 bg-black/20 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="pt-16 lg:pl-60">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
