import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, type CheckupTemplate } from './api';
import { useToast } from '@/components/Toast';

type ScopeTab = 'mine' | 'public' | 'shared';

export default function ListPage() {
 const navigate = useNavigate();
 const toast = useToast();
 const [scope, setScope] = useState<ScopeTab>('mine');
 const [keyword, setKeyword] = useState('');
 const [loading, setLoading] = useState(false);
 const [list, setList] = useState<CheckupTemplate[]>([]);

 const load = async () => {
   setLoading(true);
   try {
     const res = await checkupApi.list({ scope, keyword: keyword || undefined });
     if (res?.ok) setList(res.data || []);
     else toast.error(res?.error || '加载失败');
   } catch (e: any) {
     toast.error(e.message || '加载失败');
   } finally {
     setLoading(false);
   }
 };

 useEffect(() => { load(); }, [scope]);

 const onSearch = () => { load(); };

 const tabs: { key: ScopeTab; name: string; emoji: string }[] = [
   { key: 'mine', name: '我的套餐', emoji: '💼' },
   { key: 'public', name: '公共模板', emoji: '🏛️' },
   { key: 'shared', name: '分配给我', emoji: '📩' },
 ];

 return (
   <div className="min-h-screen bg-gradient-to-b from-green-50 via-[#faf7ee] to-[#f2efe3] pb-28">
     <header className="bg-white sticky top-0 z-20 border-b border-gray-100">
       <div className="px-4 py-3 flex items-center justify-between">
         <div className="flex items-center gap-2">
           <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#1f6b3e] to-green-800 text-white flex items-center justify-center text-lg">🏥</div>
           <div>
             <div className="text-base font-bold text-gray-900 leading-tight">体检配单</div>
             <div className="text-[10px] text-gray-500">为客户快速定制方案</div>
           </div>
         </div>
       </div>
       {/* 搜索框 */}
       <div className="px-4 pb-3">
         <div className="flex items-center bg-gray-100 rounded-xl px-3 h-10">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
           <input value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSearch(); }}
             className="bg-transparent flex-1 ml-2 outline-none text-sm" placeholder="搜索套餐名/编号..." />
           <button onClick={onSearch} className="text-xs text-[#0f5132] px-2 py-1 rounded-lg">搜索</button>
         </div>
       </div>
       {/* 三个 Tab */}
       <div className="px-3 pb-3 flex gap-1.5 overflow-x-auto scrollbar-hide">
         {tabs.map(t => (
           <button key={t.key} onClick={() => setScope(t.key)}
             className={scope === t.key
               ? 'shrink-0 h-8 px-3 rounded-full bg-[#0f5132] text-white text-xs font-medium flex items-center gap-1'
               : 'shrink-0 h-8 px-3 rounded-full bg-white text-gray-600 border border-gray-200 text-xs flex items-center gap-1'}>
             <span>{t.emoji}</span>{t.name}
           </button>
         ))}
       </div>
     </header>

     <main className="px-3 pt-3 space-y-3">
       {loading ? <div className="text-center text-gray-400 text-xs py-12">加载中...</div> : null}
       {!loading && list.length === 0 ? (
         <div className="text-center py-16">
           <div className="text-4xl mb-3">📦</div>
           <div className="text-sm text-gray-500">暂无套餐，点击底部按钮新建吧</div>
         </div>
       ) : (
         list.map(pkg => <PackageCard key={pkg.id} pkg={pkg} onClick={() => navigate('/h/checkup-templates/' + pkg.id + '/finish')} />)
       )}
     </main>

     {/* 悬浮底部：新建套餐按钮 */}
     <div className="fixed bottom-0 left-0 right-0 p-3 pb-5 bg-gradient-to-t from-gray-50 to-transparent">
       <button onClick={() => navigate('/h/checkup-templates/new')}
         className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#1f6b3e] to-green-800 text-white text-base font-semibold shadow-lg shadow-emerald-700/30 flex items-center justify-center gap-2">
         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
         新建体检套餐
       </button>
     </div>
   </div>
 );
}

function PackageCard({ pkg, onClick }: { pkg: CheckupTemplate; onClick: () => void }) {
 const applicable: any[] = (pkg as any).applicable_roles || ROLES;
 return (
   <div onClick={onClick} className="bg-white rounded-3xl p-4 shadow-sm active:scale-[0.99] transition">
     <div className="flex items-start justify-between">
       <div className="flex items-start gap-3 min-w-0 flex-1">
         <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 text-emerald-800 flex items-center justify-center text-2xl shrink-0">
           📋
         </div>
         <div className="min-w-0 flex-1">
           <div className="text-base font-semibold text-gray-900 truncate">{pkg.name}</div>
           <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
             <span>#{pkg.code || pkg.id.slice(0, 8)}</span>
             {(pkg as any).is_public && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">公共模板</span>}
             {(pkg as any).base_template_id && <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">衍生</span>}
             <span className="text-gray-400">{new Date(pkg.created_at).toLocaleDateString('zh-CN')}</span>
           </div>
         </div>
       </div>
       <svg className="ml-2 shrink-0 mt-1" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M9 6l6 6-6 6"/></svg>
     </div>
     <div className="mt-3 flex flex-wrap gap-1.5">
       {applicable.map((r: any) => {
         const plan: any = ((pkg as any).role_price_capsule || {})[r] || {};
         const disc = Number(plan.discount_price || 0);
         const rate = Number(plan.discount_rate || 100);
         return (
           <span key={r} className={r === 'male'
             ? 'inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-blue-50 text-emerald-800 border border-blue-100 text-[11px]'
             : 'inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-pink-50 text-pink-700 border border-pink-100 text-[11px]'}>
             <span className="text-sm">{ROLE_EMOJI[r as any] || '👤'}</span>
             <span className="font-semibold">¥{disc.toFixed(0)}</span>
             {rate < 100 && <span className="opacity-70">{rate.toFixed(0)}折</span>}
           </span>
         );
       })}
     </div>
   </div>
 );
}