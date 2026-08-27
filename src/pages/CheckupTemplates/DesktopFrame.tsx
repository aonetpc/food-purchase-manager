import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Smartphone } from 'lucide-react';
import CheckupApp from './H5App';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * 体检配单 PC 桌面端全屏容器
 * - PC 端：fixed inset-0 全屏展示 H5App，顶部带返回按钮 + 标题
 * - 移动端：fixed inset-0 全屏展示 H5App，保持原移动端体验
 * 统一方案：通过路由内嵌 + 全屏覆盖，解决 DesktopRedirect 点击后无法返回的问题。
 */
export default function CheckupDesktopFrame() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');

  // 移动端：全屏展示 H5App，不加桌面框架
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[60] bg-gray-50">
        <CheckupApp />
      </div>
    );
  }

  // PC 端：全屏展示 H5App + 返回按钮 + 标题栏
  // z-[60] 覆盖 Layout 的顶栏(z-50) 和 侧边栏(z-40)，避免被遮挡
  return (
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 flex items-center px-4 h-14 shrink-0 shadow-sm">
        <button
          onClick={() => navigate('/checkup-templates')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-700 hover:bg-gray-100 text-sm font-medium"
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="flex items-center gap-2 ml-3">
          <Smartphone size={16} className="text-emerald-600" />
          <span className="font-semibold text-gray-800">体检配单</span>
          <span className="text-xs text-gray-400">· 移动端功能（PC 预览）</span>
        </div>
        <div className="ml-auto text-xs text-gray-400">
          建议在手机端使用 · 也可点击浏览器后退
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <CheckupApp />
      </div>
    </div>
  );
}
