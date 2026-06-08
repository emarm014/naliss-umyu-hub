import React, { useEffect, useState, useRef } from 'react';
import * as Sentry from '@sentry/react-native';
import { useRouter, useSegments, usePathname } from 'expo-router';
import { View, ActivityIndicator, Alert, Text, StyleSheet, AppState, AppStateStatus, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { useAuthStore, useSettingsStore, useTheme } from '../stores';
import MaintenanceScreen from '../../app/maintenance';
import { useSignupStore, useGlobalSyncStore } from '../stores';
import { cleanupIncompleteSignup } from '../utils/signup-cleanup';
import { supabase } from '../api/supabase/client';
import { useNetworkStore } from '../stores/network.store';
import { INSTITUTIONAL_EMAIL_REGEX } from '../utils/validation';
import { COLORS } from '../constants/Colors';
import { User as Profile } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { NalissLogo } from '../components/NalissLogo';
import { SplashLoadingScreen } from './SplashLoadingScreen';
import { getOrCreateDeviceId, fetchIpAddress } from '../utils/device';
import { normalizeError } from '../utils/sentry';
const MinimalLoader = () => {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
};

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // ── Zustand selectors — subscribe to individual properties, NOT the whole store.
  // This prevents re-renders from unrelated store changes (lastFetch, error, etc.)
  // which were amplifying navigation guard re-fires and contributing to the loop.
  const session = useAuthStore(s => s.session);
  const isProfileComplete = useAuthStore(s => s.isProfileComplete);
  const authLoading = useAuthStore(s => s.isLoading);
  const _hasHydrated = useAuthStore(s => s._hasHydrated);

  const isOnline = useNetworkStore(s => s.isOnline);
  
  const maintenanceMode = useSettingsStore(s => s.maintenanceMode);
  const maintenanceMessage = useSettingsStore(s => s.maintenanceMessage);
  const maintenanceEstimatedEnd = useSettingsStore(s => s.maintenanceEstimatedEnd);
  
  const segments = useSegments() as string[];
  const router = useRouter();
  
  const profile = useAuthStore(s => s.profile);
  const [restrictionInfo, setRestrictionInfo] = useState<{
    type: 'banned' | 'suspended';
    reason: string | null;
    until: Date | null;
  } | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [deviceSessionChecked, setDeviceSessionChecked] = useState(false);
  const [sessionError, setSessionError] = useState<'device_limit_exceeded' | null>(null);

  // ── Device Session Registration & 5-Device Limit check ─────────────────────
  useEffect(() => {
    if (session && isProfileComplete === true) {
      let isSubscribed = true;
      const verifyDeviceSession = async () => {
        try {
          const deviceId = await getOrCreateDeviceId();
          const ipAddress = await fetchIpAddress();
          const deviceName = `${Platform.OS === 'ios' ? 'iPhone' : 'Android Device'} (${Platform.OS} ${Platform.Version})`;

          // 1. Fetch active sessions from the DB
          const { data: activeSessions, error: fetchErr } = await (supabase as any)
            .from('user_sessions')
            .select('device_id, is_active')
            .eq('user_id', session.user.id)
            .eq('is_active', true);

          if (fetchErr) throw normalizeError(fetchErr);
          if (!isSubscribed) return;

          const activeIds = (activeSessions as any[])?.map(s => s.device_id) || [];
          const isCurrentDeviceActive = activeIds.includes(deviceId);

          // 2. Enforce 5 device limit:
          // If the current device is NOT already one of the active sessions,
          // and we already have 5 or more active sessions, block access.
          if (!isCurrentDeviceActive && activeIds.length >= 5) {
            setSessionError('device_limit_exceeded');
            setDeviceSessionChecked(true);
            return;
          }

          // 3. Register/Update current device session
          const { error: upsertErr } = await (supabase as any)
            .from('user_sessions')
            .upsert({
              user_id: session.user.id,
              device_id: deviceId,
              device_name: deviceName,
              os: Platform.OS,
              ip_address: ipAddress,
              is_active: true,
              last_active_at: new Date().toISOString()
            }, { onConflict: 'user_id,device_id' });

          if (upsertErr) throw normalizeError(upsertErr);

          if (isSubscribed) {
            setSessionError(null);
            setDeviceSessionChecked(true);
          }
        } catch (err) {
          console.error('Device session verification failed:', err);
          // robust offline-first fallback: let them proceed if offline or query fails
          if (isSubscribed) {
            setSessionError(null);
            setDeviceSessionChecked(true);
          }
        }
      };

      verifyDeviceSession();
      return () => { isSubscribed = false; };
    } else {
      setDeviceSessionChecked(false);
      setSessionError(null);
    }
  }, [session, isProfileComplete]);

  // ── Remote Logout Check on App Focus ──────────────────────────────────────
  useEffect(() => {
    if (!session || !deviceSessionChecked || sessionError) return;

    const checkSessionStatus = async () => {
      try {
        const deviceId = await getOrCreateDeviceId();
        const { data, error } = await (supabase as any)
          .from('user_sessions')
          .select('is_active')
          .eq('user_id', session.user.id)
          .eq('device_id', deviceId)
          .maybeSingle();

        if (error) return;
        if (data && !data.is_active) {
          Alert.alert('Session Terminated', 'This device has been logged out remotely.');
          await supabase.auth.signOut();
          useAuthStore.getState().setSession(null);
          useAuthStore.getState().setUser(null);
          useAuthStore.getState().setIsProfileComplete(null);
          useAuthStore.getState().setProfile(null);
        }
      } catch {
        // silent offline fallback
      }
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkSessionStatus();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [session, deviceSessionChecked, sessionError]);

  // Safety timeout: if isGoogleDelaying gets stuck (e.g. error during level screen),
  // auto-clear it after 3 minutes so the user is never permanently locked.
  // Depends on session so the timer resets on each new login, not just on mount.
  useEffect(() => {
    const signupState = useSignupStore.getState();
    if (!signupState.isGoogleDelaying) return;
    const timer = setTimeout(() => {
      useSignupStore.getState().setIsGoogleDelaying(false);
    }, 3 * 60 * 1000); // 3 minutes
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ── OFFLINE-FIRST: Unblock spinner as fast as possible ───────────────────
  // Strategy:
  //   A) If hydration is done + session + complete profile → already resolved
  //      by onRehydrateStorage (isProfileComplete=true). No timer needed.
  //   B) If hydration is done + session + isProfileComplete still null after
  //      100ms → network is unreachable. Trust the cache immediately.
  //   C) If hydration is done + session + no cached profile → 4s fallback.
  const [offlineUnblocked, setOfflineUnblocked] = useState(false);
  const offlineUnblockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: prevents the offline timer from firing after onAuthStateChange already resolved
  const offlineResolved = useRef(false);

  useEffect(() => {
    // If onAuthStateChange already resolved isProfileComplete, cancel any pending timer
    if (isProfileComplete !== null) {
      offlineResolved.current = true;
      if (offlineUnblockTimer.current) {
        clearTimeout(offlineUnblockTimer.current);
        offlineUnblockTimer.current = null;
      }
      return;
    }

    if (offlineUnblockTimer.current) {
      clearTimeout(offlineUnblockTimer.current);
      offlineUnblockTimer.current = null;
    }

    // Only start the timer once hydration is complete and we have a session
    // but isProfileComplete is still null (network hasn't responded yet)
    if (_hasHydrated && session && isProfileComplete === null) {
      offlineResolved.current = false;
      const cachedProfile = useAuthStore.getState().profile;
      const hasCompleteCache = !!(cachedProfile?.registration_number && cachedProfile?.level);

      // If we have a complete cached profile, unblock after 1500ms
      // (gives onAuthStateChange enough time to complete its DB fetch before we trust cache)
      // If no cached profile, wait 4s before giving up
      const delay = hasCompleteCache ? 1500 : 4000;

      offlineUnblockTimer.current = setTimeout(() => {
        // Bail out if onAuthStateChange resolved first
        if (offlineResolved.current) return;
        if (useAuthStore.getState().isProfileComplete === null) {
          const profile = useAuthStore.getState().profile;
          if (profile?.registration_number && profile?.level) {
            useAuthStore.getState().setIsProfileComplete(true);
          } else {
            setOfflineUnblocked(true);
          }
        }
      }, delay);
    }

    return () => {
      if (offlineUnblockTimer.current) {
        clearTimeout(offlineUnblockTimer.current);
        offlineUnblockTimer.current = null;
      }
    };
  }, [_hasHydrated, session, isProfileComplete]);

  // Guard: skip navigation effect on the very first render (before hydration settles)
  const isMounted = useRef(false);

  // Tracks whether the app just returned from background — suppresses
  // premature login redirects while Supabase session rehydrates
  const isRehydrating = useRef(false);
  const rehydrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suppress navigation guard for up to 5s when app comes back to foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        isRehydrating.current = true;
        if (rehydrateTimer.current) clearTimeout(rehydrateTimer.current);
        rehydrateTimer.current = setTimeout(() => {
          isRehydrating.current = false;
        }, 5000); // extended to 5s — gives enough time for session rehydration
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      if (rehydrateTimer.current) clearTimeout(rehydrateTimer.current);
    };
  }, []);

  // 1. Initialize Settings Store & Realtime Listener
  useEffect(() => {
    // Only fetch settings if online — cached values are used offline
    if (isOnline) {
      useSettingsStore.getState().fetchSettings();
    }
    const unsubscribeSettings = useSettingsStore.getState().initializeListener();
    
    return () => {
      unsubscribeSettings();
    };
    // CRITICAL: Do NOT include store functions in dependencies — they can be
    // recreated on every render, causing infinite loops. Use getState() instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // 1.1 Activate Global Ecosystem Sync when session is active
  // NOTE: We intentionally do NOT terminate on cleanup here — that would kill
  // realtime channels on every navigation. terminate() is only called on sign-out.
  useEffect(() => {
    if (session && (isProfileComplete === true || offlineUnblocked)) {
      useGlobalSyncStore.getState().initialize();
    }
    // No cleanup / terminate here — channels must survive navigation
    // CRITICAL: Do NOT include store functions in dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isProfileComplete, offlineUnblocked]);

  // 2. Auth State Sync
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {

      // ── Sentry: log every auth state change as a breadcrumb ──────────────
      Sentry.addBreadcrumb({
        category: 'auth',
        message: `Auth event: ${event}`,
        data: {
          userId: currentSession?.user?.id ?? useAuthStore.getState().user?.id ?? 'none',
          email: currentSession?.user?.email ?? 'none',
          hasSession: !!currentSession,
        },
        level: 'info',
      });

      if (event === 'PASSWORD_RECOVERY') {
        // Force instant, non-blocking absolute routing to the update password form
        router.replace('/auth/update-password' as any);
        return;
      }

      // ── SIGNED_OUT intercept ──────────────────────────────────────────────
      // Supabase may fire SIGNED_OUT when the server invalidates a session
      // (e.g. after a ban/suspend). Before clearing state and redirecting to
      // login, check if the user is actually banned/suspended — if so, show
      // the restriction screen instead of logging them out silently.
      if (event === 'SIGNED_OUT' && !currentSession) {
        const prevUserId = useAuthStore.getState().user?.id;
        if (prevUserId) {
          try {
            const { data: statusCheck } = await supabase
              .from('users')
              .select('status, banned_reason, suspended_until, suspension_reason')
              .eq('id', prevUserId)
              .maybeSingle() as any;

            if (statusCheck?.status === 'banned') {
              setRestrictionInfo({
                type: 'banned',
                reason: statusCheck.banned_reason || null,
                until: null,
              });
              // Keep the local session state so restriction screen stays visible
              // Don't call setSession(null) — that would trigger the login redirect
              return;
            }
            if (statusCheck?.status === 'suspended') {
              const suspendedUntil = statusCheck.suspended_until ? new Date(statusCheck.suspended_until) : null;
              if (!suspendedUntil || suspendedUntil > new Date()) {
                setRestrictionInfo({
                  type: 'suspended',
                  reason: statusCheck.suspension_reason || null,
                  until: suspendedUntil,
                });
                // Keep the local session state so restriction screen stays visible
                return;
              }
            }
          } catch {
            // Network error — fall through to normal sign-out handling
          }
        }
        // Normal sign-out (not ban/suspend) — clear state as usual
        useAuthStore.getState().setSession(null);
        useAuthStore.getState().setUser(null);
        useAuthStore.getState().setIsProfileComplete(null);
        useAuthStore.getState().setProfile(null);
        // Sentry: clear user identity on sign-out
        Sentry.setUser(null);
        return;
      }

      useAuthStore.getState().setSession(currentSession);
      useAuthStore.getState().setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        // Sentry: attach user identity on every active session event
        Sentry.setUser({
          id: currentSession.user.id,
          email: currentSession.user.email ?? undefined,
        });

        // If we are actively completing Google OAuth, return early and let the
        // login/register screen validate the session and handle redirection.
        if (useSignupStore.getState().isGoogleDelaying) {
          return;
        }
        
        // Domain validation — block non-institutional emails
        // Google OAuth users in the middle of signup are allowed through temporarily
        const signupState = useSignupStore.getState();
        const isInSignupFlow = signupState.hasActiveSession() || signupState.provider === 'google';
        if (!isInSignupFlow && (!currentSession.user.email || !INSTITUTIONAL_EMAIL_REGEX.test(currentSession.user.email))) {
          Alert.alert('Access Denied', 'You must use an institutional student email (@students.umyu.edu.ng).');
          useAuthStore.getState().setSession(null); useAuthStore.getState().setUser(null); useAuthStore.getState().setIsProfileComplete(null); useAuthStore.getState().setProfile(null);
          supabase.auth.signOut().catch(() => {});
          return;
        }

        // Try to check user profile and status (Silently fail if offline)
        // GUARD: If profile is already marked complete, skip the DB re-check
        // for token refresh AND user-updated events. Password changes fire
        // USER_UPDATED — re-querying the DB here is unnecessary and causes
        // the "endless loading" bug when changing password from the profile modal.
        const currentIsComplete = useAuthStore.getState().isProfileComplete;
        if (currentIsComplete === true && (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
          // Token refresh or password change — profile already verified complete, no need to re-query
          return;
        }

        try {
          const { data: profileData, error: profileError } = await supabase
            .from('users')
            .select('registration_number, level, status, banned_reason, suspended_until, suspension_reason, role')
            .eq('id', currentSession.user.id)
            .maybeSingle() as any;

          if (profileError) throw normalizeError(profileError);
          if (profileData) {
            useAuthStore.getState().setProfile(profileData as any);

            // Sentry: breadcrumb for profile fetch result
            Sentry.addBreadcrumb({
              category: 'auth.profile',
              message: 'Profile fetched from DB',
              data: {
                userId: currentSession.user.id,
                status: profileData.status,
                role: profileData.role,
                hasRegNumber: !!profileData.registration_number,
                hasLevel: !!profileData.level,
              },
              level: 'info',
            });

            // BLOCK: Account status check (Ban / Suspend / Graduate)
            if (profileData.status === 'graduated') {
              Alert.alert(
                'Access Denied', 
                'This account has been graduated. Access to the platform is restricted to active students only.'
              );
              // Clear state immediately, then sign out — avoids double SIGNED_OUT event
              useAuthStore.getState().setSession(null);
              useAuthStore.getState().setUser(null);
              useAuthStore.getState().setIsProfileComplete(null);
              useAuthStore.getState().setProfile(null);
              supabase.auth.signOut().catch(() => {});
              return;
            }

            if (profileData.status === 'banned') {
              setRestrictionInfo({
                type: 'banned',
                reason: profileData.banned_reason || null,
                until: null,
              });
              // DO NOT sign out — keep session so restriction screen persists
              return;
            }
            
            if (profileData.status === 'suspended') {
              const suspendedUntil = profileData.suspended_until ? new Date(profileData.suspended_until) : null;
              if (!suspendedUntil || suspendedUntil > new Date()) {
                setRestrictionInfo({
                  type: 'suspended',
                  reason: (profileData as any).suspension_reason || null,
                  until: suspendedUntil,
                });
                // DO NOT sign out — keep session so restriction screen persists
                return;
              } else {
                // Suspension expired — auto-lift
                await supabase.from('users').update({ status: 'active', suspended_until: null, suspension_reason: null }).eq('id', currentSession.user.id);
                setRestrictionInfo(null);
              }
            }

            // Atomic check: Is profile record complete?
            // Everyone (including moderators) must have both fields — moderators are promoted students
            // Super admins and system owners bypass student checks.
            if (
              profileData.role === 'super_admin' ||
              profileData.role === 'system_owner' ||
              (profileData.registration_number && profileData.level)
            ) {
              useAuthStore.getState().setIsProfileComplete(true);
            } else {
              useAuthStore.getState().setIsProfileComplete(false);
              hydrateSignupStore(currentSession);
            }
          } else {
            // No profile record yet — attempt AUTO-REPAIR only if NOT in signup flow
            // This prevents "skipping" pages for users who have stale metadata
            const signupState = useSignupStore.getState();
            if (!signupState.hasActiveSession()) {
                const repaired = await useAuthStore.getState().attemptProfileRepair();
                if (repaired) {
                    useAuthStore.getState().setIsProfileComplete(true);
                    return;
                }
            }
            
            useAuthStore.getState().setIsProfileComplete(false);
            hydrateSignupStore(currentSession);
          }
        } catch (profileErr) {
          // Sentry: capture silent profile fetch failures — previously invisible
          Sentry.captureException(normalizeError(profileErr), {
            tags: { location: 'ProtectedRoute.onAuthStateChange.profileFetch' },
            extra: {
              userId: currentSession?.user?.id,
              event,
            },
          });
          // OFFLINE GUARD: If we have a local isProfileComplete, trust it
          // Don't leave isProfileComplete as null — that causes infinite spinner
          const currentComplete = useAuthStore.getState().isProfileComplete;
          if (currentComplete === null) {
            // Check cached profile data
            const cachedProfile = useAuthStore.getState().profile;
            if (cachedProfile?.registration_number && cachedProfile?.level) {
              useAuthStore.getState().setIsProfileComplete(true);
            }
            // If no cached profile, the 4s timeout in offlineUnblocked will handle it
          }
        }
      } else {
        // No session and not SIGNED_OUT — clear state
        useAuthStore.getState().setIsProfileComplete(null);
        useAuthStore.getState().setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Stable empty deps — setters accessed via getState() to avoid re-subscription loop

  const hydrateSignupStore = (currentSession: any) => {
    const signupState = useSignupStore.getState();
    // Don't overwrite an already active in-progress signup session
    if (signupState.hasActiveSession()) return;
    // Don't interfere while Google OAuth is actively completing
    if (signupState.isGoogleDelaying) return;
    if (!signupState.email && currentSession.user.email) {
      // Check providers array too — Google OAuth linked to email account keeps
      // app_metadata.provider as 'email' but adds 'google' to providers array
      const providers: string[] = currentSession.user.app_metadata?.providers || [];
      const isGoogle = currentSession.user.app_metadata?.provider === 'google' ||
        providers.includes('google');
      if (isGoogle) {
        signupState.setProvider('google');
        signupState.setGoogleTokens(
          currentSession.user.email,
          currentSession.access_token || '',
          currentSession.refresh_token || ''
        );
        // Set step to 2 so ProtectedRoute resumes at identity screen
        signupState.setCurrentStep(2);
        signupState.touchActivity();
      } else {
        signupState.setCredentials(currentSession.user.email);
      }
    }
  };

  // Countdown timer for suspension screen
  useEffect(() => {
    if (!restrictionInfo || restrictionInfo.type !== 'suspended' || !restrictionInfo.until) return;

    const tick = () => {
      const now = new Date();
      const diff = restrictionInfo.until!.getTime() - now.getTime();
      if (diff <= 0) {
        setCountdown('Suspension expired. Please try logging in again.');
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      if (days > 0) {
        setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s remaining`);
      } else {
        setCountdown(`${hours}h ${minutes}m ${seconds}s remaining`);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [restrictionInfo]);

  // ── REALTIME: Detect ban/suspension while user is already logged in ───────
  // Subscribes to the user's own row. If an admin bans or suspends them while
  // they are actively using the app, the restriction screen appears immediately.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const channel = supabase
      .channel(`user-status-watch-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          // Refresh local profile store with the latest data
          useAuthStore.getState().fetchProfile(true);

          if (updated.status === 'banned') {
            setRestrictionInfo({
              type: 'banned',
              reason: updated.banned_reason || null,
              until: null,
            });
          } else if (updated.status === 'suspended') {
            const suspendedUntil = updated.suspended_until ? new Date(updated.suspended_until) : null;
            if (!suspendedUntil || suspendedUntil > new Date()) {
              setRestrictionInfo({
                type: 'suspended',
                reason: updated.suspension_reason || null,
                until: suspendedUntil,
              });
            }
          } else if (updated.status === 'active') {
            // Admin restored the account — clear restriction screen immediately
            setRestrictionInfo(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const pathname = usePathname();
  // Cooldown-based navigation guard — prevents infinite loops by throttling
  // navigations to at most once per 500ms and blocking duplicate targets.
  const lastNavTime = useRef(0);
  const lastNavTarget = useRef('');

  // Safe navigation helper: throttled + deduplicated
  const safeNavigate = useRef((target: string) => {
    const now = Date.now();
    // Block if we already navigated to this exact target
    if (lastNavTarget.current === target) return;
    // Block if we navigated anywhere within the last 500ms
    if (now - lastNavTime.current < 500) return;
    // Block if we're already on the target
    if (pathname === target) return;
    lastNavTime.current = now;
    lastNavTarget.current = target;
    router.replace(target as any);
  });
  // Keep the ref closure fresh with the latest pathname & router
  safeNavigate.current = (target: string) => {
    const now = Date.now();
    if (lastNavTarget.current === target) return;
    if (now - lastNavTime.current < 500) return;
    if (pathname === target) return;
    lastNavTime.current = now;
    lastNavTarget.current = target;
    // Sentry: track every auth-driven navigation redirect
    Sentry.addBreadcrumb({
      category: 'navigation',
      message: `Auth redirect: ${pathname} → ${target}`,
      data: {
        from: pathname,
        to: target,
        userId: useAuthStore.getState().user?.id ?? 'none',
        isProfileComplete: useAuthStore.getState().isProfileComplete,
      },
      level: 'info',
    });
    router.replace(target as any);
    
    // Auto-clear the lock after 1.5s in case the navigation is swallowed 
    // (e.g. by an active Alert modal dismissing on iOS)
    setTimeout(() => {
      if (lastNavTarget.current === target) {
        lastNavTarget.current = '';
      }
    }, 1500);
  };

  // Reset the last navigation target when we've actually arrived at the destination
  // (pathname matches what we navigated to). This allows future navigations to the
  // same target if the user navigates away and back.
  useEffect(() => {
    if (pathname === lastNavTarget.current) {
      // We've arrived — clear the target lock after a short delay
      const t = setTimeout(() => { lastNavTarget.current = ''; }, 600);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  // 3. Navigation Guard
  useEffect(() => {
    // Skip the very first synchronous render — store hasn't hydrated yet
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }

    // Never navigate while a restriction screen is showing
    if (restrictionInfo) return;

    if (authLoading && !session) return;

    const inAuthGroup = segments[0] === 'auth';
    const currentScreen = segments[1] as string;

    // ── SIGNUP LOCK — checked FIRST, before everything else ───────────────
    const signupScreens = ['register-email', 'register-otp', 'register-password', 'identity', 'level', 'register-options', 'eligibility'];
    if (signupScreens.includes(currentScreen)) {
      if (isProfileComplete === true) {
        const signupState = useSignupStore.getState();
        if (signupState.isGoogleDelaying) return;
        if (signupState.hasActiveSession()) return;
        // Fall through to allow completion redirect
      } else {
        const signupState = useSignupStore.getState();
        if (signupState.hasTimedOut() && signupState.lastActivityTime) {
          signupState.reset();
          cleanupIncompleteSignup();
          safeNavigate.current('/auth/login');
        }
        return;
      }
    }

    if (isRehydrating.current) return;

    // ── OUTSIDE SIGNUP SCREENS ─────────────────────────────────────────────
    if (!session) {
      if (!inAuthGroup) {
        safeNavigate.current('/auth/login');
      }
    } else {
      isRehydrating.current = false;
      if (rehydrateTimer.current) {
        clearTimeout(rehydrateTimer.current);
        rehydrateTimer.current = null;
      }

      if (segments[1] === 'update-password') return;

      const signupState = useSignupStore.getState();
      if (signupState.isGoogleDelaying) return;

      if (isProfileComplete === false) {
        if (signupState.hasTimedOut() && signupState.lastActivityTime) {
          signupState.reset();
          cleanupIncompleteSignup();
          safeNavigate.current('/auth/login');
          return;
        }

        const step = signupState.currentStep;
        const storeProvider = signupState.provider;
        const authProviders: string[] = session.user?.app_metadata?.providers || [];
        const isGoogleProvider = storeProvider === 'google' ||
          session.user?.app_metadata?.provider === 'google' ||
          authProviders.includes('google');

        const resumeRoutes: Record<number, string> = isGoogleProvider
          ? { 1: '/auth/register-options', 2: '/auth/identity', 3: '/auth/level' }
          : { 1: '/auth/register-email', 2: '/auth/register-otp', 3: '/auth/register-password', 4: '/auth/identity', 5: '/auth/level' };

        const defaultRoute = isGoogleProvider ? '/auth/identity' : '/auth/register-password';
        const targetRoute = (step && resumeRoutes[step]) ? resumeRoutes[step] : defaultRoute;
        
        // Prevent redirect loop: only replace if we aren't already there
        safeNavigate.current(targetRoute);

      } else if (isProfileComplete === true) {
        if (inAuthGroup) {
          const signupState = useSignupStore.getState();
          if (signupState.isGoogleDelaying) return;
          safeNavigate.current('/(tabs)');
        }
      } else if (isProfileComplete === null && offlineUnblocked) {
        const cachedProfile = useAuthStore.getState().profile;
        if (cachedProfile?.registration_number && cachedProfile?.level) {
          if (inAuthGroup) {
            safeNavigate.current('/(tabs)');
          }
        } else if (cachedProfile) {
          const storeProvider = useSignupStore.getState().provider;
          const authProviders: string[] = session?.user?.app_metadata?.providers || [];
          const isGoogleProvider = storeProvider === 'google' ||
            session?.user?.app_metadata?.provider === 'google' ||
            authProviders.includes('google');
          const defaultRoute = isGoogleProvider ? '/auth/identity' : '/auth/register-password';
          if (!inAuthGroup) {
            safeNavigate.current(defaultRoute);
          }
        } else {
          if (!inAuthGroup) {
            safeNavigate.current('/auth/login');
          }
        }
      }
    }
    // CRITICAL: Remove `pathname` from dependencies — it changes AFTER navigation
    // and causes the guard to re-run unnecessarily, creating infinite loops.
    // The safeNavigate ref already has its own pathname check internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isProfileComplete, segments, authLoading, offlineUnblocked, restrictionInfo]);

  // BLOCK: Ban / Suspension screen — shown immediately, persists until user chooses to logout
  if (restrictionInfo) {
    const isBanned = restrictionInfo.type === 'banned';
    const handleSignOut = async () => {
      await useAuthStore.getState().signOut();
      setRestrictionInfo(null);
      router.replace('/auth/login');
    };

    const handleBackToLogin = async () => {
      await useAuthStore.getState().signOut();
      setRestrictionInfo(null);
      router.replace('/auth/login');
    };
    return (
      <SafeAreaView style={styles.restrictionSafeArea}>
        <View style={styles.restrictionContainer}>
          {/* Logo at top */}
          <View style={styles.restrictionLogoRow}>
            <NalissLogo size={36} />
          </View>

          {/* Main card */}
          <View style={[styles.restrictionCard, isBanned ? styles.bannedCard : styles.suspendedCard]}>
            {/* Icon */}
            <View style={[styles.restrictionIconCircle, isBanned ? styles.bannedIconCircle : styles.suspendedIconCircle]}>
              <Ionicons
                name={isBanned ? 'ban' : 'pause-circle'}
                size={40}
                color={isBanned ? '#ef4444' : '#f59e0b'}
              />
            </View>

            {/* Title */}
            <Text style={styles.restrictionTitle}>
              {isBanned ? 'Account Banned' : 'Account Suspended'}
            </Text>
            <Text style={styles.restrictionSubtitle}>
              {isBanned
                ? 'Your access to NALISS UMYU Hub has been permanently revoked.'
                : 'Your access to NALISS UMYU Hub has been temporarily suspended.'}
            </Text>

            {/* Divider */}
            <View style={styles.restrictionDivider} />

            {/* Reason */}
            {restrictionInfo.reason ? (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>REASON FOR {isBanned ? 'BAN' : 'SUSPENSION'}</Text>
                <Text style={styles.reasonText}>"{restrictionInfo.reason}"</Text>
              </View>
            ) : (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>REASON FOR {isBanned ? 'BAN' : 'SUSPENSION'}</Text>
                <Text style={[styles.reasonText, { opacity: 0.5, fontStyle: 'italic' }]}>No reason provided.</Text>
              </View>
            )}

            {/* Suspension countdown */}
            {!isBanned && (
              <View style={styles.countdownBox}>
                <Ionicons name="time-outline" size={16} color="#f59e0b" style={{ marginBottom: 4 }} />
                <Text style={styles.countdownLabel}>TIME REMAINING</Text>
                {restrictionInfo.until ? (
                  <>
                    <Text style={styles.countdownText}>{countdown}</Text>
                    <Text style={styles.untilText}>
                      Lifts on {restrictionInfo.until.toLocaleDateString(undefined, { dateStyle: 'long' })} at{' '}
                      {restrictionInfo.until.toLocaleTimeString(undefined, { timeStyle: 'short' })}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.countdownText}>Permanent — manual review required</Text>
                )}
              </View>
            )}

            {/* Contact note */}
            <Text style={styles.contactText}>
              {isBanned
                ? 'If you believe this is a mistake, contact your department administrator.'
                : 'You will regain access automatically when the suspension period ends. Contact your administrator if you have questions.'}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.restrictionActions}>
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={18} color="#ffffff" />
              <Text style={styles.signOutButtonText}>Sign Out</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.backToLoginButton}
              onPress={handleBackToLogin}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-back-outline" size={18} color="rgba(255,255,255,0.6)" />
              <Text style={styles.backToLoginButtonText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── HYDRATION GATE ────────────────────────────────────────────────────────
  // Don't render anything until AsyncStorage rehydration is complete.
  // This prevents the navigation guard from firing with stale null values
  // and causing a login redirect that immediately reverses to tabs.
  // On a real device AsyncStorage reads in ~10-50ms — imperceptible.
  if (!_hasHydrated) {
    return null;
  }

  // Still waiting for profile check AND not yet unblocked by offline timeout
  // (only reaches here if hydration is done but network hasn't responded yet)
  if (session && isProfileComplete === null && !offlineUnblocked) {
    // CRITICAL: Never show the spinner when the user is on a signup screen.
    // Signup screens manage their own loading state. Showing the spinner here
    // unmounts the signup screen, which kills isMounted refs and drops navigations.
    const currentScreen = segments[1] as string;
    const signupScreens = ['register-email', 'register-otp', 'register-password', 'identity', 'level', 'register-options', 'eligibility'];
    if (signupScreens.includes(currentScreen)) {
      return <>{children}</>;
    }
    // Also skip spinner if a signup transition is actively in progress
    const signupState = useSignupStore.getState();
    if (signupState.isGoogleDelaying) return <>{children}</>;
    return <MinimalLoader />;
  }

  // BLOCK: 5-Device limit exceeded screen
  if (sessionError === 'device_limit_exceeded') {
    const handleExit = async () => {
      await supabase.auth.signOut();
      useAuthStore.getState().setSession(null);
      useAuthStore.getState().setUser(null);
      useAuthStore.getState().setIsProfileComplete(null);
      useAuthStore.getState().setProfile(null);
      setSessionError(null);
    };

    return (
      <SafeAreaView style={styles.restrictionSafeArea}>
        <View style={styles.restrictionContainer}>
          <View style={styles.restrictionLogoRow}>
            <NalissLogo size={42} />
          </View>
          <View style={[styles.restrictionCard, styles.suspendedCard, { borderColor: '#f59e0b' }]}>
            <View style={[styles.restrictionIconCircle, styles.suspendedIconCircle, { borderColor: 'rgba(245,158,11,0.3)' }]}>
              <Ionicons name="shield-outline" size={40} color="#f59e0b" />
            </View>
            <Text style={styles.restrictionTitle}>Device Limit Reached</Text>
            <Text style={styles.restrictionSubtitle}>
              You are currently logged in on 5 active devices. To protect your account security, UMYU Hub restricts access to at most 5 concurrent devices.
            </Text>
            <View style={styles.restrictionDivider} />
            <Text style={[styles.contactText, { color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 20 }]}>
              Please log out of UMYU Hub on one of your other active devices, or manage your active sessions under Profile &gt; Security &gt; Device Management to authorize this device.
            </Text>
          </View>
          <View style={styles.restrictionActions}>
            <TouchableOpacity
              style={[styles.signOutButton, { backgroundColor: '#f59e0b', shadowColor: '#f59e0b' }]}
              onPress={handleExit}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={18} color="#ffffff" />
              <Text style={styles.signOutButtonText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // BLOCK: Global Maintenance Mode
  if (maintenanceMode && profile?.role !== 'super_admin') {
    return <MaintenanceScreen message={maintenanceMessage} estimatedEnd={maintenanceEstimatedEnd} />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  restrictionSafeArea: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  restrictionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 20,
  },
  restrictionLogoRow: {
    alignItems: 'center',
    marginBottom: 4,
  },
  restrictionCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    gap: 14,
  },
  bannedCard: {
    backgroundColor: '#140000',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  suspendedCard: {
    backgroundColor: '#110d00',
    borderWidth: 1,
    borderColor: '#78350f',
  },
  restrictionIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bannedIconCircle: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  suspendedIconCircle: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
  },
  restrictionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  restrictionSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 19,
  },
  restrictionDivider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginVertical: 2,
  },
  reasonBox: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  reasonLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 2.5,
  },
  reasonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: 21,
  },
  countdownBox: {
    width: '100%',
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  countdownLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(245,158,11,0.6)',
    letterSpacing: 2.5,
  },
  countdownText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fbbf24',
    letterSpacing: 0.5,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  untilText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: 2,
  },
  contactText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  restrictionActions: {
    width: '100%',
    maxWidth: 420,
    gap: 10,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  signOutButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  backToLoginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  backToLoginButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.2,
  },
});
