import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkupApi, ROLES, ROLE_LABEL, ROLE_EMOJI, ROLE_HINT, type Role, type CheckupTemplate } from './api';
import { useToast } from '@/components/Toast';

export default function WizardNew() {
 const navigate = useNavigate();
 const toast = useToast();
 const [name, setName] = useState('');
 const [roles, setRoles] = useState<Role[]>(['male', 'female_married']);
 const [publicTemplates, setPublicTemplates] = useState<CheckupTemplate[]>([]);
 const [baseTemplateId, setBaseTemplateId] = useState<string | null>(null);
 const [loading, setLoading] = useState(false);
 const [submitting, setSubmitting] = useState(false);

 const toggleRole = (r: Role) => {
   setRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
 };

 const loadPublicTemplates = async () => {
   setLoading(true);
   try {
     const res = await checkupApi.list({ scope: 'public' });
     if (res?.ok) setPublicTemplates(res.data || []);
   } catch (e: any) {
     // 静默
   } finally {
     setLoading(false);
   }
 };
 useEffect(() => { loadPublicTemplates(); }, []);

 const submit = async () => {
   if (!name.trim()) { toast.error('请输入套餐名称'); return; }
   if (roles.length === 0) { toast.error('请至少选择一种适用角色'); return; }
   setSubmitting(true);
   try {
     let pkgId: string;
     // 1) 若选了基础套餐 → 克隆
     if (baseTemplateId) {
       const res = await checkupApi.clone(baseTemplateId, { name: name.trim(), applicable_roles: roles });
       if (!res?.ok) throw new Error(res?.error || '克隆失败');
       pkgId = res.data.id;
     } else {
       // 2) 否则新建空套餐
       const res = await checkupApi.create({ name: name.trim(), applicable_roles: roles });
       if (!res?.ok) throw new Error(res?.error || '创建失败');
       pkgId = res.data.id;
     }
     toast.success(baseTemplateId ? '已套用基础套餐，开始配置项目' : '创建成功，开始配置项目');
     navigate(`/h/checkup-templates/${pkgId}/items`);
   } catch (e: any) {
     toast.error(e.message || '操作失败');
   } finally {
     setSubmitting(false);
   }
 };

 return (
   <div className="min-h-screen bg-gradient-to-b from-blue-600 via-blue-50 to-gray-50 pb-28">
     <header className="text-white px-5 pt-5 pb-4">
       <div className="flex items-center justify-between">
         <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
         </button>
       </div>
       <div className="mt-4 flex items-start gap-3">
         <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center text-2xl">🧾</div>
         <div>
           <h1 className="text-xl font-bold">新建体检套餐</h1>
           <p className="text-xs text-white/80 mt-1">选角色、选模板，快速生成多角色方案</p>
         </div>
       </div>
     </header>

     <main className="px-4 space-y-4 -mt-2">
       {/* Step 1 套餐名 */}
       <section className="bg-white rounded-3xl p-4 shadow-sm">
         <div className="flex items-center gap-2 mb-3">
           <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</div>
           <h2 className="font-semibold text-gray-900">套餐名称</h2>
         </div>
         <input
           value={name}
           onChange={e => setName(e.target.value)}
           maxLength={40}
           className="w-full h-12 px-4 rounded-xl bg-gray-50 border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
           placeholder="如：阿里2026年度体检"
         />
         {!name.trim() && <div className="text-[11px] text-red-500 mt-1 ml-1">套餐名必填</div>}
       </section>

       {/* Step 2 适用角色 */}
       <section className="bg-white rounded-3xl p-4 shadow-sm">
         <div className="flex items-center gap-2 mb-3">
           <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">2</div>
           <h2 className="font-semibold text-gray-900">适用角色（可多选）</h2>
         </div>
         <div className="grid grid-cols-3 gap-2">
           {ROLES.map(r => {
             const checked = roles.includes(r);
             return (
               <button key={r} onClick={() => toggleRole(r)}
                 className={`relative border-2 rounded-2xl px-2 py-4 text-center transition-all ${
                   checked ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'
                 }`}>
                 {checked && (
                   <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>
                   </span>
                 )}
                 <div className="text-3xl">{ROLE_EMOJI[r]}</div>
                 <div className={`text-sm mt-1 font-medium ${checked ? 'text-blue-700' : 'text-gray-700'}`}>{ROLE_LABEL[r]}</div>
                 <div className="text-[10px] text-gray-500 mt-0.5 leading-snug px-1">{ROLE_HINT[r]}</div>
               </button>
             );
           })}
         </div>
         <div className="mt-3 text-xs text-blue-700 bg-blue-50 rounded-xl px-3 py-2">
           💡 已选 <span className="font-semibold">{roles.length}</span> 个角色，将同时生成 <span className="font-semibold">{roles.length}</span> 份配置
         </div>
       </section>

       {/* Step 3 套基础套餐 */}
       <section className="bg-white rounded-3xl p-4 shadow-sm">
         <div className="flex items-center gap-2 mb-3">
           <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">3</div>
           <h2 className="font-semibold text-gray-900">套用基础套餐</h2>
           <span className="ml-auto text-[11px] text-gray-400">（可选）</span>
         </div>
         {loading ? (
           <div className="text-center text-gray-400 text-xs py-6">加载公共模板中...</div>
         ) : publicTemplates.length === 0 ? (
           <div className="text-center text-xs text-gray-400 py-6">暂无公共模板，可跳过直接创建</div>
         ) : (
           <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
             {publicTemplates.map(tpl => {
               const checked = tpl.id === baseTemplateId;
               const caps = ROLES.map(r => {
                 const plan: any = (tpl.role_price_capsule as any)?.[r];
                 return { r, price: plan?.discount_price ?? 0, count: ((tpl.role_items as any)?.[r]?.item_count) ?? null };
               });
               return (
                 <button key={tpl.id} onClick={() => setBaseTemplateId(checked ? null : tpl.id)}
                   className={`w-full text-left rounded-2xl p-3 flex items-center gap-3 border-2 transition-all ${
                     checked ? 'border-blue-600 bg-blue-50' : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
                   }`}>
                   <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 text-white flex items-center justify-center text-xl flex-shrink-0">🎯</div>
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2">
                       <span className="font-semibold text-gray-900 truncate">{tpl.name}</span>
                     </div>
                     <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap items-center gap-1">
                       {caps.filter(c => (tpl.applicable_roles || ROLES).includes(c.r)).map(c => (
                         <span key={c.r} className="px-1.5 py-0.5 bg-white rounded-full border border-gray-100">
                           {ROLE_EMOJI[c.r]}¥{Number(c.price ?? 0).toFixed(0)}
                         </span>
                       ))}
                     </div>
                   </div>
                   <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${checked ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white'}`}>
                     {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>}
                   </div>
                 </button>
               );
             })}
           </div>
         )}
       </section>
     </main>

     {/* 底部开始按钮 */}
     <div className="fixed bottom-0 left-0 right-0 p-3 pb-5 bg-gradient-to-t from-gray-50 to-transparent">
       <button onClick={submit} disabled={submitting}
         className="w-full h-12 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-base font-semibold shadow-lg shadow-blue-600/30 disabled:opacity-60 flex items-center justify-center gap-2">
         {submitting ? '提交中...' : '开始配置项目 →'}
       </button>
     </div>
   </div>
 );
}