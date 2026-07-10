import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { NalissLogo } from '../components/NalissLogo';
import { Lock, Mail, AlertCircle, WifiOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const navigate = useNavigate();

  // Track network status on the login page
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isSupabaseConfigured) {
      setError('Application configuration is missing. Please contact the administrator.');
      return;
    }

    if (!navigator.onLine) {
      setError('No internet connection. Please check your network and try again.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;
      if (!user) throw new Error('No user found after sign in.');

      // Verify user role
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role, status, banned_reason, suspended_until, suspension_reason')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;

      if (profile.role !== 'super_admin' && profile.role !== 'moderator') {
        await supabase.auth.signOut();
        throw new Error('Access denied. This portal is for administrators and moderators only.');
      }

      if (profile.status === 'banned') {
        await supabase.auth.signOut();
        throw new Error(`Account banned${profile.banned_reason ? `: ${profile.banned_reason}` : '. Contact the system owner.'}`);
      }

      if (profile.status === 'suspended') {
        const until = profile.suspended_until ? new Date(profile.suspended_until) : null;
        if (!until || until > new Date()) {
          await supabase.auth.signOut();
          const untilStr = until ? ` until ${until.toLocaleString()}` : ' (permanent)';
          throw new Error(`Account suspended${untilStr}${profile.suspension_reason ? `. Reason: ${profile.suspension_reason}` : '.'}`);
        }
        // Suspension expired — auto-lift
        await supabase.from('users').update({ status: 'active', suspended_until: null, suspension_reason: null }).eq('id', user.id);
      }

      // Navigate via React Router — no hard refresh needed, auth store
      // picks up the session change via onAuthStateChange listener.
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'AbortError' || e.message?.includes('fetch') || e.message === 'Failed to fetch') {
        setError('Network timeout. The server took too long to respond. Please check your connection and try again.');
      } else {
        await supabase.auth.signOut().catch((err) => console.error('[Admin Login] signOut after login error failed:', err));
        setError(e.message || 'Failed to sign in. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Offline warning at top of login page */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-red-600 text-white text-sm py-2 px-4">
          <WifiOff className="w-4 h-4" />
          <span>No internet connection — login requires an active connection</span>
        </div>
      )}

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center p-2 shadow-sm border border-gray-100">
            <NalissLogo className="w-full h-full object-contain" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Admin Portal
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign in to manage the NALISS UMYU Hub
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-gray-100 sm:rounded-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-950 focus:border-primary-950 sm:text-sm"
                  placeholder="admin@naliss-umyu.edu.ng"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-950 focus:border-primary-950 sm:text-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !isOnline}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-950 hover:bg-primary-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-950 disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Signing in...' : !isOnline ? 'No Connection' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
