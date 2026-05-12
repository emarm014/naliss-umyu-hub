import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuthStore } from './store/auth.store';
import { NetworkBanner } from './components/NetworkBanner';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import DashboardLayout from './components/layout/DashboardLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import RoleProtectedRoute from './components/layout/RoleProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import StudentsPage from './pages/StudentsPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import EventsPage from './pages/EventsPage';
import MaterialsPage from './pages/MaterialsPage';
import MessagingPage from './pages/MessagingPage';
import LecturersPage from './pages/LecturersPage';
import ExecutivesPage from './pages/ExecutivesPage';
import GraduatesPage from './pages/GraduatesPage';
import GroupsPage from './pages/GroupsPage';
import CoursesPage from './pages/CoursesPage';
import PastQuestionsPage from './pages/PastQuestionsPage';
import ResourcesPage from './pages/ResourcesPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import ActivityLogsPage from './pages/ActivityLogsPage';
import GroupMediaPage from './pages/GroupMediaPage';
import ModeratorStoragePage from './pages/ModeratorStoragePage';

// Aggressive caching: keep data fresh for 10 min, retry up to 3x with backoff
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

function App() {
  const { initialize } = useAuthStore();

  useEffect(() => {
    const cleanupRef = { fn: undefined as (() => void) | void };
    initialize().then((fn) => { cleanupRef.fn = fn; });
    return () => { if (cleanupRef.fn) cleanupRef.fn(); };
  }, [initialize]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Global network status banner */}
        <NetworkBanner />

        {/* PWA install prompt — appears after 3s if app is installable */}
        <PWAInstallPrompt />

        <Routes>
          {/* Public route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected admin routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<DashboardLayout />}>
              {/* Super Admin Restricted Only */}
              <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                <Route path="/" element={<DashboardPage />} />
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

              {/* Cloud Archive — super_admin only */}
              <Route element={<RoleProtectedRoute minRole="super_admin" />}>
                <Route path="/resources" element={<ResourcesPage />} />
              </Route>
            </Route>
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
