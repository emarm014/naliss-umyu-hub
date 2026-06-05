import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { supabase } from '../../lib/supabase';
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
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data.ip || 'Unknown IP';
  } catch (err) {
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
            alert('Session Terminated: This device has been logged out remotely.');
            await signOut();
          }
          return;
        }

        // 2. Register/update session details
        const { os, browser } = getBrowserAndOS();
        const ip = await fetchIpAddress();
        const deviceName = `${browser} on ${os}`;

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
      } catch (err) {
        console.error('Failed to verify/register session:', err);
      }
    };

    checkAndRegisterSession();

    // 3. Realtime subscription to log out instantly if session is terminated
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
              alert('Session Terminated: This device has been logged out remotely.');
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
    if (permissions?.can_manage_announcements) {
      return <Navigate to="/announcements" replace />;
    } else if (permissions?.can_manage_materials) {
      return <Navigate to="/materials" replace />;
    } else if (permissions?.can_manage_events) {
      return <Navigate to="/events" replace />;
    } else if (permissions?.can_manage_past_questions) {
      return <Navigate to="/past-questions" replace />;
    } else {
      return <Navigate to="/groups" replace />;
    }
  }

  return <Outlet />;
}
