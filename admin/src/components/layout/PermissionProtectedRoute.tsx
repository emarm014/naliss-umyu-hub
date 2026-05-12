import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import LoadingSpinner from '../ui/LoadingSpinner';

interface PermissionProtectedRouteProps {
  /** The permission key that must be true for moderators to access this route.
   *  Super admins always bypass this check. */
  permission: keyof NonNullable<ReturnType<typeof useAuthStore.getState>['permissions']>;
}

export default function PermissionProtectedRoute({ permission }: PermissionProtectedRouteProps) {
  const { profile, permissions, isLoading } = useAuthStore();

  // Wait for auth to resolve before making access decisions
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Super admins always have full access
  if (profile?.role === 'super_admin') return <Outlet />;

  // Moderators must have the specific permission flag set
  if (profile?.role === 'moderator') {
    if (permissions && permissions[permission]) return <Outlet />;
    return <Navigate to="/groups" replace />;
  }

  // Anyone else (shouldn't reach here due to ProtectedRoute) — redirect to login
  return <Navigate to="/login" replace />;
}
