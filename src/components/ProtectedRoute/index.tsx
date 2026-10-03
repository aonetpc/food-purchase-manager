import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, type UserRole } from '@/store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole | UserRole[];
  requiredPermission?: string;
  requireAuth?: boolean;
}

export default function ProtectedRoute({
  children,
  requiredRole,
  requiredPermission,
  requireAuth = true,
}: ProtectedRouteProps) {
  const { user, isAdmin, hasRole, hasPermission } = useAuthStore();
  const location = useLocation();

  if (requireAuth && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole === 'admin' && !isAdmin()) {
    return <Navigate to="/daily" replace />;
  }

  if (Array.isArray(requiredRole)) {
    // 多角色用户：只要拥有其中任意一个角色即可访问
    const hasAccess = requiredRole.some(r => hasRole(r as UserRole));
    if (!hasAccess) {
      return <Navigate to="/daily" replace />;
    }
  }

  if (requiredPermission && !hasPermission(requiredPermission) && !isAdmin()) {
    return <Navigate to="/daily" replace />;
  }

  return <>{children}</>;
}
