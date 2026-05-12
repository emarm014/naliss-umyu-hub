import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import LoadingSpinner from '../ui/LoadingSpinner';

interface RoleProtectedRouteProps {
  minRole: 'super_admin' | 'moderator';
}

export default function RoleProtectedRoute({ minRole }: RoleProtectedRouteProps) {
  const { profile, isLoading } = useAuthStore();

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
  const hasAccess = 
    userRole === 'super_admin' || 
    (minRole === 'moderator' && userRole === 'moderator');

  if (!hasAccess) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
