import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Users, Shield } from 'lucide-react';
import UserManager from '@/pages/UserManager';
import RoleManager from '@/pages/RoleManager';

type TabKey = 'users' | 'roles';

const TABS: { key: TabKey; label: string; icon: any; hash: string }[] = [
  { key: 'users', label: '用户管理', icon: Users, hash: '#users' },
  { key: 'roles', label: '角色管理', icon: Shield, hash: '#roles' },
];

function getTabFromHash(hash: string): TabKey {
  if (hash === '#roles') return 'roles';
  return 'users';
}

export default function PermissionManager() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabKey>(() => getTabFromHash(location.hash));

  const switchTab = (key: TabKey) => {
    setActiveTab(key);
    const targetHash = TABS.find(t => t.key === key)?.hash || '';
    if (location.hash !== targetHash) {
      navigate(location.pathname + targetHash, { replace: true });
    }
  };

  return (
    <div>
      {/* 标题区 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Shield className="text-primary-600" size={26} />
            <h1 className="text-2xl font-bold text-gray-900">权限管理</h1>
          </div>
          <p className="text-sm text-gray-500">管理系统用户账号、角色及对应权限</p>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => switchTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'users' && <UserManager embedded />}
      {activeTab === 'roles' && <RoleManager embedded />}
    </div>
  );
}
