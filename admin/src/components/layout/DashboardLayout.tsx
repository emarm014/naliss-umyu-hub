import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';
import { useAdminDataStore } from '../../store/adminData.store';
import { useAuthStore } from '../../store/auth.store';
import { supabase } from '../../lib/supabase';
import { getFirstAccessibleRoute } from '../../utils/access';
import { useShallow } from 'zustand/react/shallow';

export default function DashboardLayout() {
  const { syncAll, subscribe, unsubscribe } = useAdminDataStore(
    useShallow((state) => ({
      syncAll: state.syncAll,
      subscribe: state.subscribe,
      unsubscribe: state.unsubscribe,
    }))
  );
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, permissions, isAdminOrModerator, signOut } = useAuthStore();

  useEffect(() => {
    if (isAdminOrModerator) {
      syncAll(false);
      subscribe();
      return () => {
        unsubscribe();
      };
    }
  }, [isAdminOrModerator]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleOnline = () => { syncAll(true); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncAll]);

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
