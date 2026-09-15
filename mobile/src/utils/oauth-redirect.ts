import { Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../api/supabase/client';
import { useAuthStore } from '../stores/auth.store';
import { useSignupStore } from '../stores/signup.store';
import { getRawStorage } from '../stores/mmkv.storage';
import { INSTITUTIONAL_EMAIL_REGEX } from './validation';
import { AuthGuardian } from './auth-guardian';

/**
 * Centralized OAuth callback handler.
 *
 * Handles both PKCE (`code=` in query params) and implicit flow
 * (`access_token=` in URL fragment). After exchanging/setting the session,
 * runs the full profile-validation gauntlet before routing to the correct
 * destination screen.
 *
 * Shared between:
 *   - _layout.tsx  (cold-start deep link recovery)
 *   - login.tsx    (warm-start after WebBrowser returns)
 */
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

    // 3b. Block Google login for email-registered accounts
    if (user.app_metadata?.provider === 'email') {
      Alert.alert(
        'Use Email Sign-In',
        'This account is registered via Email and Password. Please sign in using your password.',
        [{ text: 'OK', style: 'default' }]
      );
      await supabase.auth.signOut();
      clearOAuthFlags(mmkv);
      return;
    }

    // 3c. Profile checks (graduated, external moderator, incomplete)
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
        return;
      }
    }

    // ── 4. Complete profile — route to main app ──────────────────────────────
    useSignupStore.getState().setIsGoogleDelaying(false);
    await useAuthStore.getState().fetchProfile(true);
    await useAuthStore.getState().checkProfileComplete(user.id);
    clearOAuthFlags(mmkv);
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

/** Clears MMKV OAuth recovery flags. */
function clearOAuthFlags(mmkv: any | null): void {
  if (mmkv) {
    mmkv.remove('oauth_in_progress');
    mmkv.remove('oauth_start_time');
  }
}
