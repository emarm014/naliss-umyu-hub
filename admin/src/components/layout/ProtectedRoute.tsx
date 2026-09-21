import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { supabase } from '../../lib/supabase';
import { getFirstAccessibleRoute } from '../../utils/access';
import { isNetworkError } from '../../lib/sentry';
import LoadingSpinner from '../ui/LoadingSpinner';

const getOrCreateDeviceId = () => {
  let deviceId = localStorage.getItem('naliss_admin_device_id');
  if (!deviceId) {
    deviceId = 'adm_' + Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15) + 
               Date.now().toString(36);
    localStorage.setItem('naliss_admin_device_id', deviceId);
  }
  return deviceId;
};

const getBrowserAndOS = () => {
  const ua = navigator.userAgent;
  let os = 'Unknown OS';
  if (ua.indexOf('Windows') !== -1) os = 'Windows';
  else if (ua.indexOf('Macintosh') !== -1) os = 'macOS';
  else if (ua.indexOf('Linux') !== -1) os = 'Linux';
  else if (ua.indexOf('Android') !== -1) os = 'Android';
  else if (ua.indexOf('like Mac') !== -1) os = 'iOS';

  let browser = 'Unknown Browser';
  if (ua.indexOf('Chrome') !== -1) browser = 'Chrome';
  else if (ua.indexOf('Safari') !== -1) browser = 'Safari';
  else if (ua.indexOf('Firefox') !== -1) browser = 'Firefox';
  else if (ua.indexOf('Edge') !== -1) browser = 'Edge';

  return { os, browser };
};

let cachedIp: string | null = null;
let lastIpFetchTime = 0;
const IP_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const fetchIpAddress = async (): Promise<string> => {
  if (cachedIp && Date.now() - lastIpFetchTime < IP_CACHE_TTL) {
    return cachedIp;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return cachedIp || 'Offline / Unknown';
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (data?.ip) {
      cachedIp = data.ip;
      lastIpFetchTime = Date.now();
      return data.ip;
    }
    return cachedIp || 'Unknown IP';
  } catch {
    clearTimeout(timeoutId);
    return cachedIp || 'Unknown IP';
  }
};

let isRegisteringSession = false;
let lastRegisteredAt = 0;
const SESSION_VERIFY_COOLDOWN = 60 * 1000; // 60 seconds

export default function ProtectedRoute() {
  const { user, profile, permissions, isAdminOrModerator, isLoading, signOut } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!user || !isAdminOrModerator) return;

    const deviceId = getOrCreateDeviceId();
    let isSubscribed = true;

    const checkAndRegisterSession = async (isRetry: boolean = false) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!isSubscribed) return;
      if (isRegisteringSession) return;
      if (!isRetry && Date.now() - lastRegisteredAt < SESSION_VERIFY_COOLDOWN) return;

      isRegisteringSession = true;
      try {
        // 1. Check if the session is still active in DB
        const { data, error } = await supabase
          .from('user_sessions')
          .select('is_active')
          .eq('user_id', user.id)
          .eq('device_id', deviceId)
          .maybeSingle();

        if (!error && data && !data.is_active) {
          if (isSubscribed) {
            alert('Session Terminated: This device has been permanently blocked from logging in.');
            await signOut();
          }
          return;
        }

        // 2. Register/update session details
        const { os, browser } = getBrowserAndOS();
        const ip = await fetchIpAddress();
        const deviceName = `${browser} on ${os}`;

        if (!isSubscribed) return;
        
        const { error: upsertError } = await supabase
          .from('user_sessions')
          .upsert({
            user_id: user.id,
            device_id: deviceId,
            device_name: deviceName,
            os: os,
            ip_address: ip,
            is_active: true,
            last_active_at: new Date().toISOString(),
          }, { onConflict: 'user_id,device_id' });

        if (upsertError) throw upsertError;
        lastRegisteredAt = Date.now();
      } catch (err: any) {
        // Ignore RLS/Auth errors caused by expired sessions during component unmount
        if (err?.code === '42501' || err?.status === 401 || !isSubscribed) return;

        // Lock contention or transient network errors: downgrade to warn and schedule background retry
        if (isNetworkError(err) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          console.warn('[ProtectedRoute] Session verify/register deferred due to network error:', err?.message || err);
          if (!isRetry && isSubscribed) {
            setTimeout(() => {
              if (isSubscribed && (typeof navigator === 'undefined' || navigator.onLine)) {
                checkAndRegisterSession(true);
              }
            }, 4000);
          }
          return;
        }

        if (err?.name === 'AbortError' || err?.message?.includes('Lock broken') || err?.details?.includes?.('AbortError')) {
          console.warn('Failed to verify/register session:', err);
        } else {
          console.error('Failed to verify/register session:', err);
        }
      } finally {
        isRegisteringSession = false;
      }
    };

    checkAndRegisterSession();

    // 3. Realtime subscription to log out instantly if session is terminated OR moderator restricted
    const channel = supabase
      .channel(`admin_session_guard_${deviceId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_sessions',
        },
        async (payload) => {
          const updated = payload.new as any;
          if (
            updated && 
            updated.device_id === deviceId && 
            updated.user_id === user.id && 
            !updated.is_active
          ) {
            if (isSubscribed) {
              alert('Session Terminated: This device has been permanently blocked from logging in.');
              await signOut();
            }
          }
        }
      )
        .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'user_sessions',
        },
        async (payload) => {
          const oldRecord = payload.old as any;
          if (
            oldRecord && 
            oldRecord.device_id === deviceId && 
            oldRecord.user_id === user.id
          ) {
            if (isSubscribed) {
              alert('You have been logged out remotely. You can sign back in.');
              localStorage.removeItem('naliss_admin_device_id');
              await signOut();
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'moderator_permissions',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const record = payload.new as any;
          if (
            record && 
            record.is_restricted === true && 
            profile?.role === 'moderator'
          ) {
            if (isSubscribed) {
              alert('Access Restricted: Your moderator access has been restricted by the administrator.');
              await signOut();
            }
          }
        }
      )
      .subscribe();

    return () => {
      isSubscribed = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id, isAdminOrModerator, signOut]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user || !isAdminOrModerator) {
    return <Navigate to="/login" replace />;
  }

  // Moderator landing: redirect from super_admin-only routes to first accessible page
  // NOTE: /lecturers and /executives are super_admin-only — never redirect moderators there
  if (profile?.role === 'moderator' && location.pathname === '/') {
    return <Navigate to={getFirstAccessibleRoute(permissions)} replace />;
  }

  return <Outlet />;
}
