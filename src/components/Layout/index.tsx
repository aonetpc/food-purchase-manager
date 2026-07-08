import { useState, useEffect } from 'react';
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
  Users
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { formatCurrency } from '@/utils/format';
import { formatDate } from '@/utils/date';

export default function Layout() {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuthStore();
  const { fetchRecords, getItems } = usePurchaseStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = formatDate(today);

  useEffect(() => {
    fetchRecords(todayKey);
  }, [fetchRecords, todayKey]);

  const todayItems = getItems(todayKey);
  const totalAmount = todayItems.reduce((sum, item) => sum + item.amount, 0);
  
  const priceChanges = todayItems.filter(item => item.baseUnitPrice > 0);
  const maxIncrease = priceChanges.length > 0 
    ? [...priceChanges].sort((a, b) => (b.baseUnitPrice - b.purchaseUnitPrice) / b.baseUnitPrice - (a.baseUnitPrice - a.purchaseUnitPrice) / a.baseUnitPrice)[0]
    : null;
  const maxDecrease = priceChanges.length > 0
    ? [...priceChanges].sort((a, b) => (a.baseUnitPrice - a.purchaseUnitPrice) / a.baseUnitPrice - (b.baseUnitPrice - b.purchaseUnitPrice) / b.baseUnitPrice)[0]
    : null;

  const getChangeRate = (item: typeof todayItems[0]) => {
    if (item.baseUnitPrice <= 0) return 0;
    return ((item.purchaseUnitPrice - item.baseUnitPrice) / item.baseUnitPrice * 100).toFixed(1);
  };

  const navItems = [
    { path: '/daily', label: '每日采购清单', icon: ShoppingCart },
    { path: '/monthly', label: '月度价格分析', icon: TrendingUp },
    { path: '/yearly', label: '年度平均价查询', icon: BarChart3 },
    { path: '/ingredients', label: '食材价格查询', icon: Search },
  ];

  const adminNavItems = [
    { path: '/purchase-entry', label: '采买清单录入', icon: ClipboardList },
    { path: '/departments', label: '部门管理', icon: Building2 },
    { path: '/categories', label: '食材分类管理', icon: Tags },
    { path: '/ingredient-manager', label: '食材信息管理', icon: Package },
  ];

  const visibleNavItems = [
    ...(isAdmin() ? adminNavItems : []),
    ...navItems,
  ];

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
                    <p className="text-xs text-gray-500">{user.role === 'admin' ? '管理员' : '查看员'}</p>
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
          {visibleNavItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => window.innerWidth < 1024 && setSidebarOpen(false)}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100">
          <div className="bg-primary-50 rounded-xl p-4">
            <p className="text-sm font-medium text-primary-700 mb-2">💰 今日采购金额</p>
            <p className="text-lg font-bold text-primary-600 mb-3">{formatCurrency(totalAmount)}</p>
            
            {maxIncrease && (
              <div className="mb-2">
                <p className="text-xs font-medium text-red-600">📈 价格上涨提醒</p>
                <p className="text-sm text-gray-700">{maxIncrease.ingredientName} +{getChangeRate(maxIncrease)}%</p>
              </div>
            )}
            
            {maxDecrease && (
              <div>
                <p className="text-xs font-medium text-green-600">📉 价格下跌提醒</p>
                <p className="text-sm text-gray-700">{maxDecrease.ingredientName} {getChangeRate(maxDecrease)}%</p>
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
