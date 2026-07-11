import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, lazy, Suspense } from 'react';
import { useAuthStore } from './store/auth.store';
import { useAdminDataStore } from './store/adminData.store';
import { NetworkBanner } from './components/NetworkBanner';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import DashboardLayout from './components/layout/DashboardLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import RoleProtectedRoute from './components/layout/RoleProtectedRoute';
import { OverlayManager } from './components/common/overlays';
import { queryClient } from './lib/queryClient';

// Resilient lazy load wrapper to handle chunk load failures gracefully (e.g. during new Vercel deployments).
// Uses a sessionStorage guard to prevent infinite reload loops — only one auto-reload is attempted per session.
function safeLazy<T extends React.ComponentType<any>>(importFn: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await importFn();
      // Successful load — clear any previous reload guard
      try { sessionStorage.removeItem('chunk_reload'); } catch { /* no-op */ }
      return mod;
    } catch (error) {
      // Guard: only auto-reload once per session to prevent infinite loops
      const alreadyReloaded = (() => { try { return sessionStorage.getItem('chunk_reload'); } catch { return null; } })();
      if (!alreadyReloaded) {
        try { sessionStorage.setItem('chunk_reload', '1'); } catch { /* no-op */ }
        window.location.reload();
      }
      // Return empty component to satisfy React.lazy contract (won't render — page is reloading or guard is active)
      return { default: (() => null) as unknown as T };
    }
  });
}

// Lazy load every admin page for chunk splitting and faster initial load
const LoginPage = safeLazy(() => import('./pages/LoginPage'));
const DashboardPage = safeLazy(() => import('./pages/DashboardPage'));
const StudentsPage = safeLazy(() => import('./pages/StudentsPage'));
const AnnouncementsPage = safeLazy(() => import('./pages/AnnouncementsPage'));
const EventsPage = safeLazy(() => import('./pages/EventsPage'));
const MaterialsPage = safeLazy(() => import('./pages/MaterialsPage'));
const MessagingPage = safeLazy(() => import('./pages/MessagingPage'));
const LecturersPage = safeLazy(() => import('./pages/LecturersPage'));
const ModeratorsPage = safeLazy(() => import('./pages/ModeratorsPage'));
const ExecutivesPage = safeLazy(() => import('./pages/ExecutivesPage'));
const GraduatesPage = safeLazy(() => import('./pages/GraduatesPage'));
const GroupsPage = safeLazy(() => import('./pages/GroupsPage'));
const CoursesPage = safeLazy(() => import('./pages/CoursesPage'));
const PastQuestionsPage = safeLazy(() => import('./pages/PastQuestionsPage'));
const ResourcesPage = safeLazy(() => import('./pages/ResourcesPage'));
const AnalyticsPage = safeLazy(() => import('./pages/AnalyticsPage'));
const SettingsPage = safeLazy(() => import('./pages/SettingsPage'));
const ActivityLogsPage = safeLazy(() => import('./pages/ActivityLogsPage'));
const GroupMediaPage = safeLazy(() => import('./pages/GroupMediaPage'));
const ModeratorStoragePage = safeLazy(() => import('./pages/ModeratorStoragePage'));
const SecurityPage = safeLazy(() => import('./pages/SecurityPage'));
const ArchiveManagementPage = safeLazy(() => import('./pages/ArchiveManagementPage'));
const NewsManagementPage = safeLazy(() => import('./pages/NewsManagementPage'));
const EventPoolManagementPage = safeLazy(() => import('./pages/EventPoolManagementPage'));

// Skeleton loader for Suspense fallback
function PageLoaderSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="w-12 h-12 border-4 border-primary-100 border-t-primary-950 rounded-full animate-spin" />
      <p className="text-xs font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading view...</p>
    </div>
  );
}

function App() {
  const { initialize } = useAuthStore();
  const { syncAll } = useAdminDataStore();

  useEffect(() => {
    const cleanupRef = { fn: undefined as (() => void) | void };
    // Fix: Add error handling to initialization
    initialize()
      .then((fn) => { cleanupRef.fn = fn; })
      .catch((error) => {
        console.error('Failed to initialize app:', error);
        // Optionally show error UI or retry
      });

    const handleFocus = () => {
      // Quiet background check to sync changes seamlessly without showing full-page blocking loaders
      const hasUser = useAuthStore.getState().user;
      if (hasUser) {
        syncAll(true);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleVisibility);

    return () => { 
      if (cleanupRef.fn) cleanupRef.fn(); 
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [initialize, syncAll]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Global network status banner */}
        <NetworkBanner />

        {/* PWA install prompt — appears after 3s if app is installable */}
        <PWAInstallPrompt />

        {/* Global Overlay Manager */}
        <OverlayManager />

        <Suspense fallback={<PageLoaderSkeleton />}>
          <Routes>
            {/* Public route */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected admin routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                {/* Super Admin Restricted Only */}
                <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/moderators" element={<ModeratorsPage />} />
                  <Route path="/graduates" element={<GraduatesPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/logs" element={<ActivityLogsPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/event-pools" element={<EventPoolManagementPage />} />
                </Route>

                {/* Students — gated by can_manage_students */}
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_students" />}>
                  <Route path="/students" element={<StudentsPage />} />
                </Route>

                {/* Granularly gated moderator pages */}
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_announcements" />}>
                  <Route path="/announcements" element={<AnnouncementsPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_materials" />}>
                  <Route path="/materials" element={<MaterialsPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_past_questions" />}>
                  <Route path="/past-questions" element={<PastQuestionsPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_archives" />}>
                  <Route path="/archive" element={<ArchiveManagementPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_news" />}>
                  <Route path="/news" element={<NewsManagementPage />} />
                </Route>

                <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                  <Route path="/courses" element={<CoursesPage />} />
                </Route>

                {/* Lecturers — super_admin only */}
                <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                  <Route path="/lecturers" element={<LecturersPage />} />
                  <Route path="/executives" element={<ExecutivesPage />} />
                </Route>

                {/* Granularly gated moderator messaging, storage, and security */}
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_groups" />}>
                  <Route path="/groups" element={<GroupsPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_group_media" />}>
                  <Route path="/group-media" element={<GroupMediaPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_storage" />}>
                  <Route path="/storage" element={<ModeratorStoragePage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_messaging" />}>
                  <Route path="/messaging" element={<MessagingPage />} />
                </Route>
                <Route element={<RoleProtectedRoute minRole="moderator" permission="can_manage_security" />}>
                  <Route path="/security" element={<SecurityPage />} />
                </Route>

                {/* Cloud Archive — super_admin only */}
                <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                  <Route path="/resources" element={<ResourcesPage />} />
                </Route>
              </Route>
            </Route>

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
