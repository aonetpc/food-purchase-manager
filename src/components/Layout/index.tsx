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
  Lock,
  Target,
  UserCheck,
  ShieldCheck,
  Shield,
} from 'lucide-react';
import { useAuthStore, type MenuItem } from '@/store/authStore';
import { usePurchaseStore } from '@/store/purchaseStore';
import { formatCurrency } from '@/utils/format';
import { formatDate } from '@/utils/date';
import { api } from '@/lib/api';

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
  Lock,
  Target,
  UserCheck,
  ShieldCheck,
  Shield,
  Users,
};

export default function Layout() {
  const navigate = useNavigate();
  const { user, isAdmin, canViewMonthly, logout, getUserMenus } = useAuthStore();
  const { fetchRecords, records, fetchLastMonthAveragePrices, getComparePrice } = usePurchaseStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordData, setChangePasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [changePasswordMessage, setChangePasswordMessage] = useState('');

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

  const defaultAdminMenus: MenuItem[] = [
    { code: 'menu:daily', name: '每日采购清单', path: '/daily', icon: 'ShoppingCart' },
    { code: 'menu:monthly', name: '月度价格分析', path: '/monthly', icon: 'TrendingUp' },
    { code: 'menu:yearly', name: '年度均价查询', path: '/yearly', icon: 'BarChart3' },
    { code: 'menu:ingredients', name: '食材价格查询', path: '/ingredients', icon: 'Search' },
    { code: 'menu:purchase-entry', name: '采购录入', path: '/purchase-entry', icon: 'ClipboardList' },
    { code: 'menu:reimbursement', name: '报销管理', path: '/reimbursement', icon: 'Receipt' },
    { code: 'menu:users', name: '用户管理', path: '/users', icon: 'Users' },
    { code: 'menu:roles', name: '角色管理', path: '/roles', icon: 'Shield' },
    { code: 'menu:categories', name: '分类管理', path: '/categories', icon: 'Tags' },
    { code: 'menu:ingredient-manager', name: '食材管理', path: '/ingredient-manager', icon: 'Package' },
    { code: 'menu:departments', name: '部门管理', path: '/departments', icon: 'Building2' },
    { code: 'menu:temp-positions', name: '岗位管理', path: '/temp-positions', icon: 'Target' },
    { code: 'menu:temp-auditors', name: '审核员管理', path: '/temp-auditors', icon: 'UserCheck' },
    { code: 'menu:temp-workers', name: '外请人员', path: '/temp-workers', icon: 'Users' },
    { code: 'menu:temp-audit', name: '打卡审核', path: '/temp-audit', icon: 'Check' },
    { code: 'menu:temp-assessment', name: '月底考核', path: '/temp-assessment', icon: 'Calendar' },
    { code: 'menu:temp-stats', name: '统计看板', path: '/temp-stats', icon: 'BarChart3' },
    { code: 'menu:wecom', name: '企业微信管理', path: '/wecom', icon: 'Smartphone' },
  ];

  const navItems = useMemo(() => {
    const menus = getUserMenus();
    return menus.filter(m => !m.path.startsWith('/m/'));
  }, [getUserMenus]);

  const adminNavItems = useMemo(() => {
    const menus = getUserMenus();
    return menus.filter(m => 
      ['/purchase-entry', '/departments', '/categories', '/ingredient-manager', '/reimbursement', '/wecom', '/users', '/roles', '/temp-positions', '/temp-auditors', '/temp-workers', '/temp-audit', '/temp-assessment', '/temp-stats'].includes(m.path)
    );
  }, [getUserMenus]);

  const visibleNavItems = useMemo(() => {
    let userMenus = getUserMenus();
    const pcMenus = userMenus.filter(m => !m.path.startsWith('/m/'));
    
    if (isAdmin() && pcMenus.length === 0) {
      return defaultAdminMenus;
    }

    if (isAdmin()) {
      const existingPaths = new Set(pcMenus.map(m => m.path));
      const missingMenus = defaultAdminMenus.filter(m => !existingPaths.has(m.path));
      userMenus = [...pcMenus, ...missingMenus];
    }
    
    const order = ['/daily', '/monthly', '/yearly', '/ingredients', '/purchase-entry', '/reimbursement', '/users', '/roles', '/categories', '/ingredient-manager', '/departments', '/temp-positions', '/temp-auditors', '/temp-workers', '/temp-audit', '/temp-assessment', '/temp-stats', '/wecom'];

    return userMenus.sort((a, b) => {
      const aIdx = order.indexOf(a.path) >= 0 ? order.indexOf(a.path) : 100;
      const bIdx = order.indexOf(b.path) >= 0 ? order.indexOf(b.path) : 100;
      return aIdx - bIdx;
    });
  }, [getUserMenus, isAdmin]);

  const handlePrint = () => {
    window.print();
  };

  const handleLogout = () => {
    logout();
    setUserMenuOpen(false);
    navigate('/login');
  };

  const handleChangePassword = async () => {
    setChangePasswordMessage('');
    const { oldPassword, newPassword, confirmPassword } = changePasswordData;
    
    if (!oldPassword || !newPassword || !confirmPassword) {
      setChangePasswordMessage('请填写所有字段');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setChangePasswordMessage('两次输入的新密码不一致');
      return;
    }
    
    if (newPassword.length < 6) {
      setChangePasswordMessage('新密码长度不能少于6位');
      return;
    }
    
    try {
      await api.post('/auth/change-password', {
        userId: user?.id,
        oldPassword,
        newPassword,
      });
      setChangePasswordMessage('密码修改成功，请重新登录');
      setTimeout(() => {
        logout();
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      setChangePasswordMessage(err.message || '修改失败');
    }
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
                     user.role === 'boss' ? '董事长' :
                     user.role === 'temp_auditor' ? '外请审核员' :
                     user.role === 'temp_chairman' ? '外请董事长' : '普通员工'}
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
                      onClick={() => { setUserMenuOpen(false); setShowChangePassword(true); }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Lock size={16} />
                      修改密码
                    </button>
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

      {/* 修改密码弹窗 */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-800">修改密码</h3>
              <button onClick={() => { setShowChangePassword(false); setChangePasswordMessage(''); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {changePasswordMessage && (
                <div className={`p-2 text-sm rounded ${
                  changePasswordMessage.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {changePasswordMessage}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">旧密码</label>
                <input
                  type="password"
                  value={changePasswordData.oldPassword}
                  onChange={(e) => setChangePasswordData({ ...changePasswordData, oldPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入旧密码"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                <input
                  type="password"
                  value={changePasswordData.newPassword}
                  onChange={(e) => setChangePasswordData({ ...changePasswordData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请输入新密码（至少6位）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
                <input
                  type="password"
                  value={changePasswordData.confirmPassword}
                  onChange={(e) => setChangePasswordData({ ...changePasswordData, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="请再次输入新密码"
                />
              </div>
            </div>
            <div className="flex gap-3 p-4 border-t">
              <button
                onClick={() => { setShowChangePassword(false); setChangePasswordMessage(''); }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleChangePassword}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
