import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import PageLoading from '@/components/PageLoading';
import { ToastProvider } from '@/components/Toast';

const DailyPurchase = lazy(() => import('@/pages/DailyPurchase'));
const MonthlyAnalysis = lazy(() => import('@/pages/MonthlyAnalysis'));
const YearlyPrice = lazy(() => import('@/pages/YearlyPrice'));
const IngredientQuery = lazy(() => import('@/pages/IngredientQuery'));
const PurchaseEntry = lazy(() => import('@/pages/PurchaseEntry'));
const Login = lazy(() => import('@/pages/Login'));
const CategoryManager = lazy(() => import('@/pages/CategoryManager'));
const IngredientManager = lazy(() => import('@/pages/IngredientManager'));
const DepartmentManager = lazy(() => import('@/pages/DepartmentManager'));
const Profile = lazy(() => import('@/pages/Profile'));
const UserManager = lazy(() => import('@/pages/UserManager'));
const RoleManager = lazy(() => import('@/pages/RoleManager'));
const ReimbursementManager = lazy(() => import('@/pages/ReimbursementManager'));
const WecomManager = lazy(() => import('@/pages/WecomManager'));
const WecomTest = lazy(() => import('@/pages/WecomTest'));
const WecomTestConfirmPage = lazy(() => import('@/pages/WecomTest/TestConfirmPage'));
const WecomConfirmPage = lazy(() => import('@/pages/WecomTest/WecomConfirmPage'));
const WarehouseConfirmPage = lazy(() => import('@/pages/WecomTest/WarehouseConfirmPage'));
const PurchaseConfirmPage = lazy(() => import('@/pages/PurchaseConfirm'));
const PositionManager = lazy(() => import('@/pages/PositionManager'));
const TempWorkerManager = lazy(() => import('@/pages/TempWorkerManager'));
const MobileHome = lazy(() => import('@/pages/mobile/Home'));
const MobileDaily = lazy(() => import('@/pages/mobile/Daily'));
const MobileYearly = lazy(() => import('@/pages/mobile/Yearly'));
const MobileQuery = lazy(() => import('@/pages/mobile/Query'));
const MobileMonthly = lazy(() => import('@/pages/mobile/Monthly'));
const MobileComingSoon = lazy(() => import('@/pages/mobile/ComingSoon'));
const TempLogin = lazy(() => import('@/pages/temp/Login'));
const TempCheckin = lazy(() => import('@/pages/temp/Checkin'));
const TempProfile = lazy(() => import('@/pages/temp/Profile'));
const TempAudit = lazy(() => import('@/pages/TempAudit'));
const TempAssessment = lazy(() => import('@/pages/TempAssessment'));
const TempStats = lazy(() => import('@/pages/TempStats'));
const MobileTempAudit = lazy(() => import('@/pages/mobile/TempAudit'));
const MobileTempAssessment = lazy(() => import('@/pages/mobile/TempAssessment'));
const MobileTempStats = lazy(() => import('@/pages/mobile/TempStats'));
const WarehouseManager = lazy(() => import('@/pages/WarehouseManager'));
const WarehousePurchase = lazy(() => import('@/pages/WarehousePurchase'));
const WarehousePurchaseCreate = lazy(() => import('@/pages/WarehousePurchase/Create'));
const InventoryManager = lazy(() => import('@/pages/InventoryManager'));
const StockMovement = lazy(() => import('@/pages/StockMovement'));
const SupplierReconciliation = lazy(() => import('@/pages/SupplierReconciliation'));
const ScanRequisition = lazy(() => import('@/pages/ScanRequisition'));
const ScanAudit = lazy(() => import('@/pages/ScanAudit'));
const ManagementReport = lazy(() => import('@/pages/ManagementReport'));
const StockTakeOperate = lazy(() => import('@/pages/StockTakeOperate'));
const PermissionManager = lazy(() => import('@/pages/PermissionManager'));
const BookingBoard = lazy(() => import('@/pages/BookingBoard'));

const pageLoad = <PageLoading />;

export default function App() {
  return (
    <ToastProvider>
    <Router>
      <Suspense fallback={pageLoad}>
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
                <Navigate to="/ingredient-manager#categories" replace />
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
                <Navigate to="/permission#users" replace />
              </ProtectedRoute>
            } />
            <Route path="roles" element={
              <ProtectedRoute requiredRole="admin">
                <Navigate to="/permission#roles" replace />
              </ProtectedRoute>
            } />
            <Route path="permission" element={
              <ProtectedRoute requiredPermission="action:user:manage">
                <PermissionManager />
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
            <Route path="booking-board" element={<BookingBoard />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
    </ToastProvider>
  );
}
