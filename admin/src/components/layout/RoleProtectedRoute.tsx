import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { getFirstAccessibleRoute } from '../../utils/access';
import LoadingSpinner from '../ui/LoadingSpinner';
import type { User } from '../../types';

interface RoleProtectedRouteProps {
  minRole: 'super_admin' | 'moderator';
  permission?: keyof NonNullable<User['permissions']>;
}

export default function RoleProtectedRoute({ minRole, permission }: RoleProtectedRouteProps) {
  const { profile, permissions, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const userRole = profile?.role;

  // Access denied if no profile or role is insufficient
  // If minRole is super_admin, only super_admin can enter
  // If minRole is moderator, both super_admin and moderator can enter
  let hasAccess = 
    userRole === 'super_admin' || 
    (minRole === 'moderator' && userRole === 'moderator');

  if (hasAccess && userRole === 'moderator' && permission) {
    hasAccess = !!(permissions as any)?.[permission];
  }

  if (!hasAccess) {
    if (userRole === 'moderator') {
      return <Navigate to={getFirstAccessibleRoute(permissions)} replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
