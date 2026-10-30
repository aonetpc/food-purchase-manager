/**
 * feat/223: 预订午餐/晚餐菜单 A4 打印
 * 实现思路与 DailyPurchase 的打印一致：临时挂载打印容器 + 隐藏其余节点，打印完自动清理。
 * 内容超出 A4 时由浏览器自动分页；正文按行切分，避免单行被截断。
 */

export interface BookingMenuPrintPayload {
  /** 标题，如「午餐菜单」 */
  title: string;
  customerName?: string;
  date?: string;
  time?: string;
  /** 人数/桌数展示，如「11人」「2桌 · 每桌10人」 */
  paxText?: string;
  /** 菜单正文（保留换行） */
  menuText?: string;
  /** 菜单图片（base64 或 URL），最多打印 4 张 */
  menuImages?: string[];
  /** 套餐模板名（可选，作为副标题） */
  templateName?: string;
}

const PRINT_ID = 'temp-menu-print-container';
const PRINT_STYLE_ID = 'temp-menu-print-style';
const BODY_CLASS = 'printing-menu-mode';

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 预加载图片，避免打印时图片尚未解码导致空白 */
function preloadImages(srcs: string[]): Promise<void> {
  return Promise.all(srcs.map(src => new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  }))).then(() => undefined);
}

function buildHtml(payload: BookingMenuPrintPayload, imageCount: number): string {
  const infoLine = [
    payload.customerName ? `客户：${escapeHtml(payload.customerName)}` : '',
    payload.date ? escapeHtml(payload.date) : '',
    payload.time ? escapeHtml(payload.time) : '',
    payload.paxText ? escapeHtml(payload.paxText) : '',
  ].filter(Boolean).join('　　');

  const templateLine = payload.templateName
    ? `<div style="margin-top:2mm;font-size:12px;color:#666;">${escapeHtml(payload.templateName)}</div>`
    : '';

  const body = payload.menuText
    ? `<div style="margin-top:8mm;font-size:14px;line-height:2;white-space:pre-wrap;text-align:center;color:#222;">${escapeHtml(payload.menuText)}</div>`
    : '';

  const images = imageCount > 0
    ? `<div style="margin-top:${body ? '6mm' : '10mm'};">${(payload.menuImages || []).slice(0, imageCount).map(src =>
        `<img src="${escapeHtml(src)}" style="display:block;max-width:100%;max-height:110mm;object-fit:contain;margin:4mm auto;" />`
      ).join('')}</div>`
    : '';

  const printedAt = new Date().toLocaleString('zh-CN', { hour12: false });

  return `
    <div style="width:186mm;margin:0 auto;text-align:center;color:#111;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">
      <div style="font-size:24px;font-weight:700;letter-spacing:4px;padding-bottom:4mm;border-bottom:1px solid #d1d5db;">${escapeHtml(payload.title)}</div>
      ${templateLine}
      ${infoLine ? `<div style="margin-top:4mm;font-size:13px;color:#444;">${infoLine}</div>` : ''}
      ${body}
      ${images}
      <div style="margin-top:10mm;padding-top:3mm;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;">打印时间：${escapeHtml(printedAt)}</div>
    </div>
  `;
}

/**
 * 打印一张居中的 A4 菜单。
 * @returns true 表示已触发打印；false 表示无菜单内容或当前环境不支持
 */
export async function printBookingMenu(payload: BookingMenuPrintPayload): Promise<boolean> {
  const images = (payload.menuImages || []).filter(Boolean);
  if (!payload.menuText && images.length === 0) return false;
  if (typeof window === 'undefined' || typeof window.print !== 'function') return false;

  await preloadImages(images);

  // 清理上一次残留
  document.getElementById(PRINT_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();

  const container = document.createElement('div');
  container.id = PRINT_ID;
  container.innerHTML = buildHtml(payload, images.length);
  document.body.appendChild(container);

  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    #${PRINT_ID} { position: fixed; left: -10000px; top: 0; }
    @page { size: A4 portrait; margin: 12mm; }
    @media print {
      html, body { margin: 0; padding: 0; background: #fff; }
      body.${BODY_CLASS} > *:not(#${PRINT_ID}) { display: none !important; }
      #${PRINT_ID} { position: static; left: auto; }
      #${PRINT_ID} img { page-break-inside: avoid; }
    }
  `;
  document.head.appendChild(style);
  document.body.classList.add(BODY_CLASS);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove(BODY_CLASS);
    container.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  try {
    window.print();
  } finally {
    // Chrome/Edge 下 print() 会阻塞到打印框关闭；Safari/部分企微内核不阻塞，用兜底定时清理
    setTimeout(cleanup, 10_000);
  }
  return true;
}
