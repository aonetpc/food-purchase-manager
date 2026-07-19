import { useNavigate } from 'react-router-dom';

/**
 * 手机端功能页面占位组件
 * 后续逐步替换为实际的手机端页面
 */
export default function MobileComingSoon({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/m')} className="p-1">
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex flex-col items-center justify-center py-24 px-6">
        <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-green-200 rounded-3xl flex items-center justify-center text-4xl mb-6">
          🚧
        </div>
        <h2 className="text-xl font-bold text-gray-700 mb-2">{title}</h2>
        <p className="text-gray-400 text-center text-sm leading-relaxed">
          手机端页面正在开发中<br />
          即将上线，敬请期待
        </p>
        <button
          onClick={() => navigate('/m')}
          className="mt-8 px-6 py-2.5 bg-green-500 text-white rounded-xl font-medium active:scale-95 transition-transform"
        >
          返回首页
        </button>
      </div>
    </div>
  );
}
