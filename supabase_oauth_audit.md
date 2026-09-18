# Supabase Client URL & Google OAuth Redirect URL Audit

**Auditor:** Principal React Native Engineer  
**Date:** September 18, 2026  
**Target Repository:** NALISS UMYU Hub (`mobile`)

---

## 1. SUPABASE CLIENT INITIALIZATION

### Location
File: [`mobile/src/api/supabase/client.ts`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/src/api/supabase/client.ts)  
*(Note: In this repository, the client is located at `mobile/src/api/supabase/client.ts`. The path `admin/src/lib/supabase.ts` is used by the admin web app).*

### Environment Variable Reading
The environment variable `EXPO_PUBLIC_SUPABASE_URL` is read directly via `process.env.EXPO_PUBLIC_SUPABASE_URL`:
```typescript
const supabaseUrl = sanitizeSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
```

### URL Sanitization & Typo Guard
The function `sanitizeSupabaseUrl` cleans the string, patches a known legacy transposition typo (`omrtnby...` -> `omrtbny...`), and falls back to a default project URL if missing or invalid:
```typescript
const sanitizeSupabaseUrl = (url: string): string => {
  let clean = (url || '').trim();
  if (clean.includes('omrtnbywneezpaozbvzd')) {
    clean = clean.replace('omrtnbywneezpaozbvzd', 'omrtbnywneezpaozbvzd');
  }
  if (!clean || !clean.startsWith('http')) {
    clean = 'https://omrtbnywneezpaozbvzd.supabase.co';
  }
  return clean;
};
```

### Exact URL Passed into `createClient`
`supabaseUrl` is passed as the first argument to `createClient`:
```typescript
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
```
- **Evaluated Value:** `https://omrtbnywneezpaozbvzd.supabase.co`

### Value in `mobile/.env`
From [`mobile/.env`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/.env#L1-L3):
```properties
# Supabase Configuration
EXPO_PUBLIC_SUPABASE_URL=https://omrtbnywneezpaozbvzd.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcnRibnl3bmVlenBhb3pidnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjE4NDUsImV4cCI6MjA4ODAzNzg0NX0.KWmN32ZtvpBNIoXOeMKlcHFySK7dSs1LH-_uv0yanK0
```

### Full Supabase Client Setup Snippet
[`mobile/src/api/supabase/client.ts:1-77`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/src/api/supabase/client.ts#L1-L77):
```typescript
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { mmkvStorage } from '../../stores/mmkv.storage';
import { Database } from './database.types';
import * as Sentry from '@sentry/react-native';

const sanitizeSupabaseUrl = (url: string): string => {
  let clean = (url || '').trim();
  if (clean.includes('omrtnbywneezpaozbvzd')) {
    clean = clean.replace('omrtnbywneezpaozbvzd', 'omrtbnywneezpaozbvzd');
  }
  if (!clean || !clean.startsWith('http')) {
    clean = 'https://omrtbnywneezpaozbvzd.supabase.co';
  }
  return clean;
};

const supabaseUrl = sanitizeSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Simple fetch wrapper that adds Sentry breadcrumbs for observability
const sentryFetch: typeof fetch = async (url, options) => {
  const startMs = Date.now();
  try {
    const response = await fetch(url as any, options);
    const durationMs = Date.now() - startMs;
    const urlStr = typeof url === 'string' ? url : (url as URL).toString();
    const urlPath = urlStr.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = options?.method ?? 'GET';

    Sentry.addBreadcrumb({
      category: 'api.supabase',
      message: `${method} ${urlPath} ${response.status} (${durationMs}ms)`,
      data: { path: urlPath, status: response.status, durationMs },
      level: response.ok ? (durationMs > 3000 ? 'warning' : 'debug') : 'error',
    });

    return response;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMsg = (err as Error)?.message || String(err);
    const isNetwork = errorMsg.toLowerCase().includes('network request failed') || 
                      errorMsg.toLowerCase().includes('failed to fetch');
    
    Sentry.addBreadcrumb({
      category: 'api.supabase',
      message: `Failed: ${options?.method ?? 'GET'} (${durationMs}ms)`,
      data: { error: errorMsg, durationMs },
      level: isNetwork ? 'warning' : 'error',
    });
    throw err;
  }
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mmkvStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // @ts-ignore
    initializeSession: true,
  },
  global: {
    fetch: sentryFetch as any,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
      heartbeatIntervalMs: 15000,
    },
    timeout: 20000,
  },
  db: {
    schema: 'public',
  },
});
```

---

## 2. GOOGLE OAUTH REDIRECT URL IN LOGIN

### Location
File: [`mobile/app/auth/login.tsx`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/app/auth/login.tsx#L271-L287)

### What is `redirectUrl` set to?
```typescript
const redirectUrl = Linking.createURL('auth/callback');
```

### Is it using `Linking.createURL('auth/callback')` or a custom scheme (`nalisshub://...`)?
It is using **`Linking.createURL('auth/callback')`**.

#### URI Scheme Evaluation
- Configured in [`mobile/app.json:9`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/app.json#L9) and Android intent filters:
  ```json
  "scheme": "naliss"
  ```
- **Standalone/EAS Android Build (`.apk` / `.aab`):**
  `Linking.createURL('auth/callback')` evaluates to:
  ```
  naliss://auth/callback
  ```
  *(Note: It does **not** use `nalisshub://`, the registered scheme is `naliss`).*
- **Expo Go development:**
  Evaluates to:
  ```
  exp://<host>:<port>/--/auth/callback
  ```

### Exact `signInWithOAuth` Invocation Block
[`mobile/app/auth/login.tsx:271-287`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/app/auth/login.tsx#L271-L287):
```typescript
      const redirectUrl = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      // Clear watchdog — browser returned control to the app
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }

      if (result.type === 'success' && (result as any).url) {
        await handleOAuthRedirect((result as any).url);
      } else {
        // User dismissed browser or backed out
        useSignupStore.getState().setIsGoogleDelaying(false);
        if (mmkv) {
          mmkv.remove('oauth_in_progress');
          mmkv.remove('oauth_start_time');
        }
      }
```

---

## 3. SUMMARY REFERENCE TABLE

| Component | Setting / Parameter | Active Value | Source File |
| :--- | :--- | :--- | :--- |
| **Env Variable** | `EXPO_PUBLIC_SUPABASE_URL` | `https://omrtbnywneezpaozbvzd.supabase.co` | [`mobile/.env:2`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/.env#L2) |
| **Client Initialization** | `createClient(supabaseUrl, ...)` | `https://omrtbnywneezpaozbvzd.supabase.co` | [`mobile/src/api/supabase/client.ts:55`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/src/api/supabase/client.ts#L55) |
| **OAuth Redirect Target** | `redirectTo` | `Linking.createURL('auth/callback')` | [`mobile/app/auth/login.tsx:271`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/app/auth/login.tsx#L271) |
| **App Scheme** | `scheme` | `naliss` | [`mobile/app.json:9`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/app.json#L9) |
| **Runtime Callback URI** | Production APK / Standalone | `naliss://auth/callback` | Generated by Expo `Linking` |
| **OAuth Handler** | `handleOAuthRedirect` | Session code/token exchange | [`mobile/src/utils/oauth-redirect.ts:22`](file:///c:/Users/Emerm/Desktop/naliss-umyu-hub/mobile/src/utils/oauth-redirect.ts#L22) |

---

## 4. OAUTH REDIRECT HANDLER AUDIT (`mobile/src/utils/oauth-redirect.ts`)

### Full Implementation of `handleOAuthRedirect`
```typescript
export async function handleOAuthRedirect(url: string): Promise<void> {
  const mmkv = getRawStorage();

  // ── 1. Parse code/token from the callback URL ──────────────────────────────
  let code: string | null = null;
  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  try {
    // Check query params for PKCE `code`
    const queryPart = url.split('?')[1]?.split('#')[0] || '';
    const queryParams = new URLSearchParams(queryPart);
    code = queryParams.get('code');

    // Check fragment for implicit flow tokens
    const fragment = url.split('#')[1] || '';
    const hashParams = new URLSearchParams(fragment);
    accessToken = hashParams.get('access_token') || queryParams.get('access_token');
    refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
  } catch {
    console.warn('[Auth] Failed to parse OAuth callback URL:', url);
    clearOAuthFlags(mmkv);
    return;
  }

  if (!code && !accessToken) {
    console.warn('[Auth] OAuth callback URL has no code or access_token:', url);
    clearOAuthFlags(mmkv);
    return;
  }

  // ── 2. Exchange code / set session ─────────────────────────────────────────
  try {
    let user = null;

    if (code) {
      // PKCE flow: exchange authorization code for session
      const { data: sessionData, error: sessionErr } = await supabase.auth.exchangeCodeForSession(code);
      if (sessionErr) throw sessionErr;
      user = sessionData.session?.user ?? null;
    } else if (accessToken && refreshToken) {
      // Implicit flow: set session directly from tokens
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession) {
        user = existingSession.user;
      } else {
        const { data: { user: sessionUser }, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
        user = sessionUser;
      }
    }

    if (!user) {
      console.warn('[Auth] No user returned after OAuth session exchange.');
      clearOAuthFlags(mmkv);
      return;
    }

    // ── 3. Validate user ─────────────────────────────────────────────────────

    // 3a. Institutional email gate
    if (user.email && !INSTITUTIONAL_EMAIL_REGEX.test(user.email)) {
      await AuthGuardian.recordFailure(user.email);
      try {
        await (supabase as any).rpc('purge_incomplete_account', { email_addr: user.email });
      } catch {}
      Alert.alert('Access Denied', 'Only institutional student emails (@students.umyu.edu.ng) are allowed.');
      await supabase.auth.signOut();
      clearOAuthFlags(mmkv);
      return;
    }

    // 3b. Profile checks (graduated, external moderator, incomplete)
    if (user.id) {
      const { data: profileCheck } = await (supabase as any).from('users')
        .select('status, level, registration_number, role, is_external')
        .eq('id', user.id)
        .maybeSingle();

      // External moderator gate
      if (
        profileCheck?.is_external === true ||
        (profileCheck?.role === 'moderator' && !profileCheck?.registration_number && !profileCheck?.level)
      ) {
        Alert.alert(
          'Access Denied',
          'External moderators are restricted to the Web Admin Portal only and cannot log into the mobile app.',
          [{ text: 'OK', style: 'default' }]
        );
        await supabase.auth.signOut();
        clearOAuthFlags(mmkv);
        return;
      }

      // Graduated student gate
      if (profileCheck?.status === 'graduated') {
        Alert.alert(
          'Account Graduated',
          'This account belongs to a graduated student. The NALISS UMYU Hub is only for currently enrolled students.\n\nYour alumni record is preserved in the system.',
          [{ text: 'OK', style: 'default' }]
        );
        await supabase.auth.signOut();
        clearOAuthFlags(mmkv);
        return;
      }

      // Incomplete registration → route to identity screen (step 2)
      if (!profileCheck || !profileCheck.level || !profileCheck.registration_number) {
        const store = useSignupStore.getState();
        store.setProvider('google');
        store.setCredentials(user.email!, undefined);
        store.setGoogleTokens(user.email!, accessToken || '', refreshToken || '');
        store.setCurrentStep(2);
        store.touchActivity();
        useAuthStore.getState().setIsProfileComplete(false);
        store.setIsGoogleDelaying(false);
        clearOAuthFlags(mmkv);
        router.replace('/auth/identity' as any);
        return;
      }
    }

    // ── 4. Complete profile — route to main app ──────────────────────────────
    useSignupStore.getState().setIsGoogleDelaying(false);
    await useAuthStore.getState().fetchProfile(true);
    await useAuthStore.getState().checkProfileComplete(user.id);
    clearOAuthFlags(mmkv);
    router.replace('/(tabs)' as any);
  } catch (err: any) {
    console.error('[Auth] OAuth redirect handling failed:', err);
    useSignupStore.getState().setIsGoogleDelaying(false);
    clearOAuthFlags(mmkv);

    // Log failure (best-effort)
    (async () => {
      try {
        await (supabase as any).from('activity_logs' as any).insert({
          action: 'auth.login_failed',
          entity_type: 'auth',
          description: 'Failed Google sign-in (OAuth redirect)',
          metadata: { reason: err?.message || 'Unknown', method: 'google' },
        });
      } catch (_) {}
    })();

    Alert.alert('Sign-In Failed', 'Google sign-in could not be completed. Please try again.');
  }
}
```

### Key Diagnostic Scans:
1. **URL & Token Parsing:**  
   Parses PKCE `code` from query params `url.split('?')[1]?.split('#')[0]` via `URLSearchParams.get('code')`. Parses implicit tokens (`access_token`, `refresh_token`) from the hash fragment `#` via `URLSearchParams(fragment)`.
2. **Session Invocation:**  
   - PKCE: `supabase.auth.exchangeCodeForSession(code)`  
   - Implicit: `supabase.auth.setSession({ access_token, refresh_token })`
3. **Routing:**  
   - Incomplete profile: `router.replace('/auth/identity')` (step 2)  
   - Complete profile: `router.replace('/(tabs)')`  
   - Access denied (graduated / non-institutional / external moderator): signed out with alert dialog. Provider collision lockout removed to permit unified sign-in.

