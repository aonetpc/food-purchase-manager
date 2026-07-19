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
import MobileHome from '@/pages/mobile/Home';
import MobileComingSoon from '@/pages/mobile/ComingSoon';

export default function App() {
  return (
    <Router>
      <Routes>
        {/* 手机端路由 - 独立于PC端Layout */}
        <Route path="/m" element={<MobileHome />} />
        <Route path="/m/daily" element={<MobileComingSoon title="今日采购" />} />
        <Route path="/m/yearly" element={<MobileComingSoon title="年度均价" />} />
        <Route path="/m/query" element={<MobileComingSoon title="食材查询" />} />
        <Route path="/m/monthly" element={<MobileComingSoon title="月度分析" />} />

        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/daily" replace />} />
          <Route path="purchase-entry" element={
            <ProtectedRoute requiredRole="admin">
              <PurchaseEntry />
            </ProtectedRoute>
          } />
          <Route path="daily" element={<DailyPurchase />} />
          <Route path="monthly" element={
            <ProtectedRoute requiredRole={['admin', 'finance', 'boss']}>
              <MonthlyAnalysis />
            </ProtectedRoute>
          } />
          <Route path="yearly" element={<YearlyPrice />} />
          <Route path="ingredients" element={<IngredientQuery />} />
          <Route path="categories" element={
            <ProtectedRoute requiredRole="admin">
              <CategoryManager />
            </ProtectedRoute>
          } />
          <Route path="ingredient-manager" element={
            <ProtectedRoute requiredRole="admin">
              <IngredientManager />
            </ProtectedRoute>
          } />
          <Route path="departments" element={
            <ProtectedRoute requiredRole="admin">
              <DepartmentManager />
            </ProtectedRoute>
          } />
          <Route path="profile" element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } />
          <Route path="users" element={
            <ProtectedRoute requiredRole="admin">
              <UserManager />
            </ProtectedRoute>
          } />
          <Route path="reimbursement" element={
            <ProtectedRoute requiredRole="admin">
              <ReimbursementManager />
            </ProtectedRoute>
          } />
          <Route path="wecom" element={
            <ProtectedRoute requiredRole="admin">
              <WecomManager />
            </ProtectedRoute>
          } />
          <Route path="confirm/:id" element={<PurchaseConfirmPage />} />
        </Route>
      </Routes>
    </Router>
  );
}
