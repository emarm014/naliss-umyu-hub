import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { supabase } from '../../lib/supabase';
import { getFirstAccessibleRoute } from '../../utils/access';
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

const fetchIpAddress = async (): Promise<string> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    return data.ip || 'Unknown IP';
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Could not fetch IP:', err);
    return 'Unknown IP';
  }
};

export default function ProtectedRoute() {
  const { user, profile, permissions, isAdminOrModerator, isLoading, signOut } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!user || !isAdminOrModerator) return;

    const deviceId = getOrCreateDeviceId();
    let isSubscribed = true;

    const checkAndRegisterSession = async () => {
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
      } catch (err: any) {
        // Ignore RLS/Auth errors caused by expired sessions during component unmount
        if (err?.code === '42501' || err?.status === 401 || !isSubscribed) return;
        // Lock contention (AbortError) is expected during StrictMode double-mount — downgrade to warn
        if (err?.name === 'AbortError' || err?.message?.includes('Lock broken') || err?.details?.includes?.('AbortError')) {
          console.warn('Failed to verify/register session:', err);
        } else {
          console.error('Failed to verify/register session:', err);
        }
      }
    };

    checkAndRegisterSession();

    // 3. Realtime subscription to log out instantly if session is terminated OR moderator restricted
    const channel = supabase
      .channel(`admin_session_guard_${deviceId}`)
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
  }, [user, isAdminOrModerator, signOut]);

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
