import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function DesktopRedirect() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        navigate('/h/checkup-templates', { replace: true });
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [navigate]);

  const forceOpen = () => {
    navigate('/h/checkup-templates', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-4xl shadow-lg shadow-blue-500/30 mb-6">
          📱
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">体检配单 · 移动端功能</h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">
          体检配单页面是专为手机优化的 H5 页面，方便您在客户现场快速配置方案、生成分享链接。
          <br /><br />
          请使用手机扫码或在手机浏览器中访问。
        </p>
        
        <div className="bg-blue-50 rounded-2xl p-4 mb-6 text-left">
          <div className="text-xs font-semibold text-blue-800 mb-2">💡 如何使用：</div>
          <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside leading-relaxed">
            <li>在企微工作台中找到「体检配单」应用</li>
            <li>点击进入即可在手机上操作</li>
            <li>也可以将此页面链接发到手机上打开</li>
          </ol>
        </div>

        <button 
          onClick={forceOpen}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-lg shadow-blue-600/30 hover:shadow-xl transition-all"
        >
          仍在当前窗口打开
        </button>
        <button 
          onClick={() => navigate(-1)}
          className="mt-3 w-full h-10 rounded-2xl text-gray-500 text-sm hover:text-gray-700"
        >
          返回上一页
        </button>
      </div>
    </div>
  );
}
