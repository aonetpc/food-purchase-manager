import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { RotateCcw } from 'lucide-react';

export interface SignatureCanvasHandle {
  clear: () => void;
  setSignature: (dataUrl: string | null) => void;
  toDataURL: () => string | null;
}

interface SignatureCanvasProps {
  /** 签字变化回调：dataUrl(base64 PNG) 或 null（清除后） */
  onChange?: (dataUrl: string | null) => void;
  /** 初始值：用于读取上次签字并回填，可动态切换 */
  initialValue?: string | null;
  /** 高度（px，默认 140） */
  height?: number;
  /** 只读模式：只展示不允许编辑，同时隐藏"清除重签" */
  readOnly?: boolean;
  /** 签字区提示文案 */
  placeholder?: string;
  className?: string;
}

/**
 * 手写签名画布组件
 *
 * 与采购入库签字流程完全对齐：
 *   - 支持触屏（touchstart/move/end）和鼠标
 *   - DPR 自适应，避免模糊
 *   - 提供 clear/setSignature/toDataURL 命令式 API（通过 ref）
 *
 * 示例：
 *   const sigRef = useRef<SignatureCanvasHandle>(null);
 *   <SignatureCanvas ref={sigRef} onChange={d => setSig(d)} initialValue={savedSig} />
 */
export const SignatureCanvas = forwardRef<SignatureCanvasHandle, SignatureCanvasProps>(function SignatureCanvas(
  { onChange, initialValue, height = 140, readOnly = false, placeholder = '✍️ 请在此处签名', className = '' },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const initializedRef = useRef(false);

  // 初始化画布 DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    // 若 rect.width 为 0（容器未渲染），用 canvas.width 作为后备
    const w = rect.width || canvas.clientWidth || 300;
    const h = rect.height || canvas.clientHeight || height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    initializedRef.current = true;
    // 若提供了 initialValue，初始加载
    if (initialValue) {
      loadSignatureImage(initialValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当 initialValue 变化时（用户点击"读取上次签字"），回填
  useEffect(() => {
    if (!initialValue) return;
    loadSignatureImage(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  // 把 base64 PNG 画到 canvas 上（用于复用/只读显示）
  const loadSignatureImage = (dataUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      // 清空再按 rect 比例缩放绘制
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      // 目标绘制区域：在 CSS 像素尺寸里等比缩放居中
      const targetW = canvas.width / dpr;
      const targetH = canvas.height / dpr;
      const ratio = Math.min(targetW / img.width, targetH / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const x = (targetW - w) / 2;
      const y = (targetH - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      setHasSignature(true);
      onChange?.(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  };

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = () => {
    if (readOnly) return;
    if (isDrawing && hasSignature) {
      const canvas = canvasRef.current;
      if (canvas) {
        onChange?.(canvas.toDataURL('image/png'));
      }
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasSignature(false);
    onChange?.(null);
  };

  useImperativeHandle(ref, () => ({
    clear: clearSignature,
    setSignature: (dataUrl) => {
      if (!dataUrl) {
        clearSignature();
      } else {
        loadSignatureImage(dataUrl);
      }
    },
    toDataURL: () => {
      const canvas = canvasRef.current;
      if (!canvas || !hasSignature) return null;
      return canvas.toDataURL('image/png');
    },
  }));

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {readOnly ? '签字图片' : '请在下方区域手写签名'}
        </span>
        {!readOnly && hasSignature && (
          <button
            type="button"
            onClick={clearSignature}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500"
          >
            <RotateCcw size={12} />
            清除重签
          </button>
        )}
      </div>
      <div
        className={`relative border-2 ${
          readOnly ? 'border-gray-200 bg-gray-50' : 'border-dashed border-gray-300 bg-white'
        } rounded-lg overflow-hidden`}
      >
        <canvas
          ref={canvasRef}
          width={300}
          height={height}
          style={{ height }}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          className="w-full touch-none select-none"
        />
        {!hasSignature && !readOnly && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm">{placeholder}</span>
          </div>
        )}
        {!hasSignature && readOnly && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm">暂无签字</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default SignatureCanvas;
