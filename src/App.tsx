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
import ProtectedRoute from '@/components/ProtectedRoute';
import ReimbursementManager from '@/pages/ReimbursementManager';
import WecomManager from '@/pages/WecomManager';
import PurchaseConfirmPage from '@/pages/PurchaseConfirm';
import PositionManager from '@/pages/PositionManager';
import TempWorkerManager from '@/pages/TempWorkerManager';
import AuditorManager from '@/pages/AuditorManager';
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

        {/* 企微端审核管理路由 - 内部人员使用 */}
        <Route path="/m/temp-audit" element={<MobileTempAudit />} />
        <Route path="/m/temp-assessment" element={<MobileTempAssessment />} />
        <Route path="/m/temp-stats" element={<MobileTempStats />} />

        <Route path="/login" element={<Login />} />
        <Route path="/confirm/:id" element={<PurchaseConfirmPage />} />
        
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
          <Route path="reimbursement" element={
            <ProtectedRoute requiredPermission="action:reimbursement:manage">
              <ReimbursementManager />
            </ProtectedRoute>
          } />
          <Route path="wecom" element={
            <ProtectedRoute requiredRole="admin">
              <WecomManager />
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
          <Route path="temp-auditors" element={
            <ProtectedRoute requiredPermission="action:temp-auditor:manage">
              <AuditorManager />
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
