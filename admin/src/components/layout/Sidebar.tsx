import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import {
  LayoutDashboard,
  Users,
  FileText,
  MessageSquare,
  GraduationCap,
  Briefcase,
  FolderOpen,
  BarChart3,
  History,
  ChevronLeft,
  Menu,
  Archive,
  UsersRound,
  BookOpen,
  Cloud,
  Wrench,
  HelpCircle,
  LogOut,
  Calendar,
  Images,
  HardDrive,
} from 'lucide-react';
import { NalissLogo } from '../NalissLogo';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, minRole: 'super_admin' as const },
  { name: 'Students', href: '/students', icon: Users, minRole: 'moderator' as const },
  { name: 'Groups', href: '/groups', icon: UsersRound, minRole: 'moderator' as const },
  { name: 'Announcements', href: '/announcements', icon: FileText, minRole: 'moderator' as const },
  { name: 'Events', href: '/events', icon: Calendar, minRole: 'moderator' as const },
  { name: 'Materials', href: '/materials', icon: FolderOpen, minRole: 'moderator' as const },
  { name: 'Past Questions', href: '/past-questions', icon: HelpCircle, minRole: 'moderator' as const },
  { name: 'Messaging', href: '/messaging', icon: MessageSquare, minRole: 'moderator' as const },
  { name: 'Group Media', href: '/group-media', icon: Images, minRole: 'moderator' as const },
  { name: 'Storage', href: '/storage', icon: HardDrive, minRole: 'moderator' as const },
  { name: 'Courses', href: '/courses', icon: BookOpen, minRole: 'super_admin' as const },
  { name: 'Cloud Archive', href: '/resources', icon: Cloud, minRole: 'super_admin' as const },
  { name: 'Lecturers', href: '/lecturers', icon: GraduationCap, minRole: 'super_admin' as const },
  { name: 'Executives', href: '/executives', icon: Briefcase, minRole: 'super_admin' as const },
  { name: 'Graduates', href: '/graduates', icon: Archive, minRole: 'super_admin' as const },
  { name: 'Analytics', href: '/analytics', icon: BarChart3, minRole: 'super_admin' as const },
  { name: 'Activity Logs', href: '/logs', icon: History, minRole: 'super_admin' as const },
  { name: 'Settings', href: '/settings', icon: Wrench, minRole: 'super_admin' as const },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const { profile, signOut } = useAuthStore();
  
  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const userRole = profile?.role || 'student';

  const filteredNav = navigation.filter(item => {
    // Super admins see everything
    if (userRole === 'super_admin') return true;

    // Students see nothing in admin
    if (userRole === 'student') return false;

    // Role check — hide super_admin-only items from moderators
    if ((item.minRole as string) === 'super_admin' && (userRole as string) !== 'super_admin') {
      return false;
    }

    return true;
  });

  return (
    <>
      {/* Mobile menu button — hidden since BottomNav handles mobile navigation */}
      <div className="lg:hidden fixed top-0 left-0 z-50 p-4 hidden">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-md bg-white shadow-md border border-gray-100"
        >
          <Menu className="h-6 w-6 text-gray-600" />
        </button>
      </div>

      {/* Sidebar container — desktop only */}
      <aside
        className={`
          hidden lg:flex
          fixed top-0 left-0 z-40 h-screen pt-5 transition-transform duration-300
          bg-white border-r border-gray-200 flex-col
          ${collapsed ? 'w-20' : 'w-64'}
        `}
      >
        {/* Logo & Header */}
        <div className="flex items-center justify-between px-4 mb-6">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center p-1 shadow-sm shrink-0">
              <NalissLogo className="w-full h-full object-contain rounded-full" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">Admin Portal</p>
                <p className="text-[10px] text-gray-500 truncate">NALISS UMYU Hub</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft
              className={`h-5 w-5 text-gray-400 transition-transform ${collapsed ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* User Card */}
        {!collapsed && (
          <div className="px-4 mb-6">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-sm font-semibold text-gray-900 truncate capitalize">
                {profile?.full_name || 'Administrator'}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-950 text-white uppercase">
                  {profile?.role?.replace('_', ' ') || 'Moderator'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Menu */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto pb-6 custom-scrollbar">
          {filteredNav.map((item) => {
            const Icon = item.icon;
            
            return (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/materials' || item.href === '/'}
                className={({ isActive }) => `
                    flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                    ${isActive 
                      ? 'bg-primary-950 text-white shadow-md shadow-primary-900/20' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-primary-950'}
                  `}
                title={collapsed ? item.name : ''}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-primary-950'}`} />
                    {!collapsed && <span className="truncate">{item.name}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors
              ${collapsed ? 'justify-center' : ''}
            `}
            title={collapsed ? 'Sign Out' : ''}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile overlay removed — BottomNav handles mobile navigation */}
    </>
  );
}
