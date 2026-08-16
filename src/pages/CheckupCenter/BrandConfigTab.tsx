import React, { useEffect, useState } from 'react';
import { Building2, UserCircle2, Save, Loader2 } from 'lucide-react';
import { checkupApi, type BrandConfig, type SalesProfile } from './api';
import { useToast } from '@/components/Toast';
import { useAuthStore } from '@/store/authStore';

const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-all';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5';
const subTipCls = 'text-[11px] text-gray-400 mt-1 leading-tight';
const sectionCard =
  'bg-white rounded-2xl border border-gray-200 shadow-sm';
const btnPrimary =
  'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium shadow-sm shadow-emerald-700/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

type SubTab = 'company' | 'profile';

export default function BrandConfigTab() {
  const toast = useToast();
  const user = useAuthStore(s => s.user);
  const isAdmin = useAuthStore(s => s.isAdmin?.() || ['admin', 'boss', 'manager'].includes((s.user?.role || '').toLowerCase()));
  const [sub, setSub] = useState<SubTab>('company');

  // ======= 企业品牌 =======
  const [brand, setBrand] = useState<Partial<BrandConfig>>({});
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);

  // ======= 客户经理名片 =======
  const [profile, setProfile] = useState<Partial<SalesProfile>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => { loadBrand(); }, []);
  useEffect(() => { if (user?.id) loadProfile(); }, [user?.id]);

  const loadBrand = async () => {
    setBrandLoading(true);
    try {
      const res = await checkupApi.getBrandConfig();
      if (res?.ok) setBrand(res.data || {});
      else toast.error(res?.error || '加载品牌配置失败');
    } catch (e: any) { toast.error(e?.message || '加载品牌配置失败'); }
    finally { setBrandLoading(false); }
  };

  const loadProfile = async () => {
    if (!user?.id) return;
    setProfileLoading(true);
    try {
      const res = await checkupApi.getSalesProfile(user.id);
      if (res?.ok) setProfile(res.data || { name: user.name, phone: (user as any).phone || null });
      else toast.error(res?.error || '加载名片失败');
    } catch (e: any) { toast.error(e?.message || '加载名片失败'); }
    finally { setProfileLoading(false); }
  };

  const saveBrand = async () => {
    if (!isAdmin) { toast.error('仅管理员可修改企业品牌'); return; }
    setBrandSaving(true);
    try {
      const res = await checkupApi.saveBrandConfig(brand);
      if (res?.ok) { setBrand(res.data || {}); toast.success('企业品牌信息已保存'); }
      else toast.error(res?.error || '保存失败');
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    finally { setBrandSaving(false); }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      const res = await checkupApi.saveSalesProfile(profile);
      if (res?.ok) { setProfile(res.data || {}); toast.success('个人名片已保存'); }
      else toast.error(res?.error || '保存失败');
    } catch (e: any) { toast.error(e?.message || '保存失败'); }
    finally { setProfileSaving(false); }
  };

  const tabs: { key: SubTab; name: string; icon: React.ComponentType<any>; desc: string }[] = [
    { key: 'company', name: '企业品牌信息', icon: Building2, desc: '分享页面展示的公司名称/Logo/地址/电话 · 仅管理员可编辑' },
    { key: 'profile', name: '我的客户经理名片', icon: UserCircle2, desc: '分享页面底部展示的头像等 · 每个销售维护自己的' },
  ];

  return (
    <div>
      {/* 子 Tab */}
      <div className="mb-5 inline-flex p-1 bg-gray-100 rounded-xl border border-gray-200">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all min-w-[260px] ${
                active ? 'bg-white text-emerald-800 shadow-sm border border-gray-200/70' : 'text-gray-500 hover:text-gray-700'
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

      {sub === 'company' && (
        <div className={sectionCard}>
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <Building2 size={18} className="text-emerald-700" /> 企业品牌信息
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">这些信息会出现在客户打开的分享落地页头部和底部。{!isAdmin && '（只读：仅管理员可编辑）'}</div>
            </div>
            <button onClick={saveBrand} disabled={!isAdmin || brandSaving || brandLoading} className={btnPrimary}>
              {brandSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {brandSaving ? '保存中...' : '保存设置'}
            </button>
          </div>

          {brandLoading ? (
            <div className="p-12 text-center text-sm text-gray-400">加载中...</div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5 pb-4 border-b border-gray-100">
                <div>
                  <label className={labelCls}>企业名称 <span className="text-rose-500">*</span></label>
                  <input className={inputCls} disabled={!isAdmin} value={brand.name ?? ''}
                    onChange={e => setBrand(b => ({ ...b, name: e.target.value }))} placeholder="上海画一健康管理有限公司" />
                </div>
                <div>
                  <label className={labelCls}>品牌标语</label>
                  <input className={inputCls} disabled={!isAdmin} value={brand.slogan ?? ''}
                    onChange={e => setBrand(b => ({ ...b, slogan: e.target.value }))} placeholder="专注高端体检 · 为您定制专属方案" />
                </div>
              </div>

              <div>
                <label className={labelCls}>Logo 图片 URL</label>
                <input className={inputCls} disabled={!isAdmin} value={brand.logo ?? ''}
                  onChange={e => setBrand(b => ({ ...b, logo: e.target.value }))} placeholder="https://.../logo.png" />
                {brand.logo && (
                  <div className="mt-2 inline-flex items-center gap-3 bg-gray-50 rounded-lg p-2 border border-gray-100">
                    <img src={brand.logo} alt="" className="w-12 h-12 rounded-lg object-cover bg-white border" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    <span className="text-[11px] text-gray-500">预览</span>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>主题色（分享页头部背景）</label>
                <div className="flex items-center gap-2">
                  <input type="color" disabled={!isAdmin} value={brand.primary_color || '#0f5132'}
                    onChange={e => setBrand(b => ({ ...b, primary_color: e.target.value }))}
                    className="w-12 h-10 rounded-lg border border-gray-300 bg-white p-1 cursor-pointer disabled:opacity-60" />
                  <input className={`${inputCls} flex-1`} disabled={!isAdmin} value={brand.primary_color || ''}
                    onChange={e => setBrand(b => ({ ...b, primary_color: e.target.value }))} placeholder="#0f5132" />
                </div>
                <div className={subTipCls}>建议使用深色主色，保证白色标题文字可读</div>
              </div>

              <div>
                <label className={labelCls}>客服 / 预约电话</label>
                <input className={inputCls} disabled={!isAdmin} value={brand.phone ?? ''}
                  onChange={e => setBrand(b => ({ ...b, phone: e.target.value }))} placeholder="400-xxxx-xxxx" />
                <div className={subTipCls}>客户点击可直接拨打</div>
              </div>
              <div>
                <label className={labelCls}>公司 / 体检中心地址</label>
                <input className={inputCls} disabled={!isAdmin} value={brand.address ?? ''}
                  onChange={e => setBrand(b => ({ ...b, address: e.target.value }))} placeholder="上海市浦东新区..." />
                <div className={subTipCls}>客户点击可打开地图导航</div>
              </div>

              <div className="md:col-span-2 pt-3 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>服务时间（占位：暂不显示）</label>
                  <input className={inputCls} disabled={!isAdmin} value={brand.service_hours ?? ''}
                    onChange={e => setBrand(b => ({ ...b, service_hours: e.target.value }))} placeholder="周一至周六 7:30-17:00" />
                </div>
                <div>
                  <label className={labelCls}>资质说明（占位：暂不显示）</label>
                  <input className={inputCls} disabled={!isAdmin} value={brand.qualification ?? ''}
                    onChange={e => setBrand(b => ({ ...b, qualification: e.target.value }))} placeholder="市医保定点 · 三甲标准设备" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>公众号二维码 URL（占位：暂不显示）</label>
                  <input className={inputCls} disabled={!isAdmin} value={brand.wechat_qrcode ?? ''}
                    onChange={e => setBrand(b => ({ ...b, wechat_qrcode: e.target.value }))} placeholder="https://.../qrcode.png" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {sub === 'profile' && (
        <div className={sectionCard}>
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <UserCircle2 size={18} className="text-emerald-700" /> 我的客户经理名片
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                客户打开您分享的套餐链接时，会在底部看到您的联系方式。当前仅头像参与展示。
              </div>
            </div>
            <button onClick={saveProfile} disabled={profileSaving || profileLoading} className={btnPrimary}>
              {profileSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {profileSaving ? '保存中...' : '保存名片'}
            </button>
          </div>

          {profileLoading ? (
            <div className="p-12 text-center text-sm text-gray-400">加载中...</div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5 pb-4 border-b border-gray-100">
                <div>
                  <label className={labelCls}>姓名 <span className="text-gray-400 font-normal">（只读）</span></label>
                  <input className={`${inputCls} bg-gray-50 text-gray-500`} disabled value={profile.name ?? ''} />
                </div>
                <div>
                  <label className={labelCls}>联系电话 <span className="text-gray-400 font-normal">（只读：取自用户信息）</span></label>
                  <input className={`${inputCls} bg-gray-50 text-gray-500`} disabled value={profile.phone ?? ''} placeholder="未设置" />
                </div>
              </div>

              <div>
                <label className={labelCls}>头像图片 URL</label>
                <input className={inputCls} value={profile.avatar_url ?? ''}
                  onChange={e => setProfile(p => ({ ...p, avatar_url: e.target.value }))} placeholder="https://.../avatar.jpg" />
                <div className="mt-2 flex items-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center text-xl font-bold border">
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full rounded-2xl object-cover"
                        onError={(e) => { (e.currentTarget.style.display = 'none'); const p = e.currentTarget.parentElement; if (p) p.innerHTML = (profile.name || 'U').slice(0, 1); }} />
                    ) : ((profile.name || 'U').slice(0, 1))}
                  </div>
                  <div className="text-[11px] text-gray-500">建议正方形，≥200×200px<br/>未上传时显示首字母占位</div>
                </div>
              </div>

              <div></div>

              <div className="md:col-span-2 pt-3 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>职位（占位：暂不显示）</label>
                  <input className={inputCls} value={profile.title ?? ''}
                    onChange={e => setProfile(p => ({ ...p, title: e.target.value }))} placeholder="资深健康顾问" />
                </div>
                <div>
                  <label className={labelCls}>邮箱（占位：暂不显示）</label>
                  <input className={inputCls} value={profile.email ?? ''}
                    onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} placeholder="name@example.com" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>个人简介（占位：暂不显示）</label>
                  <input className={inputCls} value={profile.bio ?? ''}
                    onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} placeholder="10年健康管理经验 · 服务500+企业客户" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>个人微信二维码 URL（占位：暂不显示）</label>
                  <input className={inputCls} value={profile.wechat_qrcode ?? ''}
                    onChange={e => setProfile(p => ({ ...p, wechat_qrcode: e.target.value }))} placeholder="https://.../wechat.png" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
