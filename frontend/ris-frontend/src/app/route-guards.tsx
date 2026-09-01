import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import type { Role } from '@/lib/constants';

interface ProtectedRouteProps {
  children: React.ReactElement;
}

/** Redirects unauthenticated users to /login, preserving the intended destination. */
export function ProtectedRoute({ children }: ProtectedRouteProps): React.ReactElement {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

/** Redirects authenticated users away from auth pages (login, register, etc.). */
export function PublicRoute({ children }: ProtectedRouteProps): React.ReactElement {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

interface RoleRouteProps {
  children: React.ReactElement;
  allowed: Role[];
  fallback?: React.ReactElement;
}

/** Shows AccessDeniedPage if the user's role is not in the allowed list. */
export function RoleRoute({ children, allowed, fallback }: RoleRouteProps): React.ReactElement {
  const { role } = useAuthStore();

  if (!role || !allowed.includes(role)) {
    if (fallback) return fallback;
    return <Navigate to="/access-denied" replace />;
  }
  return children;
}
