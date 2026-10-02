import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Save, X, Image as ImageIcon, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { bookingApi, type MenuTemplate } from '../../lib/api';
import { useToast } from '@/components/Toast';

// 样式常量（与 BizConfigModal 一致）
const inputCls =
  'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-green-500 transition-colors';
const labelCl = 'block text-xs text-gray-500 mb-1.5';
const btnGhost =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors';
const btnGold =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors';
const btnRed =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white hover:bg-red-50 text-red-600 border border-red-200 transition-colors';

const SCOPE_OPTIONS: { value: MenuTemplate['scope']; label: string }[] = [
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'both', label: '午晚通用' },
];

const DEFAULT_FORM: Partial<MenuTemplate> = {
  name: '',
  scope: 'both',
  content_text: '',
  image_urls: [],
  sort_order: 100,
  status: 1,
};

// 图片转 base64 data URL
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 菜单摘要：取前 N 字符 + 行数
function summarizeContent(text?: string | null): string {
  if (!text) return '—';
  const trimmed = text.trim();
  if (!trimmed) return '—';
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const head = lines[0].slice(0, 30);
  if (lines.length <= 1) return head;
  return `${head}...（共${lines.length}行）`;
}

export default function MenuTemplateManager() {
  const toast = useToast();
  const [rows, setRows] = useState<MenuTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'create' | 'update'; data: Partial<MenuTemplate> } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await bookingApi.listMenuTemplates();
      setRows(data);
    } catch (e) {
      toast.error('加载菜单模板失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  function bumpEditing() {
    setEditing(prev => (prev ? { ...prev } : null));
  }

  async function handleSave() {
    if (!editing) return;
    const data = editing.data;
    if (!data.name || !String(data.name).trim()) {
      toast.error('请填写模板名称');
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<MenuTemplate> = {
        name: String(data.name).trim().slice(0, 100),
        scope: data.scope || 'both',
        content_text: data.content_text || '',
        image_urls: Array.isArray(data.image_urls) ? data.image_urls : [],
        sort_order: Number(data.sort_order) || 100,
        status: Number(data.status) === 0 ? 0 : 1,
      };
      if (editing.mode === 'update' && data.id) {
        await bookingApi.updateMenuTemplate(data.id, payload);
        toast.success('菜单模板已更新');
      } else {
        await bookingApi.createMenuTemplate(payload);
        toast.success('菜单模板已创建');
      }
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error('保存失败：' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: MenuTemplate) {
    if (!confirm(`确定禁用菜单模板「${r.name}」吗？\n（软删除，不影响已使用此模板的历史订单）`)) return;
    try {
      await bookingApi.deleteMenuTemplate(r.id);
      toast.success('已禁用');
      await reload();
    } catch (e) {
      toast.error('删除失败：' + (e as Error).message);
    }
  }

  // 图片选择：转 base64 加入 image_urls
  async function handlePickImages(files: FileList | null) {
    if (!files || !files.length || !editing) return;
    const arr = Array.from(files).slice(0, 20); // 单次最多 20 张
    const maxBytes = 3 * 1024 * 1024; // 单图最大 3MB
    const newUrls: string[] = [];
    for (const f of arr) {
      if (!f.type.startsWith('image/')) {
        toast.error(`文件「${f.name}」不是图片，已跳过`);
        continue;
      }
      if (f.size > maxBytes) {
        toast.error(`图片「${f.name}」超过 3MB，已跳过（建议压缩后再上传）`);
        continue;
      }
      try {
        const url = await fileToDataUrl(f);
        newUrls.push(url);
      } catch (e) {
        toast.error(`读取「${f.name}」失败：${(e as Error).message}`);
      }
    }
    if (newUrls.length) {
      const cur = Array.isArray(editing.data.image_urls) ? editing.data.image_urls : [];
      editing.data.image_urls = [...cur, ...newUrls];
      bumpEditing();
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeImage(idx: number) {
    if (!editing) return;
    const cur = Array.isArray(editing.data.image_urls) ? [...editing.data.image_urls] : [];
    cur.splice(idx, 1);
    editing.data.image_urls = cur;
    bumpEditing();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          菜单模板库：维护午餐/晚餐的常用菜单，下单时一键回填到对应场次，避免把菜单粘贴在备注里。
        </div>
        <button
          className={btnGold}
          onClick={() => setEditing({ mode: 'create', data: { ...DEFAULT_FORM, image_urls: [] } })}
        >
          <Plus size={14} /> 新增模板
        </button>
      </div>

      {loading && (
        <div className="text-center py-6 text-gray-500 text-sm bg-white rounded-lg border border-dashed border-gray-200">
          <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
          加载中...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-sm bg-white rounded-lg border border-dashed border-gray-200">
          暂无菜单模板，点击「新增模板」创建
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">名称</th>
                <th className="px-3 py-2 text-left">适用</th>
                <th className="px-3 py-2 text-left">菜单摘要</th>
                <th className="px-3 py-2 text-center">图片</th>
                <th className="px-3 py-2 text-center">排序</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const imgCount = (r.image_urls || []).length;
                const expanded = expandedId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {SCOPE_OPTIONS.find(s => s.value === r.scope)?.label || r.scope}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{summarizeContent(r.content_text)}</td>
                      <td className="px-3 py-2 text-center text-gray-700">{imgCount} 张</td>
                      <td className="px-3 py-2 text-center text-gray-700">{r.sort_order}</td>
                      <td className="px-3 py-2 text-center">
                        {Number(r.status) === 1 ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-green-50 text-green-700">启用</span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">禁用</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button className={btnGhost + ' mr-1'} onClick={() => setExpandedId(expanded ? null : r.id)}>
                          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {expanded ? '收起' : '预览'}
                        </button>
                        <button className={btnGhost + ' mr-1'} onClick={() => setEditing({ mode: 'update', data: { ...r, image_urls: [...(r.image_urls || [])] } })}>
                          编辑
                        </button>
                        <button className={btnRed} onClick={() => handleDelete(r)}>
                          <Trash2 size={12} /> 禁用
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <div className="text-xs text-gray-500 mb-1">菜单文本：</div>
                              <pre className="text-xs text-gray-800 whitespace-pre-wrap bg-white border border-gray-200 rounded p-2 max-h-60 overflow-y-auto">
                                {r.content_text || '（无文本）'}
                              </pre>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">菜单图片（{(r.image_urls || []).length} 张）：</div>
                              {imgCount > 0 ? (
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                  {(r.image_urls || []).map((u, i) => (
                                    <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0">
                                      <img src={u} alt={`图${i + 1}`} className="h-24 w-24 object-cover rounded border border-gray-200" />
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-gray-400">（无图片）</div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑/新增表单 */}
      {editing && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <h3 className="text-base font-semibold text-gray-900">
                {editing.mode === 'create' ? '新增菜单模板' : '编辑菜单模板'}
              </h3>
              <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className={labelCl}>模板名称 *</label>
                  <input
                    type="text"
                    className={inputCls}
                    value={String(editing.data.name || '')}
                    onChange={e => { editing.data.name = e.target.value; bumpEditing(); }}
                    placeholder="如：标准商务套餐A"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className={labelCl}>适用范围</label>
                  <select
                    className={inputCls}
                    value={String(editing.data.scope || 'both')}
                    onChange={e => { editing.data.scope = e.target.value as MenuTemplate['scope']; bumpEditing(); }}
                  >
                    {SCOPE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCl}>菜单文本（多行，可包含菜品分组）</label>
                <textarea
                  className={inputCls + ' font-mono'}
                  rows={8}
                  value={String(editing.data.content_text || '')}
                  onChange={e => { editing.data.content_text = e.target.value; bumpEditing(); }}
                  placeholder={'如：\n冷菜：\n  - 凉拌黄瓜\n  - 白切鸡\n热菜：\n  - 红烧肉\n  - 清蒸鲈鱼'}
                />
                <div className="text-xs text-gray-400 mt-1">支持多行文本，下单时按折叠/展开方式展示。</div>
              </div>

              <div>
                <label className={labelCl}>菜单图片（多张，本地上传，存为 base64 data URL）</label>
                <div className="flex items-center gap-2">
                  <button type="button" className={btnGhost} onClick={() => fileInputRef.current?.click()}>
                    <ImageIcon size={14} /> 选择图片
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={e => handlePickImages(e.target.files)}
                  />
                  <span className="text-xs text-gray-400">单图 ≤ 3MB，建议压缩后上传</span>
                </div>
                {Array.isArray(editing.data.image_urls) && editing.data.image_urls.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-2 p-2 bg-gray-50 border border-gray-200 rounded">
                    {editing.data.image_urls.map((u, i) => (
                      <div key={i} className="relative">
                        <img src={u} alt={`图${i + 1}`} className="h-20 w-20 object-cover rounded border border-gray-200" />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                          title="移除"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCl}>排序（数字越小越靠前）</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={Number(editing.data.sort_order ?? 100)}
                    onChange={e => { editing.data.sort_order = Number(e.target.value); bumpEditing(); }}
                  />
                </div>
                <div>
                  <label className={labelCl}>状态</label>
                  <select
                    className={inputCls}
                    value={String(Number(editing.data.status ?? 1) === 1 ? 1 : 0)}
                    onChange={e => { editing.data.status = Number(e.target.value); bumpEditing(); }}
                  >
                    <option value="1">启用</option>
                    <option value="0">禁用</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <AlertCircle size={14} />
                图片以 base64 形式存数据库（无需额外上传服务），单模板建议总图片大小 ≤ 5MB，避免数据库行宽膨胀。
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2 shrink-0">
              <button className={btnGhost} onClick={() => setEditing(null)}>取消</button>
              <button className={btnGold} disabled={saving} onClick={handleSave}>
                {saving ? <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" /> : null}
                <Save size={14} /> 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
