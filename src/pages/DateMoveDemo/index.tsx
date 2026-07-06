import { useState } from 'react';
import { format, subDays, addDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar, Trash2, RefreshCw, CheckCircle2 } from 'lucide-react';

interface MockPurchaseItem {
  id: string;
  ingredientName: string;
  categoryName: string;
  categoryColor: string;
  purchaseUnit: string;
  purchaseQuantity: number;
  purchaseUnitPrice: number;
}

interface MockDayData {
  date: string;
  label: string;
  items: MockPurchaseItem[];
}

const generateMockData = (): MockDayData[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const categories = [
    { name: '蔬菜', color: '#22c55e' },
    { name: '肉类', color: '#ef4444' },
    { name: '水产海鲜', color: '#3b82f6' },
    { name: '水果', color: '#f97316' },
  ];

  const ingredients = [
    { name: '白菜', category: 0, unit: '公斤', quantity: 2, price: 5 },
    { name: '猪肉', category: 1, unit: '公斤', quantity: 1, price: 30 },
    { name: '虾', category: 2, unit: '公斤', quantity: 0.5, price: 60 },
    { name: '苹果', category: 3, unit: '斤', quantity: 5, price: 4 },
    { name: '土豆', category: 0, unit: '公斤', quantity: 3, price: 3 },
    { name: '牛肉', category: 1, unit: '公斤', quantity: 0.8, price: 55 },
  ];

  const result: MockDayData[] = [];
  
  for (let i = 2; i >= 0; i--) {
    const date = subDays(today, i);
    const dateStr = format(date, 'yyyy-MM-dd');
    const label = format(date, 'yyyy年MM月dd日 EEEE', { locale: zhCN });
    const shuffled = [...ingredients].sort(() => Math.random() - 0.5);
    const count = 3 + Math.floor(Math.random() * 3);
    const items: MockPurchaseItem[] = shuffled.slice(0, count).map((ing, idx) => ({
      id: `mock-${dateStr}-${idx}`,
      ingredientName: ing.name,
      categoryName: categories[ing.category].name,
      categoryColor: categories[ing.category].color,
      purchaseUnit: ing.unit,
      purchaseQuantity: ing.quantity,
      purchaseUnitPrice: ing.price,
    }));
    result.push({ date: dateStr, label, items });
  }
  
  return result;
};

export default function DateMoveDemo() {
  const [mockData, setMockData] = useState<MockDayData[]>(generateMockData);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState<MockPurchaseItem | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const currentData = mockData[selectedIndex];
  
  const totalAmount = currentData.items.reduce((sum, item) => {
    return sum + (item.purchaseUnitPrice * item.purchaseQuantity);
  }, 0);

  const handlePrevDay = () => {
    if (selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
  };

  const handleNextDay = () => {
    if (selectedIndex < mockData.length - 1) setSelectedIndex(selectedIndex + 1);
  };

  const handleMoveDate = (item: MockPurchaseItem) => {
    setMovingItem(item);
    setShowDatePicker(item.id);
  };

  const handleSelectDate = (targetDateStr: string) => {
    if (!movingItem) return;
    
    const targetIndex = mockData.findIndex(d => d.date === targetDateStr);
    if (targetIndex === -1 || targetIndex === selectedIndex) {
      setShowDatePicker(null);
      setMovingItem(null);
      return;
    }

    setMockData(prev => {
      const newData = [...prev];
      
      const sourceIndex = selectedIndex;
      const targetIdx = targetIndex;
      
      const sourceItems = [...newData[sourceIndex].items];
      const targetItems = [...newData[targetIdx].items];
      
      const itemIndex = sourceItems.findIndex(i => i.id === movingItem!.id);
      if (itemIndex === -1) return prev;
      
      const itemToMove = { ...sourceItems[itemIndex] };
      sourceItems.splice(itemIndex, 1);
      
      const existingIdx = targetItems.findIndex(i => i.ingredientName === itemToMove.ingredientName);
      if (existingIdx !== -1) {
        targetItems[existingIdx].purchaseQuantity += itemToMove.purchaseQuantity;
      } else {
        targetItems.push(itemToMove);
      }
      
      newData[sourceIndex] = { ...newData[sourceIndex], items: sourceItems };
      newData[targetIdx] = { ...newData[targetIdx], items: targetItems };
      
      return newData;
    });

    setShowSuccess(true);
    setShowDatePicker(null);
    setMovingItem(null);
    
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const handleReset = () => {
    setMockData(generateMockData());
    setSelectedIndex(0);
  };

  return (
    <div className="space-y-6">
      {showSuccess && (
        <div className="fixed top-4 right-4 z-50 bg-success-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-down">
          <CheckCircle2 size={20} />
          <span>日期调整成功！已合并相同食材数量</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-gray-800">采买清单录入 · 修改日期演示</h1>
          <p className="text-gray-500 mt-1">点击食材旁边的日历图标，可将该食材调整到其他日期</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={16} />
            <span>重置演示数据</span>
          </button>
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={handlePrevDay} disabled={selectedIndex === 0} className="p-2 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-30">
              <ChevronLeft size={18} />
            </button>
            <div className="px-4 py-1.5 min-w-[180px] text-center font-medium text-sm">{currentData.label}</div>
            <button onClick={handleNextDay} disabled={selectedIndex === mockData.length - 1} className="p-2 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-30">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">录入总金额</p>
              <p className="text-2xl font-bold mt-2 text-primary-600">¥{totalAmount.toFixed(2)}</p>
            </div>
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600">
              <span className="text-xl">💰</span>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">录入品类数</p>
              <p className="text-2xl font-bold mt-2 text-accent-600">{currentData.items.length} <span className="text-base font-normal text-gray-400">种</span></p>
            </div>
            <div className="w-12 h-12 bg-accent-100 rounded-xl flex items-center justify-center text-accent-600">
              <span className="text-xl">🥬</span>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 font-medium">演示说明</p>
              <p className="text-sm mt-2 text-gray-600">点击日历图标调整日期，相同食材自动合并</p>
            </div>
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-gray-600">
              <Calendar size={24} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">采买明细</h2>
          <span className="text-sm text-gray-500">共 {currentData.items.length} 项</span>
        </div>

        {currentData.items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <span className="text-5xl mb-3 block">📋</span>
            <p className="text-lg">还没有添加任何食材</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="data-table min-w-full">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">食材名称</th>
                  <th className="whitespace-nowrap">分类</th>
                  <th className="whitespace-nowrap text-right">采购单位</th>
                  <th className="whitespace-nowrap text-right">数量</th>
                  <th className="whitespace-nowrap text-right">单价(元)</th>
                  <th className="whitespace-nowrap text-right">金额(元)</th>
                  <th className="whitespace-nowrap text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {currentData.items.map(item => {
                  const amount = (item.purchaseUnitPrice * item.purchaseQuantity).toFixed(2);
                  return (
                    <tr key={item.id}>
                      <td className="font-medium text-gray-800 whitespace-nowrap">{item.ingredientName}</td>
                      <td>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.categoryColor }} />
                          {item.categoryName}
                        </span>
                      </td>
                      <td className="text-right">{item.purchaseUnit}</td>
                      <td className="text-right">{item.purchaseQuantity}</td>
                      <td className="text-right">{item.purchaseUnitPrice.toFixed(2)}</td>
                      <td className="text-right font-semibold text-gray-800">¥{amount}</td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleMoveDate(item)}
                            className="p-1.5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 rounded-md transition-colors"
                            title="修改日期"
                          >
                            <Calendar size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setMockData(prev => {
                                const newData = [...prev];
                                newData[selectedIndex] = {
                                  ...newData[selectedIndex],
                                  items: newData[selectedIndex].items.filter(i => i.id !== item.id)
                                };
                                return newData;
                              });
                            }}
                            className="p-1.5 text-gray-400 hover:text-danger-500 hover:bg-danger-50 rounded-md transition-colors"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td colSpan={5} className="text-right text-gray-600">合计</td>
                  <td className="text-right text-lg text-primary-600">¥{totalAmount.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showDatePicker && movingItem && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowDatePicker(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">调整日期</h3>
              <button onClick={() => setShowDatePicker(null)} className="p-1 hover:bg-gray-100 rounded-md">
                <span className="text-xl">×</span>
              </button>
            </div>
            <div className="p-5">
              <p className="text-gray-600 mb-4">
                将 <span className="font-medium text-primary-600">{movingItem.ingredientName}</span> 
                ({movingItem.purchaseQuantity} {movingItem.purchaseUnit}) 调整到：
              </p>
              <div className="space-y-2">
                {mockData.filter(d => d.date !== currentData.date).map((day, idx) => (
                  <button
                    key={day.date}
                    onClick={() => handleSelectDate(day.date)}
                    className="w-full p-4 border border-gray-200 rounded-xl hover:border-primary-300 hover:bg-primary-50 transition-all text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-800">{day.label}</p>
                        <p className="text-sm text-gray-500">
                          当前有 {day.items.length} 项食材
                          {day.items.some(i => i.ingredientName === movingItem?.ingredientName) && (
                            <span className="text-primary-500 ml-2">· 已包含此食材，数量将合并</span>
                          )}
                        </p>
                      </div>
                      <ChevronRight size={20} className="text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-4 text-center">
                提示：如果目标日期已有相同食材，数量会自动相加合并
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-5">
        <h3 className="font-medium text-gray-800 mb-3">演示操作步骤</h3>
        <ol className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center flex-shrink-0 text-xs">1</span>
            <span>选择一个日期，查看该日的采购清单</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center flex-shrink-0 text-xs">2</span>
            <span>点击某条食材旁边的 <Calendar size={14} className="inline" /> 日历图标</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center flex-shrink-0 text-xs">3</span>
            <span>在弹出的日期选择框中，选择目标日期</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center flex-shrink-0 text-xs">4</span>
            <span>观察效果：原日期的食材被移除，目标日期新增/合并了该食材</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
