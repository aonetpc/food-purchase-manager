import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import DailyPurchase from '@/pages/DailyPurchase';
import MonthlyAnalysis from '@/pages/MonthlyAnalysis';
import YearlyPrice from '@/pages/YearlyPrice';
import IngredientQuery from '@/pages/IngredientQuery';
import PurchaseEntry from '@/pages/PurchaseEntry';
import Login from '@/pages/Login';
import CategoryManager from '@/pages/CategoryManager';
import IngredientManager from '@/pages/IngredientManager';
import DepartmentManager from '@/pages/DepartmentManager';
import Profile from '@/pages/Profile';
import UserManager from '@/pages/UserManager';
import RoleManager from '@/pages/RoleManager';
import ProtectedRoute from '@/components/ProtectedRoute';
import ReimbursementManager from '@/pages/ReimbursementManager';
import WecomManager from '@/pages/WecomManager';
import WecomTest from '@/pages/WecomTest';
import WecomTestConfirmPage from '@/pages/WecomTest/TestConfirmPage';
import WecomConfirmPage from '@/pages/WecomTest/WecomConfirmPage';
import WarehouseConfirmPage from '@/pages/WecomTest/WarehouseConfirmPage';
import PurchaseConfirmPage from '@/pages/PurchaseConfirm';
import PositionManager from '@/pages/PositionManager';
import TempWorkerManager from '@/pages/TempWorkerManager';
import MobileHome from '@/pages/mobile/Home';
import MobileDaily from '@/pages/mobile/Daily';
import MobileYearly from '@/pages/mobile/Yearly';
import MobileQuery from '@/pages/mobile/Query';
import MobileMonthly from '@/pages/mobile/Monthly';
import MobileComingSoon from '@/pages/mobile/ComingSoon';
import TempLogin from '@/pages/temp/Login';
import TempCheckin from '@/pages/temp/Checkin';
import TempProfile from '@/pages/temp/Profile';
import TempAudit from '@/pages/TempAudit';
import TempAssessment from '@/pages/TempAssessment';
import TempStats from '@/pages/TempStats';
import MobileTempAudit from '@/pages/mobile/TempAudit';
import MobileTempAssessment from '@/pages/mobile/TempAssessment';
import MobileTempStats from '@/pages/mobile/TempStats';
import WarehouseManager from '@/pages/WarehouseManager';
import WarehousePurchase from '@/pages/WarehousePurchase';
import WarehousePurchaseCreate from '@/pages/WarehousePurchase/Create';
import InventoryManager from '@/pages/InventoryManager';
import StockMovement from '@/pages/StockMovement';
import SupplierReconciliation from '@/pages/SupplierReconciliation';
import ScanRequisition from '@/pages/ScanRequisition';
import ScanAudit from '@/pages/ScanAudit';
import ManagementReport from '@/pages/ManagementReport';
import StockTakeOperate from '@/pages/StockTakeOperate';

export default function App() {
  return (
    <Router>
      <Routes>
        {/* 手机端路由 - 独立于PC端Layout */}
        <Route path="/m" element={<MobileHome />} />
        <Route path="/m/daily" element={<MobileDaily />} />
        <Route path="/m/yearly" element={<MobileYearly />} />
        <Route path="/m/query" element={<MobileQuery />} />
        <Route path="/m/monthly" element={<MobileMonthly />} />

        {/* 外请人员微信端H5路由 - 独立于PC端Layout */}
        <Route path="/temp/login" element={<TempLogin />} />
        <Route path="/temp/checkin" element={<TempCheckin />} />
        <Route path="/temp/profile" element={<TempProfile />} />
        <Route path="/temp" element={<Navigate to="/temp/login" replace />} />

        {/* 扫码领料 - 独立页面，微信扫码进入 */}
        <Route path="/scan-requisition" element={<ScanRequisition />} />

        {/* 月末盘点 H5 - 企微卡片链接进入，token免登录 */}
        <Route path="/stock-take-operate" element={<StockTakeOperate />} />

        {/* 企微端审核管理路由 - 内部人员使用 */}
        <Route path="/m/temp-audit" element={<MobileTempAudit />} />
        <Route path="/m/temp-assessment" element={<MobileTempAssessment />} />
        <Route path="/m/temp-stats" element={<MobileTempStats />} />

        <Route path="/login" element={<Login />} />
        <Route path="/confirm/:id" element={<PurchaseConfirmPage />} />
        <Route path="/wecom-test-confirm/:id" element={<WecomTestConfirmPage />} />
        <Route path="/wecom-test-reject/:id" element={<WecomTestConfirmPage />} />
        <Route path="/wecom-confirm" element={<WecomConfirmPage />} />
        <Route path="/warehouse-confirm" element={<WarehouseConfirmPage />} />
        
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/daily" replace />} />
          <Route path="purchase-entry" element={
            <ProtectedRoute requiredPermission="action:entry:create">
              <PurchaseEntry />
            </ProtectedRoute>
          } />
          <Route path="daily" element={<DailyPurchase />} />
          <Route path="monthly" element={
            <ProtectedRoute requiredPermission="menu:monthly">
              <MonthlyAnalysis />
            </ProtectedRoute>
          } />
          <Route path="yearly" element={<YearlyPrice />} />
          <Route path="ingredients" element={<IngredientQuery />} />
          <Route path="categories" element={
            <ProtectedRoute requiredPermission="action:category:manage">
              <CategoryManager />
            </ProtectedRoute>
          } />
          <Route path="ingredient-manager" element={
            <ProtectedRoute requiredPermission="action:ingredient:manage">
              <IngredientManager />
            </ProtectedRoute>
          } />
          <Route path="departments" element={
            <ProtectedRoute requiredPermission="action:department:manage">
              <DepartmentManager />
            </ProtectedRoute>
          } />
          <Route path="profile" element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } />
          <Route path="users" element={
            <ProtectedRoute requiredPermission="action:user:manage">
              <UserManager />
            </ProtectedRoute>
          } />
          <Route path="roles" element={
            <ProtectedRoute requiredRole="admin">
              <RoleManager />
            </ProtectedRoute>
          } />
          <Route path="reimbursement" element={
            <ProtectedRoute requiredPermission="action:reimbursement:manage">
              <ReimbursementManager />
            </ProtectedRoute>
          } />
          <Route path="supplier-reconciliation" element={
            <ProtectedRoute requiredPermission="menu:supplier-reconciliation">
              <SupplierReconciliation />
            </ProtectedRoute>
          } />
          <Route path="warehouse" element={
            <ProtectedRoute requiredPermission="action:warehouse:manage">
              <WarehouseManager />
            </ProtectedRoute>
          } />
          <Route path="inventory" element={
            <ProtectedRoute requiredPermission="menu:inventory">
              <InventoryManager />
            </ProtectedRoute>
          } />
          <Route path="stock-movement" element={
            <ProtectedRoute requiredPermission="menu:stock-movement">
              <StockMovement />
            </ProtectedRoute>
          } />
          <Route path="scan-audit" element={
            <ProtectedRoute requiredPermission="menu:scan-audit">
              <ScanAudit />
            </ProtectedRoute>
          } />
          <Route path="management-report" element={
            <ProtectedRoute requiredPermission="menu:management-report">
              <ManagementReport />
            </ProtectedRoute>
          } />
          <Route path="warehouse-purchase" element={
            <ProtectedRoute requiredPermission="menu:warehouse-purchase">
              <WarehousePurchase />
            </ProtectedRoute>
          } />
          <Route path="warehouse-purchase/create" element={
            <ProtectedRoute requiredPermission="action:warehouse:create">
              <WarehousePurchaseCreate />
            </ProtectedRoute>
          } />
          <Route path="warehouse-purchase/edit/:id" element={
            <ProtectedRoute requiredPermission="action:warehouse:create">
              <WarehousePurchaseCreate />
            </ProtectedRoute>
          } />
          <Route path="wecom" element={
            <ProtectedRoute requiredRole="admin">
              <WecomManager />
            </ProtectedRoute>
          } />
          <Route path="wecom-test" element={
            <ProtectedRoute requiredRole="admin">
              <WecomTest />
            </ProtectedRoute>
          } />
          <Route path="temp-positions" element={
            <ProtectedRoute requiredPermission="action:temp-position:manage">
              <PositionManager />
            </ProtectedRoute>
          } />
          <Route path="temp-workers" element={
            <ProtectedRoute requiredPermission="action:temp-worker:manage">
              <TempWorkerManager />
            </ProtectedRoute>
          } />
          
          <Route path="temp-audit" element={
            <ProtectedRoute requiredPermission="menu:temp-audit">
              <TempAudit />
            </ProtectedRoute>
          } />
          <Route path="temp-assessment" element={
            <ProtectedRoute requiredPermission="menu:temp-assessment">
              <TempAssessment />
            </ProtectedRoute>
          } />
          <Route path="temp-stats" element={
            <ProtectedRoute requiredPermission="menu:temp-stats">
              <TempStats />
            </ProtectedRoute>
          } />
        </Route>
      </Routes>
    </Router>
  );
}
