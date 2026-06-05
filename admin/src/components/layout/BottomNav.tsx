import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useAdminDataStore } from '../../store/adminData.store';
import {
  LayoutDashboard,
  Users,
  FileText,
  UsersRound,
  FolderOpen,
  MoreHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import MobileDrawer from './MobileDrawer';

// Primary nav items shown in the bottom bar (max 5 for mobile)
// No permission gating — all moderators see all pages
const primaryNav = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, minRole: 'super_admin' as const },
  { name: 'Students', href: '/students', icon: Users, minRole: 'moderator' as const },
  { name: 'Groups', href: '/groups', icon: UsersRound, minRole: 'moderator' as const },
  { name: 'Announce', href: '/announcements', icon: FileText, minRole: 'moderator' as const },
  { name: 'Materials', href: '/materials', icon: FolderOpen, minRole: 'moderator' as const },
];

export default function BottomNav() {
  const { profile } = useAuthStore();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const userRole = profile?.role || 'student';

  const filteredNav = primaryNav.filter(item => {
    if (userRole === 'super_admin') return true;
    if (userRole === 'student') return false;
    if ((item.minRole as string) === 'super_admin') return false;
    return true;
  });

  return (
    <>
      {/* Bottom navigation bar — mobile only */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-2xl shadow-black/10">
        <div className="flex items-center justify-around px-2 py-1 safe-area-bottom">
          {filteredNav.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/' || item.href === '/materials'}
                onClick={() => {
                  if (location.pathname === item.href) {
                    useAdminDataStore.getState().syncAll(true);
                  }
                }}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-2xl min-w-[52px] transition-all duration-200 ${
                    isActive
                      ? 'text-primary-950'
                      : 'text-gray-400 active:bg-gray-50'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={`p-1.5 rounded-xl transition-all ${isActive ? 'bg-primary-50' : ''}`}>
                      <Icon className={`h-5 w-5 ${isActive ? 'text-primary-950' : 'text-gray-400'}`} />
                    </div>
                    <span className={`text-[9px] font-bold tracking-wide ${isActive ? 'text-primary-950' : 'text-gray-400'}`}>
                      {item.name}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}

          {/* More button — opens full nav drawer */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-2xl min-w-[52px] text-gray-400 active:bg-gray-50 transition-all"
          >
            <div className="p-1.5 rounded-xl">
              <MoreHorizontal className="h-5 w-5 text-gray-400" />
            </div>
            <span className="text-[9px] font-bold tracking-wide text-gray-400">More</span>
          </button>
        </div>
      </nav>

      {/* Full navigation drawer for "More" */}
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
