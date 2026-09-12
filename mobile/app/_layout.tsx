import * as Sentry from '@sentry/react-native';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { GroupMembershipHandler } from '../src/components/GroupMembershipHandler';
import { useNetworkStore, registerOnlineCallback } from '../src/stores/network.store';
import { useGlobalSyncStore } from '../src/stores/globalSync.store';
import { useMessageStore } from '../src/stores/message.store';
import { useGroupStore } from '../src/stores/group.store';
import { View, Text, AppState, AppStateStatus, Appearance } from 'react-native';
import { ThemeProvider, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { NalissLogo } from '../src/components/NalissLogo';
import { initDB, checkpointWal } from '../src/lib/database';
import { useAuthStore } from '../src/stores/auth.store';
import { ProtectedRoute } from '../src/components/ProtectedRoute';
import { supabase } from '../src/api/supabase/client';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { useHeartbeat, HeartbeatBanner } from '../src/hooks/useHeartbeat';
import { OverlayManager } from '../src/components/common/overlays';
import { FeaturedStudentPopup } from '../src/components/FeaturedStudentPopup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSignupStore } from '../src/stores/signup.store';
import { cleanupIncompleteSignup } from '../src/utils/signup-cleanup';
import { useThemeStore } from '../src/stores/theme.store';
import * as Notifications from 'expo-notifications';
import { NotificationRouter } from '../src/services/notificationRouter';
import { runCacheMaintenance } from '../src/utils/cacheMaintenance';

// Catch any unhandled errors globally via React Native's global ErrorUtils.
// NOTE: ErrorUtils is NOT a named export of the 'react-native' package — it is
// injected into the global scope by the RN runtime. We must access it via `global`.
if (typeof globalThis !== 'undefined' && !(globalThis as any)._rejectHandlerInstalled) {
    (globalThis as any)._rejectHandlerInstalled = true;

    const RNErrorUtils = (globalThis as any).ErrorUtils;
    if (RNErrorUtils) {
        const originalHandler = RNErrorUtils.getGlobalHandler?.();
        RNErrorUtils.setGlobalHandler((error: any, isFatal: boolean) => {
            console.error('[Global Error]', isFatal ? 'FATAL' : 'NON-FATAL', error);
            // Report to Sentry if available
            try {
                Sentry.captureException(error);
            } catch (_e) { /* Sentry not ready */ }
            // Call original handler if it exists
            if (originalHandler) originalHandler(error, isFatal);
        });
    }
}

// ── Sentry: initialised before everything else so it catches all boot errors ──
const IS_PROD = process.env.EXPO_PUBLIC_APP_ENV === 'production';

Sentry.init({
  dsn: 'https://d788f703d8c028e11be19ad6c99b2822@o4511411773571072.ingest.de.sentry.io/4511413255995472',
  environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',

  // 1. Zero performance transaction overhead on mobile JS thread
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  enableUserInteractionTracing: false,
  enableAutoSessionTracking: true,

  // 2. Compact memory buffer for breadcrumbs
  maxBreadcrumbs: 40,

  // 3. Strict errors-only breadcrumbs filter
  beforeBreadcrumb(breadcrumb) {
    // Drop noisy standard console logs (preserve only warnings and errors)
    if (
      breadcrumb.category === 'console' &&
      (breadcrumb.level === 'log' || breadcrumb.level === 'info' || breadcrumb.level === 'debug')
    ) {
      return null;
    }

    // Drop touch and UI click component-tree traversals
    if (breadcrumb.category === 'touch' || breadcrumb.category === 'ui.click') {
      return null;
    }

    // Drop successful HTTP requests (keep ONLY failures >= 400 or network drops)
    if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
      const status = breadcrumb.data?.status_code;
      if (typeof status === 'number' && status >= 200 && status < 400) {
        return null;
      }
      if (
        typeof breadcrumb.data?.url === 'string' &&
        (breadcrumb.data.url.includes('/realtime/') || breadcrumb.data.url.includes('heartbeat'))
      ) {
        return null;
      }
    }

    // Drop SQLite PRAGMA debug spam
    if (
      breadcrumb.category === 'db.sqlite' &&
      breadcrumb.level === 'debug' &&
      typeof breadcrumb.data?.sql === 'string' &&
      breadcrumb.data.sql.startsWith('PRAGMA')
    ) {
      return null;
    }

    return breadcrumb;
  },

  // 4. Data sanitization guard
  beforeSend(event) {
    // Sanitize any credentials or tokens from request bodies/extra payloads
    if (event.request?.data) {
      try {
        if (typeof event.request.data === 'string') {
          event.request.data = event.request.data.replace(
            /"(password|token|otp|access_token|refresh_token)":\s*"[^"]+"/gi,
            '"$1":"[REDACTED]"'
          );
        }
      } catch (_) {}
    }
    return event;
  },

  enableNativeNagger: false,
  debug: false,

  ignoreErrors: [
    'Network request failed',
    'Failed to fetch',
    'NetworkError',
    'timed out',
    'Unable to resolve host',
    'software caused connection abort',
  ],
});

// ── Global console.error interception ──────────────────────────────────────
// Force all manual console.error() calls to be reported to Sentry as exceptions
// Rate-limited to prevent JS thread starvation when native modules spam errors
const originalConsoleError = console.error;
const safeStringifyArg = (a: any) => {
  if (typeof a === 'object' && a !== null) {
    try {
      return JSON.stringify(a);
    } catch (_) {
      return String(a);
    }
  }
  return String(a);
};

// Rate limiter: max 5 Sentry captures per 10-second window
let _sentryErrorCount = 0;
let _sentryErrorWindowStart = Date.now();
const SENTRY_ERROR_WINDOW_MS = 10000;
const SENTRY_ERROR_MAX_PER_WINDOW = 5;

console.error = (...args) => {
  originalConsoleError(...args); // Keep logging to terminal/bundler
  
  // Skip transient network errors to prevent false crash reports
  const strArgs = args.map(safeStringifyArg).join(' ').toLowerCase();
  if (strArgs.includes('network request failed') || 
      strArgs.includes('failed to fetch') || 
      strArgs.includes('timeout') ||
      strArgs.includes('unable to resolve host') ||
      strArgs.includes('software caused connection abort')) {
    return;
  }

  // Rate limit: if we've exceeded the cap in this window, skip Sentry capture
  const now = Date.now();
  if (now - _sentryErrorWindowStart > SENTRY_ERROR_WINDOW_MS) {
    _sentryErrorCount = 0;
    _sentryErrorWindowStart = now;
  }
  if (_sentryErrorCount >= SENTRY_ERROR_MAX_PER_WINDOW) return;
  _sentryErrorCount++;

  // Find if an actual Error object was passed
  const err = args.find(a => a instanceof Error);
  if (err) {
    Sentry.captureException(err, { tags: { source: 'console.error' } });
  } else {
    // Stringify everything else
    Sentry.captureMessage(args.map(safeStringifyArg).join(' '), 'error');
  }
};

LogBox.ignoreLogs([
  'getInfoAsync is deprecated',
  'expo-file-system: getInfoAsync is deprecated'
]);
// Polyfill for WeakRef (required for some versions of Supabase SDK on older Android/Hermes)
if (typeof (globalThis as any).WeakRef === 'undefined') {
  (globalThis as any).WeakRef = class {
    private ref: any;
    constructor(ref: any) { this.ref = ref; }
    deref() { return this.ref; }
  };
}

// CRITICAL: Required for OAuth redirects to work correctly on Android.
// Without this, the browser closes immediately after the OAuth redirect
// because the app never signals that the auth session is complete.
WebBrowser.maybeCompleteAuthSession();

// ── Kill detection key ────────────────────────────────────────────────────────
// Written to AsyncStorage when app goes to background during an active signup.
// If this key exists on cold launch, the app was killed mid-signup → restart.
const SIGNUP_BG_KEY = 'signup_in_background';

// ── Network Status Dot — small inline indicator, shown in screen headers ──────
// Shows "● Offline" (red) or "● Online" (green, briefly after reconnect)
// Does NOT block navigation bars or cover any UI
export function NetworkStatusDot() {
  const { isOnline, wasOffline } = useNetworkStore();
  const clearWasOffline = useNetworkStore(s => s.clearWasOffline);
  const [showOnline, setShowOnline] = useState(false);

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowOnline(true);
      const t = setTimeout(() => {
        setShowOnline(false);
        if (typeof clearWasOffline === 'function') clearWasOffline();
      }, 3000);
      return () => clearTimeout(t);
    }
    if (!isOnline) setShowOnline(false);
  }, [isOnline, wasOffline, clearWasOffline]);

  // Only show when offline OR briefly when just came back online
  if (isOnline && !showOnline) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{
        width: 6, height: 6, borderRadius: 3,
        backgroundColor: isOnline ? '#22c55e' : '#ef4444',
      }} />
      <Text style={{
        fontSize: 10, fontFamily: 'Inter-SemiBold',
        color: isOnline ? '#22c55e' : '#ef4444',
        letterSpacing: 0.3,
      }}>
        {isOnline ? 'Online.' : 'Offline.'}
      </Text>
    </View>
  );
}



// ── Deep Link Session Handler ─────────────────────────────────────────────────
// Extracts Supabase auth tokens from redirect URLs (e.g. after OAuth or reset)
function extractSessionFromUrl(url: string): { access_token: string; refresh_token: string; type?: string } | null {
  const fragment = url.split('#')[1];
  if (!fragment) return null;

  try {
    const params = fragment.split('&').reduce((acc, current) => {
      const [key, value] = current.split('=');
      if (key && value) acc[key] = decodeURIComponent(value);
      return acc;
    }, {} as Record<string, string>);

    if (params.access_token && params.refresh_token) {
      return { 
        access_token: params.access_token, 
        refresh_token: params.refresh_token,
        type: params.type 
      };
    }
  } catch {
    // silent — deep link session parse failure
  }
  return null;
}

// ── Safe Deep Link Validation & Routing ───────────────────────────────────────
function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    
    // Auth redirect - let the session handler deal with it
    if (parsed.hash && parsed.hash.includes('access_token=')) return;

    if (pathParts[0] === 'chat' && pathParts[1]) {
      const chatId = pathParts[1];
      if (!chatId || chatId.length < 5) {
        console.warn('[DeepLink] Invalid chat ID:', chatId);
        return router.push('/(tabs)/messages' as any);
      }
      
      if (pathParts[2] === 'message' && pathParts[3]) {
        const messageId = pathParts[3];
        if (messageId.length < 5) {
          console.warn('[DeepLink] Invalid message ID:', messageId);
          return router.push(`/chat/${chatId}` as any);
        }
        router.push(`/chat/${chatId}/message/${messageId}` as any);
      } else {
        router.push(`/chat/${chatId}` as any);
      }
    } else if (pathParts[0] === 'user_profile' && pathParts[1]) {
        const userId = pathParts[1];
        if (!userId || userId.length < 5) {
            return router.push('/(tabs)/home' as any);
        }
        router.push(`/chat/user_profile/${userId}` as any);
    }
  } catch (error) {
    console.warn('[DeepLink] Failed to parse URL:', url, error);
  }
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,   // 10 min — serve from cache on slow networks
      gcTime: 30 * 60 * 1000,       // 30 min — keep data in memory
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: false,   // mobile doesn't have window focus
      refetchOnReconnect: true,      // re-fetch when network comes back
    },
  },
});

function RootLayoutNav() {
  const [isReady, setIsReady] = useState(false);
  const { isDark } = useThemeStore();
  
  // Register Institutional Signal (Push Notifications)
  usePushNotifications();

  // Register 60s Presence Heartbeat
  useHeartbeat();

  // ── Cache Maintenance & Database WAL Checkpoint ────────────────────────────
  // IMPORTANT: CacheMaintenance must NOT run during the initial sync bootstrap.
  // The startup delay (60s) ensures syncAll has time to complete before any
  // checkpoint or cleanup runs. This prevents the "database table is locked"
  // crash that Sentry captured when checkpoint collided with sync writes.
  useEffect(() => {
    // Defer cache maintenance until well after sync has had time to complete
    const timer = setTimeout(() => {
        runCacheMaintenance();
    }, 60000); // 60s — sync typically finishes in 10-30s

    let lastMaintenanceRun = 0;
    const MIN_MAINTENANCE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

    const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
            // Delay checkpoint by 5s after foregrounding to let any pending
            // sync writes settle before attempting WAL merge
            setTimeout(() => {
                try {
                    checkpointWal();
                } catch (e) {
                    console.warn('checkpointWal failed on active state', e);
                }
            }, 5000);

            // Run periodic cache maintenance if enough time has passed
            if (Date.now() - lastMaintenanceRun > MIN_MAINTENANCE_INTERVAL) {
                lastMaintenanceRun = Date.now();
                // Also delay maintenance on foreground
                setTimeout(() => runCacheMaintenance(), 5000);
            }
        }
    });

    return () => {
        clearTimeout(timer);
        sub.remove();
    };
  }, []);

  // ── Sync Native Theme with Zustand ──────────────────────────────────────────
  // This completely overrides the user's phone OS dark mode setting so the app
  // native elements (like Navigation Bars, Pickers, Status Bar) strictly follow
  // the app's internal light/dark toggle.
  useEffect(() => {
    Appearance.setColorScheme(isDark ? 'dark' : 'light');
  }, [isDark]);

  // ── Kill detection: wipe signup session if app was killed mid-signup ─────
  // On every cold launch, check if the kill-detection key exists.
  // If it does, the app was killed while a signup was in progress → restart.
  useEffect(() => {
    const checkKill = async () => {
      try {
        const wasKilled = await AsyncStorage.getItem(SIGNUP_BG_KEY);
        if (wasKilled) {
          // App was killed mid-signup — clean up and force restart
          await AsyncStorage.removeItem(SIGNUP_BG_KEY);
          const signupState = useSignupStore.getState();
          if (signupState.hasActiveSession()) {
            await cleanupIncompleteSignup();
          }
        }
      } catch {
        // silent — best effort
      }
    };
    checkKill();

  }, []);

  useEffect(() => {
    async function prepareAppLifecycle() {
      try {
        // Load local font vectors in the background
        await Font.loadAsync({
          'Inter-Regular': Inter_400Regular,
          'Inter-Medium': Inter_500Medium,
          'Inter-SemiBold': Inter_600SemiBold,
          'Inter-Bold': Inter_700Bold,
        });
        
        // Mount local MMKV states synchronously
        useThemeStore.getState();
        useSignupStore.getState();
        useNetworkStore.getState();

        // Initialize Local Database and Hydrate Profile Cache BEFORE Supabase Session.
        // Safety timeout: if SQLite init stalls (NPE, corrupted DB, etc.), don't block
        // the boot sequence forever — the app can still function without local cache.
        await Promise.race([
          (async () => {
            await initDB();
            await useAuthStore.getState().hydrateFromSQLite();
          })(),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      } catch (error) {
        console.warn("Silent Boot Warning: Isolated local configuration anomaly.", error);
      } finally {
        // Trigger React to start building the root UI tree
        setIsReady(true);
      }
    }
    
    prepareAppLifecycle();
  }, []);

  // Drop splash screen safely AFTER React has committed the first UI frame
  useEffect(() => {
    if (isReady) {
      NotificationRouter.setAppReady(true);
      setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, 50);
    }
  }, [isReady]);

  useEffect(() => {
    const netStore = useNetworkStore.getState();
    netStore.checkNetworkStatus();
    netStore.startListening();

    let fallbackInterval: ReturnType<typeof setInterval> | null = setInterval(
      () => netStore.checkNetworkStatus(),
      30000
    );

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        const signupState = useSignupStore.getState();
        if (signupState.hasActiveSession()) {
          AsyncStorage.setItem(SIGNUP_BG_KEY, '1').catch((err) => console.error('[Layout] save bg signup flag failed:', err));
        }
        if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null; }
        netStore.stopListening();
      } else if (nextState === 'active') {
        AsyncStorage.removeItem(SIGNUP_BG_KEY).catch((err) => console.error('[Layout] remove bg signup flag failed:', err));
        netStore.checkNetworkStatus();
        netStore.startListening();
        if (!fallbackInterval) fallbackInterval = setInterval(() => netStore.checkNetworkStatus(), 30000);
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      if (fallbackInterval) clearInterval(fallbackInterval);
      netStore.stopListening();
      sub.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register reconnection callback — when device comes back online, re-sync AND re-open realtime channels
  useEffect(() => {
    const unregister = registerOnlineCallback(async () => {
      // 0. Verify session is still valid before making any queries
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return; // Session expired — auth flow will handle redirect

      // 1. Process offline mutations BEFORE fetching new data to prevent collisions
      try {
        const { useMutationQueueStore } = require('../src/stores/mutationQueue.store');
        await useMutationQueueStore.getState().processQueue();
        await useMessageStore.getState().flushUnsentMessageQueue();
      } catch (e) {
        console.error('Failed to process offline queues:', e);
      }

      // 2. Re-open realtime channels and force-sync all stores
      useGlobalSyncStore.getState().resubscribe();
      // 2. Fetch missed messages for ALL cached groups (delta fetch since lastSeenAt)
      // This runs in parallel for all groups — fast and efficient
      const messageStore = useMessageStore.getState();
      const groups = useGroupStore.getState().groups;

      await Promise.allSettled(
        groups.map(async (group: any) => {
          const lastSeen = messageStore.getLastSeenAt(group.id);
          if (!lastSeen) return;
          try {
            const { data } = await (supabase as any).from('messages')
              .select('*, user:users!messages_sender_id_fkey(id, username, full_name, avatar_url, level, role), reply_to_message:messages!reply_to_id(id, content, user:users!messages_sender_id_fkey(username))')
              .eq('group_id', group.id)
              .eq('is_deleted', false)
              .gt('created_at', lastSeen)
              .order('created_at', { ascending: true });
            if (data && data.length > 0) {
              const formatted = (data as any[]).map(msg => ({
                ...msg,
                isEdited: msg.is_edited || false,
                replyTo: msg.reply_to_message ? {
                  id: msg.reply_to_message.id,
                  username: msg.reply_to_message.user?.username,
                  content: msg.reply_to_message.content?.substring(0, 50),
                } : null,
                status: 'sent',
                isOnline: false,
              }));
              messageStore.mergeMissedMessages(group.id, formatted);
            }
          } catch {
            // silent — miss recovery is best-effort
          }
        })
      );
    });
    return unregister;
  }, []);

  // ── Handle deep link URLs (password reset, OAuth redirect) ──────────────
  useEffect(() => {
    let lastProcessedUrl = '';

    // Handle URL that launched the app (cold start)
    const handleInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && initialUrl !== lastProcessedUrl) {
        lastProcessedUrl = initialUrl;
        const tokens = extractSessionFromUrl(initialUrl);
        if (tokens) {
          // Only set session from deep link if NOT in an active Google signup flow
          // (register-options.tsx handles its own setSession to avoid double-firing)
          const signupState = useSignupStore.getState();
          if (!signupState.isGoogleDelaying) {
            if (tokens.type === 'recovery') {
              if (signupState.hasCompletedPasswordReset) {
                return;
              }
              signupState.setIsRecoveryFlow(true);
            }
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
            });
            
            if (tokens.type === 'recovery') {
              // Always route to update-password — the screen handles expired/invalid sessions
              router.replace('/auth/update-password');
            } else if (sessionError) {
              console.warn('[DeepLink] setSession failed:', sessionError.message);
            }
          }
        } else {
          handleDeepLink(initialUrl);
        }
      }
    };
    handleInitialUrl();

    // Handle URLs received while app is already open (warm start)
    const subscription = Linking.addEventListener('url', async (event) => {
      if (event.url === lastProcessedUrl) return;
      lastProcessedUrl = event.url;
      const tokens = extractSessionFromUrl(event.url);
      if (tokens) {
        // Only set session from deep link if NOT in an active Google signup flow
        const signupState = useSignupStore.getState();
        if (!signupState.isGoogleDelaying) {
          if (tokens.type === 'recovery') {
            if (signupState.hasCompletedPasswordReset) {
              return;
            }
            signupState.setIsRecoveryFlow(true);
          }
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });

          if (tokens.type === 'recovery') {
            // Always route to update-password — the screen handles expired/invalid sessions
            router.replace('/auth/update-password');
          } else if (sessionError) {
            console.warn('[DeepLink] setSession failed:', sessionError.message);
          }
        }
      } else {
        handleDeepLink(event.url);
      }
    });

    return () => subscription.remove();
  }, []);

  if (!isReady) {
    return null;
  }

  // Check for critical environment variables before mounting the app
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <NalissLogo size={80} />
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#B91C1C', marginTop: 24, textAlign: 'center' }}>
          Config Error
        </Text>
        <Text style={{ fontSize: 14, color: '#475569', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
          The app is missing its connection information. If this is a production build, please ensure EAS Secrets are configured correctly.
        </Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <ProtectedRoute>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="auth" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="+not-found" />
          <Stack.Screen 
            name="viewer" 
            options={{
              headerShown: false,
              presentation: 'modal',
              animation: 'slide_from_bottom'
            }} 
          />
        </Stack>
        <GroupMembershipHandler />
        <HeartbeatBanner />
        <OverlayManager />
        <FeaturedStudentPopup />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </ProtectedRoute>
    </ThemeProvider>
  );
}

import { ErrorBoundary as CustomErrorBoundary } from '../src/components/common/ErrorBoundary';
export function ErrorBoundary(props: any) {
  return <CustomErrorBoundary {...props} />;
}

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <RootLayoutNav />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// export default Sentry.wrap(RootLayout); // DISABLED: Causing double-renders and splash screen sticking during syncAll
export default RootLayout;
