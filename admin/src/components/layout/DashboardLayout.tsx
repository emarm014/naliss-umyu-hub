import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';
import { useAdminDataStore } from '../../store/adminData.store';
import { useAuthStore } from '../../store/auth.store';
import { supabase } from '../../lib/supabase';
import { useShallow } from 'zustand/react/shallow';
import { runtimeCoordinator } from '../../lib/runtime/coordinator';

export default function DashboardLayout() {
  const { syncAll, subscribe, unsubscribe, resubscribe } = useAdminDataStore(
    useShallow((state) => ({
      syncAll: state.syncAll,
      subscribe: state.subscribe,
      unsubscribe: state.unsubscribe,
      resubscribe: state.resubscribe,
    }))
  );
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, permissions, isAdminOrModerator, signOut } = useAuthStore();

  useEffect(() => {
    if (isAdminOrModerator) {
      runtimeCoordinator.initialize();
      syncAll(false);
      subscribe();
      return () => {
        unsubscribe();
        runtimeCoordinator.shutdown();
      };
    }
  }, [isAdminOrModerator]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleOnline = () => { resubscribe(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [resubscribe]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`self-status:${profile.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users',
        filter: `id=eq.${profile.id}`,
      }, (payload) => {
        const updated = payload.new as { status: string; suspended_until: string | null };
        if (updated.status === 'banned' || updated.status === 'graduated') { signOut(); return; }
        if (updated.status === 'suspended') {
          const until = updated.suspended_until ? new Date(updated.suspended_until) : null;
          if (!until || until > new Date()) signOut();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, signOut]);

  useEffect(() => {
    if (profile?.role === 'moderator' && location.pathname === '/') {
      const getFirstAccessibleRoute = (perms: any) => {
        if (!perms) return '/login';
        if (perms.can_manage_announcements) return '/announcements';
        if (perms.can_manage_materials) return '/materials';
        if (perms.can_manage_past_questions) return '/past-questions';
        if (perms.can_manage_students) return '/students';
        if (perms.can_manage_groups) return '/groups';
        if (perms.can_manage_group_media) return '/group-media';
        if (perms.can_manage_storage) return '/storage';
        if (perms.can_manage_messaging) return '/messaging';
        if (perms.can_manage_security) return '/security';
        if (perms.can_manage_archives) return '/archive';
        if (perms.can_manage_news) return '/news';
        if (perms.can_manage_events) return '/events';
        return '/login';
      };
      navigate(getFirstAccessibleRoute(permissions), { replace: true });
    }
  }, [profile?.role, permissions, location.pathname, navigate]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Desktop sidebar — hidden on mobile */}
      <Sidebar />

      {/* Main content area */}
      <div className="lg:pl-64">
        <Header />
        {/* pb-24 on mobile = space for bottom nav bar */}
        <main className="py-4 px-3 sm:py-6 sm:px-6 lg:px-8 pb-24 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation — hidden on desktop */}
      <BottomNav />
    </div>
  );
}
