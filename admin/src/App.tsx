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

// Lazy load every admin page for chunk splitting and faster initial load
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const StudentsPage = lazy(() => import('./pages/StudentsPage'));
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const MaterialsPage = lazy(() => import('./pages/MaterialsPage'));
const MessagingPage = lazy(() => import('./pages/MessagingPage'));
const LecturersPage = lazy(() => import('./pages/LecturersPage'));
const ModeratorsPage = lazy(() => import('./pages/ModeratorsPage'));
const ExecutivesPage = lazy(() => import('./pages/ExecutivesPage'));
const GraduatesPage = lazy(() => import('./pages/GraduatesPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const CoursesPage = lazy(() => import('./pages/CoursesPage'));
const PastQuestionsPage = lazy(() => import('./pages/PastQuestionsPage'));
const ResourcesPage = lazy(() => import('./pages/ResourcesPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ActivityLogsPage = lazy(() => import('./pages/ActivityLogsPage'));
const GroupMediaPage = lazy(() => import('./pages/GroupMediaPage'));
const ModeratorStoragePage = lazy(() => import('./pages/ModeratorStoragePage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const ArchiveManagementPage = lazy(() => import('./pages/ArchiveManagementPage'));
const NewsManagementPage = lazy(() => import('./pages/NewsManagementPage'));
const EventPoolManagementPage = lazy(() => import('./pages/EventPoolManagementPage'));

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
    initialize().then((fn) => { cleanupRef.fn = fn; });

    const handleFocus = () => {
      // Quiet background check to sync changes seamlessly without showing full-page blocking loaders
      const hasUser = useAuthStore.getState().user;
      if (hasUser) {
        syncAll();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => { 
      if (cleanupRef.fn) cleanupRef.fn(); 
      window.removeEventListener('focus', handleFocus);
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
                </Route>

                {/* Students — super_admin sees all; moderators see only their assigned level */}
                <Route element={<RoleProtectedRoute minRole="moderator" />}>
                  <Route path="/students" element={<StudentsPage />} />
                </Route>

                {/* Announcements, Events, Materials, Past Questions
                    All moderators can access these pages.
                    The permission flags (can_manage_announcements / can_manage_materials)
                    only control whether they can CREATE/EDIT/DELETE inside the page —
                    not whether they can see the page at all. */}
                <Route element={<RoleProtectedRoute minRole="moderator" />}>
                  <Route path="/announcements" element={<AnnouncementsPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/materials" element={<MaterialsPage />} />
                  <Route path="/past-questions" element={<PastQuestionsPage />} />
                  <Route path="/archive" element={<ArchiveManagementPage />} />
                  <Route path="/news" element={<NewsManagementPage />} />
                  <Route path="/event-pools" element={<EventPoolManagementPage />} />
                </Route>

                <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                  <Route path="/courses" element={<CoursesPage />} />
                </Route>

                {/* Lecturers — super_admin only */}
                <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                  <Route path="/lecturers" element={<LecturersPage />} />
                  <Route path="/executives" element={<ExecutivesPage />} />
                </Route>

                {/* Always accessible to any authenticated moderator/admin */}
                <Route path="/groups" element={<GroupsPage />} />
                <Route path="/group-media" element={<GroupMediaPage />} />
                <Route path="/storage" element={<ModeratorStoragePage />} />
                <Route path="/messaging" element={<MessagingPage />} />
                <Route path="/security" element={<SecurityPage />} />

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
