import { Loader2 } from 'lucide-react';

export default function PageLoading({ text = '页面加载中' }: { text?: string }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-gray-500">
      <Loader2 className="animate-spin text-primary-500" size={36} />
      <span className="text-sm">{text}...</span>
    </div>
  );
}
