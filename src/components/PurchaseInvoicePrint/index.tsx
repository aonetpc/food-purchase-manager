import { type PurchaseItem } from '@/store/purchaseStore';

interface DepartmentData {
  name: string;
  items: PurchaseItem[];
}

interface PrintInvoiceProps {
  date: string;
  departmentName?: string;
  items?: PurchaseItem[];
  departments?: DepartmentData[];
  showPrintButton?: boolean;
}

const PAGE_ROWS = 12;

const formatCurrency = (amount: number) => {
  return amount.toFixed(2);
};

const toChineseMoney = (amount: number): string => {
  const cnNums = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const cnIntRadice = ['', '拾', '佰', '仟'];
  const cnIntUnits = ['', '万', '亿', '兆'];
  const cnDecUnits = ['角', '分', '毫', '厘'];
  const cnInteger = '整';
  const cnIntLast = '元';
  const maxNum = 999999999999999.9999;

  if (amount === 0) return '零元整';
  if (amount > maxNum) return '超出最大转换金额';

  amount = Math.round(amount * 100) / 100;
  const integerNum = Math.floor(amount);
  const decimalNum = Math.round((amount - integerNum) * 100);
  let chineseStr = '';

  if (integerNum > 0) {
    let zeroCount = 0;
    const IntLen = integerNum.toString().length;
    for (let i = 0; i < IntLen; i++) {
      const n = integerNum.toString().charAt(i);
      const p = IntLen - i - 1;
      const q = p / 4;
      const m = p % 4;
      if (n === '0') {
        zeroCount++;
      } else {
        if (zeroCount > 0) {
          chineseStr += cnNums[0];
        }
        zeroCount = 0;
        chineseStr += cnNums[parseInt(n)] + cnIntRadice[m];
      }
      if (m === 0 && zeroCount < 4) {
        chineseStr += cnIntUnits[q];
      }
    }
    chineseStr += cnIntLast;
  }

  if (decimalNum > 0) {
    const decLen = decimalNum.toString().length;
    for (let i = 0; i < decLen; i++) {
      const n = decimalNum.toString().charAt(i);
      chineseStr += cnNums[Number(n)] + cnDecUnits[i];
    }
  } else {
    chineseStr += cnInteger;
  }

  return chineseStr;
};

const InvoicePage = ({ date, departmentName, items, pageIndex, totalPages, isLast }: {
  date: string;
  departmentName: string;
  items: PurchaseItem[];
  pageIndex: number;
  totalPages: number;
  isLast: boolean;
}) => {
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const totalItems = items.length;

  const getPageItems = (idx: number) => {
    const start = idx * PAGE_ROWS;
    const end = start + PAGE_ROWS;
    return items.slice(start, end);
  };

  const pageItems = getPageItems(pageIndex);

  return (
    <div key={`${departmentName}-${pageIndex}`} className={`print-page ${isLast ? 'last-page' : ''}`}>
      <div className="invoice-header">
        <h1 className="invoice-title">华医食材采购入库单{pageIndex > 0 ? '（续）' : ''}</h1>
        <div className="invoice-info">
          <div className="info-left">
            <span className="label">日期：</span><span className="value">{date}</span>
          </div>
          <div className="info-right">
            <span className="label">部门：</span><span className="value">{departmentName}</span>
          </div>
        </div>
        <div className="invoice-info">
          <div className="info-left">
            <span className="label">单据编号：</span><span className="value">RK-{date.replace(/-/g, '')}-001</span>
          </div>
        </div>
      </div>

      <table className="invoice-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>食材名称</th>
            <th>分类</th>
            <th>单位</th>
            <th>数量</th>
            <th>金额</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((item, idx) => (
            <tr key={item.id}>
              <td>{pageIndex * PAGE_ROWS + idx + 1}</td>
              <td>{item.ingredientName}</td>
              <td>{item.categoryName}</td>
              <td>{item.purchaseUnit}</td>
              <td>{item.purchaseQuantity}</td>
              <td>{formatCurrency(item.amount)}</td>
            </tr>
          ))}
          {pageItems.length < PAGE_ROWS && Array.from({ length: PAGE_ROWS - pageItems.length }).map((_, idx) => (
            <tr key={`empty-${departmentName}-${pageIndex}-${idx}`} className="empty-row">
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-total">
        <div className="total-left">
          <span className="label">合计：共</span><span className="value">{totalItems}</span><span className="label">项</span>
        </div>
        <div className="total-right">
          <span className="label">金额合计：</span><span className="value">¥{formatCurrency(totalAmount)}</span>
        </div>
      </div>
      <div className="invoice-uppercase">
        <span className="label">大写金额：</span><span className="value">{toChineseMoney(totalAmount)}</span>
      </div>

      <div className="invoice-signature">
        <div className="signature-item">
          <span className="label">验收人签字：</span>
          <span className="line"></span>
        </div>
        <div className="signature-item">
          <span className="label">部门负责人签字：</span>
          <span className="line"></span>
        </div>
        <div className="signature-item">
          <span className="label">备注：</span>
          <span className="line"></span>
        </div>
      </div>

      <div className="invoice-page">
        第 {pageIndex + 1} 页 / 共 {totalPages} 页
      </div>
    </div>
  );
};

export default function PurchaseInvoicePrint({ date, departmentName, items, departments, showPrintButton = true }: PrintInvoiceProps) {
  const deptList: DepartmentData[] = departments || (departmentName && items ? [{ name: departmentName, items }] : []);

  return (
    <div className="print-invoice-container">
      {deptList.map((dept, deptIndex) => {
        const pages = Math.ceil(dept.items.length / PAGE_ROWS);
        const isLastDept = deptIndex === deptList.length - 1;
        return Array.from({ length: pages }).map((_, pageIndex) => (
          <InvoicePage
            key={`${dept.name}-${pageIndex}`}
            date={date}
            departmentName={dept.name}
            items={dept.items}
            pageIndex={pageIndex}
            totalPages={pages}
            isLast={isLastDept && pageIndex === pages - 1}
          />
        ));
      })}

      {showPrintButton && (
        <div className="no-print print-controls">
          <button onClick={() => window.print()} className="btn-primary">
            打印入库单
          </button>
        </div>
      )}

      <style>{`
        .print-invoice-container {
          max-width: 241mm;
          margin: 0 auto;
          padding: 10mm;
          font-family: 'SimSun', '宋体', serif;
        }

        .print-page {
          width: 225mm;
          min-height: 140mm;
          margin-bottom: 10mm;
          padding: 5mm 5mm;
          border: 1px solid #ccc;
          box-sizing: border-box;
        }

        .invoice-header {
          text-align: center;
          margin-bottom: 2mm;
        }

        .invoice-title {
          font-size: 14px;
          font-weight: bold;
          margin: 0 0 1.5mm 0;
          color: #333;
        }

        .invoice-info {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.8mm;
          font-size: 8px;
        }

        .info-left, .info-right {
          display: flex;
          align-items: center;
        }

        .invoice-info .label {
          color: #666;
        }

        .invoice-info .value {
          font-weight: normal;
          color: #333;
          margin-left: 1.5mm;
        }

        .invoice-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8px;
          margin-bottom: 1.5mm;
          table-layout: fixed;
        }

        .invoice-table th, .invoice-table td {
          border: 1px solid #999;
          padding: 0.5mm 1mm;
          text-align: center;
          vertical-align: middle;
          height: 4mm;
          line-height: 1.2;
          box-sizing: border-box;
        }

        .invoice-table th {
          background-color: #f5f5f5;
          font-weight: bold;
        }

        .invoice-table td:first-child {
          width: 10%;
        }

        .invoice-table td:nth-child(2) {
          width: 28%;
          text-align: left;
        }

        .invoice-table td:nth-child(3) {
          width: 15%;
          text-align: left;
        }

        .invoice-table td:nth-child(4) {
          width: 10%;
        }

        .invoice-table td:nth-child(5) {
          width: 17%;
        }

        .invoice-table td:nth-child(6) {
          width: 20%;
        }

        .empty-row td {
          border-top: 1px solid #999;
          border-bottom: 1px solid #999;
        }

        .invoice-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2mm;
          font-size: 9px;
        }

        .total-left, .total-right {
          display: flex;
          align-items: center;
        }

        .invoice-total .label {
          color: #666;
        }

        .invoice-total .value {
          font-weight: bold;
          color: #333;
          margin: 0 2mm;
        }

        .invoice-uppercase {
          margin-bottom: 2mm;
          font-size: 9px;
        }

        .invoice-uppercase .label {
          color: #666;
        }

        .invoice-uppercase .value {
          font-weight: bold;
          color: #333;
          margin-left: 2mm;
        }

        .invoice-signature {
          display: flex;
          justify-content: space-between;
          margin-bottom: 2mm;
          font-size: 9px;
        }

        .signature-item {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .signature-item .label {
          color: #666;
          white-space: nowrap;
        }

        .signature-item .line {
          flex: 1;
          border-bottom: 1px solid #333;
          margin-left: 2mm;
          max-width: 30mm;
        }

        .invoice-page {
          text-align: center;
          font-size: 8px;
          color: #666;
          margin-top: 1mm;
        }

        .print-controls {
          text-align: center;
          margin-top: 20px;
          padding: 20px;
          background: #f5f5f5;
          border: 1px solid #ddd;
        }

        @media print {
          @page {
            size: 241mm 140mm;
            margin: 0;
          }

          body {
            background: white !important;
            font-size: 12px !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .no-print {
            display: none !important;
          }

          .print-page {
            border: none;
            margin: 0;
            padding: 5mm 5mm;
            width: 241mm;
            min-height: 140mm;
            page-break-after: always;
          }

          .print-page.last-page {
            page-break-after: auto;
          }

          .print-invoice-container {
            padding: 0;
            margin: 0;
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
}