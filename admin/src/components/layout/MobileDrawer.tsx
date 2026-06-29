import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useAdminDataStore } from '../../store/adminData.store';
import {
  LayoutDashboard, Users, FileText, MessageSquare,
  GraduationCap, Briefcase, FolderOpen, BarChart3,
  History, Archive, UsersRound, BookOpen, Cloud,
  Wrench, HelpCircle, LogOut, Calendar, Images,
  HardDrive, X, ShieldCheck, Newspaper, Trophy,
} from 'lucide-react';
import { NalissLogo } from '../NalissLogo';

const allNav = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, minRole: 'super_admin' as const },
  { name: 'Moderators', href: '/moderators', icon: ShieldCheck, minRole: 'super_admin' as const },
  { name: 'Students', href: '/students', icon: Users, minRole: 'moderator' as const, permission: 'can_manage_students' as const },
  { name: 'Groups', href: '/groups', icon: UsersRound, minRole: 'moderator' as const, permission: 'can_manage_groups' as const },
  { name: 'Announcements', href: '/announcements', icon: FileText, minRole: 'moderator' as const, permission: 'can_manage_announcements' as const },
  { name: 'Events', href: '/events', icon: Calendar, minRole: 'super_admin' as const },
  { name: 'Event Pools', href: '/event-pools', icon: Trophy, minRole: 'super_admin' as const },
  { name: 'News', href: '/news', icon: Newspaper, minRole: 'moderator' as const, permission: 'can_manage_news' as const },
  { name: 'Archive', href: '/archive', icon: FolderOpen, minRole: 'moderator' as const, permission: 'can_manage_archives' as const },
  { name: 'Materials', href: '/materials', icon: FolderOpen, minRole: 'moderator' as const, permission: 'can_manage_materials' as const },
  { name: 'Past Questions', href: '/past-questions', icon: HelpCircle, minRole: 'moderator' as const, permission: 'can_manage_past_questions' as const },
  { name: 'Messaging', href: '/messaging', icon: MessageSquare, minRole: 'moderator' as const, permission: 'can_manage_messaging' as const },
  { name: 'Group Media', href: '/group-media', icon: Images, minRole: 'moderator' as const, permission: 'can_manage_group_media' as const },
  { name: 'Storage', href: '/storage', icon: HardDrive, minRole: 'moderator' as const, permission: 'can_manage_storage' as const },
  { name: 'Lecturers', href: '/lecturers', icon: GraduationCap, minRole: 'super_admin' as const },
  { name: 'Executives', href: '/executives', icon: Briefcase, minRole: 'super_admin' as const },
  // Super admin only
  { name: 'Cloud Archive', href: '/resources', icon: Cloud, minRole: 'super_admin' as const },
  { name: 'Courses', href: '/courses', icon: BookOpen, minRole: 'super_admin' as const },
  { name: 'Graduates', href: '/graduates', icon: Archive, minRole: 'super_admin' as const },
  { name: 'Analytics', href: '/analytics', icon: BarChart3, minRole: 'super_admin' as const },
  { name: 'Activity Logs', href: '/logs', icon: History, minRole: 'super_admin' as const },
  { name: 'Security Settings', href: '/security', icon: ShieldCheck, minRole: 'moderator' as const, permission: 'can_manage_security' as const },
  { name: 'Settings', href: '/settings', icon: Wrench, minRole: 'super_admin' as const },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileDrawer({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, permissions, signOut } = useAuthStore();
  const userRole = profile?.role || 'student';

  const filteredNav = allNav.filter(item => {
    if (userRole === 'super_admin') return true;
    if (userRole === 'student') return false;
    if ((item.minRole as string) === 'super_admin') return false;
    if (userRole === 'moderator' && item.permission && permissions) {
      return !!(permissions as any)[item.permission];
    }
    return true;
  });

  const handleLogout = async () => {
    onClose();
    await signOut();
    navigate('/login');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer — slides up from bottom */}
      <div
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-100">
              <NalissLogo className="w-full h-full object-contain rounded-full" />
            </div>
            <div>
              <p className="text-sm font-black text-gray-900">{profile?.full_name || 'Administrator'}</p>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-primary-950 text-white uppercase tracking-wider">
                {profile?.role?.replace('_', ' ') || 'Admin'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-gray-100 text-gray-500 active:bg-gray-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav items — scrollable grid */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-3 gap-3">
            {filteredNav.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.href === '/' || item.href === '/materials'}
                  onClick={() => {
                    onClose();
                    if (location.pathname === item.href) {
                      useAdminDataStore.getState().syncAll(true);
                    }
                  }}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all active:scale-95 ${
                      isActive
                        ? 'bg-primary-950 border-primary-900 text-white shadow-lg shadow-primary-950/20'
                        : 'bg-gray-50 border-gray-100 text-gray-600 active:bg-gray-100'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`h-6 w-6 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                      <span className={`text-[10px] font-black text-center leading-tight ${isActive ? 'text-white' : 'text-gray-600'}`}>
                        {item.name}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>

        {/* Sign out */}
        <div className="px-4 pb-6 pt-2 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-red-50 text-red-600 font-black text-sm active:bg-red-100 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
