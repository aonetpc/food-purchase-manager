import { useState } from 'react';
import { Stethoscope, ClipboardList } from 'lucide-react';
import CheckupItemsTab from './CheckupItemsTab';
import PackagesTab from './PackagesTab';

type MainTab = 'items' | 'packages';

export default function CheckupCenter() {
  const [tab, setTab] = useState<MainTab>('packages');

  const tabs: { key: MainTab; name: string; icon: React.ComponentType<any>; desc: string }[] = [
    { key: 'packages', name: '体检套餐管理', icon: ClipboardList, desc: '基础套餐管理 / 我的套餐 / 三角色价格方案' },
    { key: 'items', name: '体检项目库', icon: Stethoscope, desc: '7大分类 / 组合项目 / 新增编辑禁用' },
  ];

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* 页面标题 */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-900 text-white flex items-center justify-center shadow-md shadow-emerald-900/20 shrink-0">
            <Stethoscope size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 leading-tight">体检中心</h1>
            <p className="text-sm text-gray-500 mt-0.5">统一管理体检项目库、基础套餐与销售员套餐</p>
          </div>
        </div>
      </div>

      {/* 主 Tab 切换 */}
      <div className="px-6 pb-2">
        <div className="inline-flex p-1 bg-gray-100 rounded-xl border border-gray-200">
          {tabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all min-w-[180px] ${
                  active
                    ? 'bg-white text-emerald-800 shadow-sm border border-gray-200/70'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={16} />
                <div className="flex-1 min-w-0 text-left">
                  <div className="leading-tight">{t.name}</div>
                  <div className={`text-[10.5px] leading-tight mt-0.5 ${active ? 'text-gray-400' : 'text-gray-400/70'}`}>
                    {t.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="px-6 pb-10 pt-4">
        {tab === 'packages' && <PackagesTab />}
        {tab === 'items' && <CheckupItemsTab />}
      </div>
    </div>
  );
}
