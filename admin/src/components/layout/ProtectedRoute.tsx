import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import LoadingSpinner from '../ui/LoadingSpinner';

export default function ProtectedRoute() {
  const { user, profile, permissions, isAdminOrModerator, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user || !isAdminOrModerator) {
    return <Navigate to="/login" replace />;
  }

  // Moderator landing: redirect from super_admin-only routes to first accessible page
  // NOTE: /lecturers and /executives are super_admin-only — never redirect moderators there
  if (profile?.role === 'moderator' && location.pathname === '/') {
    if (permissions?.can_manage_announcements) {
      return <Navigate to="/announcements" replace />;
    } else if (permissions?.can_manage_materials) {
      return <Navigate to="/materials" replace />;
    } else if (permissions?.can_manage_events) {
      return <Navigate to="/events" replace />;
    } else if (permissions?.can_manage_past_questions) {
      return <Navigate to="/past-questions" replace />;
    } else {
      return <Navigate to="/groups" replace />;
    }
  }

  return <Outlet />;
}
