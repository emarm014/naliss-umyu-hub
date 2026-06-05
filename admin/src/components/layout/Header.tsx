import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, User, ChevronDown, RefreshCcw } from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { useAdminDataStore } from '../../store/adminData.store';

export default function Header() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { profile, signOut } = useAuthStore();
  const { isSyncing, syncAll } = useAdminDataStore();

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 flex-1">
          <h1 className="text-lg font-black text-gray-900 tracking-tight uppercase">
            NALISS <span className="text-primary-600">UMYU</span>
          </h1>
          
          {isSyncing && (
            <div className="flex items-center gap-2 px-3 py-1 bg-primary-50 rounded-full animate-in fade-in duration-500">
               <RefreshCcw className="w-3 h-3 text-primary-600 animate-spin" />
               <span className="text-[10px] font-black text-primary-600 uppercase tracking-widest italic">Institutional Syncing...</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Refresh Button */}
          <button
            onClick={() => syncAll(true)}
            disabled={isSyncing}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh Database"
          >
            <RefreshCcw className={`h-5 w-5 ${isSyncing ? 'animate-spin text-primary-600' : ''}`} />
          </button>

          {/* Notifications */}
          <button className="relative p-2 text-gray-400 hover:text-gray-500">
            <Bell className="h-6 w-6" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-primary-950 rounded-full"></span>
          </button>

          {/* User Menu */}
          <div className="relative" ref={dropdownRef}>
            <button
               onClick={() => setDropdownOpen(!dropdownOpen)}
               className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-gray-100 transition-all border border-transparent hover:border-gray-200"
            >
              <div className="w-10 h-10 rounded-xl bg-primary-950 flex items-center justify-center shadow-lg shadow-primary-950/20">
                <span className="text-white font-black text-sm">
                  {profile?.full_name?.charAt(0).toUpperCase() || 'A'}
                </span>
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-black text-gray-900 leading-none mb-1">
                  {profile?.full_name}
                </p>
                <div className="flex items-center gap-1.5">
                   <div className="w-1 h-1 bg-green-500 rounded-full" />
                   <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                     {profile?.role === 'super_admin' ? 'Strategic Admin' : 'Moderator'}
                   </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                {profile?.role === 'super_admin' && (
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      navigate('/settings');
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <User className="h-4 w-4" />
                    Settings
                  </button>
                )}
                {profile?.role === 'super_admin' && <hr className="my-1 border-gray-200" />}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
