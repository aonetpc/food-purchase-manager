import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, type UserRole } from '@/store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole | UserRole[];
  requireAuth?: boolean;
}

export default function ProtectedRoute({
  children,
  requiredRole,
  requireAuth = true,
}: ProtectedRouteProps) {
  const { user, isAdmin, canViewMonthly } = useAuthStore();
  const location = useLocation();

  if (requireAuth && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole === 'admin' && !isAdmin()) {
    return <Navigate to="/daily" replace />;
  }

  if (Array.isArray(requiredRole)) {
    const hasAccess = requiredRole.includes(user?.role as UserRole);
    if (!hasAccess) {
      return <Navigate to="/daily" replace />;
    }
  }

  return <>{children}</>;
}
