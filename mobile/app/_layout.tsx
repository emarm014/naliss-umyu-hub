import * as Sentry from '@sentry/react-native';

// ── Sentry: initialised before everything else so it catches all boot errors ──
const IS_PROD = process.env.EXPO_PUBLIC_APP_ENV === 'production';

Sentry.init({
  dsn: 'https://d788f703d8c028e11be19ad6c99b2822@o4511411773571072.ingest.de.sentry.io/4511413255995472',

  // ── Release & environment ─────────────────────────────────────────────────
  // These MUST match what the @sentry/react-native/expo plugin uploads source
  // maps under during an EAS build. Sentry uses release+dist to find the right
  // source map for a given crash, turning minified stack traces into readable ones.
  environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',

  // ── Tracing ──────────────────────────────────────────────────────────────
  // 100% in dev to see all spans; 20% in prod to control quota
  tracesSampleRate: IS_PROD ? 0.2 : 1.0,

  // ── Breadcrumbs ──────────────────────────────────────────────────────────
  // Keep last 150 breadcrumbs — enough to reconstruct the full sequence
  // leading up to any crash without overwhelming the Sentry event payload
  maxBreadcrumbs: 150,

  // Filter out noisy breadcrumbs that add no crash-diagnostic value
  beforeBreadcrumb(breadcrumb) {
    // Drop Expo/RN internal console.log noise
    if (breadcrumb.category === 'console' && breadcrumb.level === 'log') return null;
    // Drop XHR breadcrumbs for realtime heartbeat pings — they fire every 15s
    if (
      breadcrumb.category === 'xhr' &&
      typeof breadcrumb.data?.url === 'string' &&
      (breadcrumb.data.url.includes('/realtime/') || breadcrumb.data.url.includes('heartbeat'))
    ) return null;
    return breadcrumb;
  },

  // ── Capture config ───────────────────────────────────────────────────────
  // Disable native nagger — works in Expo Go without a native build
  enableNativeNagger: false,
  debug: !IS_PROD,
});

// ── Global console.error interception ──────────────────────────────────────
// Force all manual console.error() calls to be reported to Sentry as exceptions
const originalConsoleError = console.error;
console.error = (...args) => {
  originalConsoleError(...args); // Keep logging to terminal/bundler
  
  // Find if an actual Error object was passed
  const err = args.find(a => a instanceof Error);
  if (err) {
    Sentry.captureException(err, { tags: { source: 'console.error' } });
  } else {
    // Stringify everything else
    Sentry.captureMessage(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'error');
  }
};

// Inject explicit global async exception handlers
(globalThis as any).onunhandledrejection = (id: any, error: any) => {
    console.error('Captured Unhandled Promise Rejection:', error);
};
import { useEffect, useState, useRef } from 'react';
import { LogBox } from 'react-native';
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
import { Stack } from 'expo-router';
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
import { View, Text, Animated, Easing, AppState, AppStateStatus } from 'react-native';
import { COLORS } from '../src/constants/Colors';
import { NalissLogo } from '../src/components/NalissLogo';
import { initDB } from '../src/lib/database';
import { useAuthStore } from '../src/stores/auth.store';

// CRITICAL: Required for OAuth redirects to work correctly on Android.
// Without this, the browser closes immediately after the OAuth redirect
// because the app never signals that the auth session is complete.
WebBrowser.maybeCompleteAuthSession();
import { ProtectedRoute } from '../src/components/ProtectedRoute';
import { supabase } from '../src/api/supabase/client';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { useHeartbeat, HeartbeatBanner } from '../src/hooks/useHeartbeat';
import { OverlayManager } from '../src/components/common/overlays';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSignupStore } from '../src/stores/signup.store';
import { cleanupIncompleteSignup } from '../src/utils/signup-cleanup';
import { useThemeStore } from '../src/stores/theme.store';
import { FileService } from '../src/services/file.service';

// ── AppState breadcrumbs ──────────────────────────────────────────────────────
// Records every foreground/background transition so Sentry shows the exact
// moment the user backgrounded the app before a crash or ANR.
AppState.addEventListener('change', (nextState: AppStateStatus) => {
  Sentry.addBreadcrumb({
    category: 'app.lifecycle',
    message: `AppState → ${nextState}`,
    level: nextState === 'active' ? 'info' : 'warning',
    data: { state: nextState },
  });
});

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
function extractSessionFromUrl(url: string) {
  const fragment = url.split('#')[1];
  if (!fragment) return null;

  try {
    const params = fragment.split('&').reduce((acc, current) => {
      const [key, value] = current.split('=');
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {} as Record<string, string>);

    if (params.access_token && params.refresh_token) {
      return { access_token: params.access_token, refresh_token: params.refresh_token };
    }
  } catch {
    // silent — deep link session parse failure
  }
  return null;
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

    // Clean up old files from the vault (e.g. older than 30 days) to prevent OOM/storage bloating
    FileService.cleanVault(30);
  }, []);

  // ── Background/foreground tracking for kill detection ────────────────────
  // Write the key when going to background during signup.
  // Clear it when coming back to foreground (app was not killed).
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        // Going to background — write kill-detection key if signup is active
        const signupState = useSignupStore.getState();
        if (signupState.hasActiveSession()) {
          AsyncStorage.setItem(SIGNUP_BG_KEY, '1').catch(() => {});
        }
      } else if (nextState === 'active') {
        // Came back to foreground — app was NOT killed, clear the key
        AsyncStorage.removeItem(SIGNUP_BG_KEY).catch(() => {});
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    async function prepareAppLifecycle() {
      try {
        // Keep the Splash Screen active while we read local data from the phone's chip
        await Promise.all([
          (async () => {
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

             // Initialize Local Database and Hydrate Profile Cache BEFORE Supabase Session
             await initDB();
             await useAuthStore.getState().hydrateFromSQLite();
          })(),
          new Promise(resolve => setTimeout(resolve, 1200)) // Explicit intentional branding beat
        ]);
      } catch (error) {
        console.warn("Silent Boot Warning: Isolated local configuration anomaly.", error);
      } finally {
        // Smoothly drop the splash screen to reveal the UI dashboard instantly
        setIsReady(true);
        await SplashScreen.hideAsync();
      }
    }
    
    prepareAppLifecycle();
  }, []);

  useEffect(() => {
    const check = () => useNetworkStore.getState().checkNetworkStatus();
    check();
    // Reduced polling: 5s when active (down from 2s) — less battery drain
    // Most network changes are detected by the OS anyway via Network.getNetworkStateAsync
    let interval: ReturnType<typeof setInterval> | null = setInterval(check, 5000);

    const handleAppState = (nextState: string) => {
      if (nextState === 'active') {
        // App came to foreground — check immediately then resume polling
        check();
        if (!interval) interval = setInterval(check, 5000);
      } else {
        // App went to background — stop polling to save battery
        if (interval) { clearInterval(interval); interval = null; }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      if (interval) clearInterval(interval);
      sub.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Stable empty deps — checkNetworkStatus accessed via getState() to avoid re-run loop

  // Register reconnection callback — when device comes back online, re-sync AND re-open realtime channels
  useEffect(() => {
    const unregister = registerOnlineCallback(async () => {
      // 0. Verify session is still valid before making any queries
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return; // Session expired — auth flow will handle redirect

      // 1. Re-open realtime channels and force-sync all stores
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
    // Handle URL that launched the app (cold start)
    const handleInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        const tokens = extractSessionFromUrl(initialUrl);
        if (tokens) {
          // Only set session from deep link if NOT in an active Google signup flow
          // (register-options.tsx handles its own setSession to avoid double-firing)
          const signupState = useSignupStore.getState();
          if (!signupState.isGoogleDelaying) {
            await supabase.auth.setSession(tokens);
          }
        }
      }
    };
    handleInitialUrl();

    // Handle URLs received while app is already open (warm start)
    const subscription = Linking.addEventListener('url', async (event) => {
      const tokens = extractSessionFromUrl(event.url);
      if (tokens) {
        // Only set session from deep link if NOT in an active Google signup flow
        const signupState = useSignupStore.getState();
        if (!signupState.isGoogleDelaying) {
          await supabase.auth.setSession(tokens);
        }
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
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ProtectedRoute>
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

// Sentry.wrap instruments the root component for:
// - JS crash reporting
// - Unhandled promise rejections
// - Native crash reporting (when built with EAS)
export default Sentry.wrap(RootLayout);
