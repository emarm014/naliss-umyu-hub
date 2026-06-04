import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../src/constants/Colors';
import { NalissLogo } from '../../src/components/NalissLogo';
import { supabase } from '../../src/api/supabase/client';
import { INSTITUTIONAL_EMAIL_REGEX } from '../../src/utils/validation';
import { useSignupStore } from '../../src/stores/signup.store';
import { useSettingsStore } from '../../src/stores/settings.store';
import { useNetworkStore } from '../../src/stores/network.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError, trackFeature } from '../../src/utils/sentry';
import * as Sentry from '@sentry/react-native';

export default function RegisterOptions() {
  useSentryScreen('RegisterOptions');
  const router = useRouter();

  // Read from store — will update in real-time via the subscription below
  const { allowRegistration, fetchSettings, initializeListener } = useSettingsStore();

  // Track whether the initial fresh fetch has completed
  const [isFetching, setIsFetching] = useState(true);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    // 1. Always fetch fresh from DB on mount — bypasses stale AsyncStorage cache
    fetchSettings().finally(() => {
      if (isMounted.current) setIsFetching(false);
    });

    // 2. Start a dedicated realtime subscription for this screen so changes
    //    from the admin panel reflect instantly without needing a refresh
    const unsubscribe = initializeListener();

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, []);

  const handleGoogleAuth = async () => {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);
    trackFeature('signup', 'google_oauth_start');

    try {
      const { isOnline } = useNetworkStore.getState();
      if (!isOnline) {
        Alert.alert('No Connection', 'You need an internet connection to sign up with Google.');
        if (isMounted.current) setIsGoogleLoading(false);
        return;
      }

      const store = useSignupStore.getState();
      store.reset();
      store.touchActivity();

      // ── STEP 1: Get OAuth URL ─────────────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 1: Getting OAuth URL', level: 'info' });
      const redirectUrl = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');

      store.setIsGoogleDelaying(true);

      // ── STEP 2: Open browser ──────────────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 2: Opening OAuth browser', level: 'info' });
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type !== 'success' || !result.url) {
        Sentry.addBreadcrumb({ category: 'signup.google', message: 'OAuth cancelled by user', level: 'info' });
        store.setIsGoogleDelaying(false);
        store.reset();
        if (isMounted.current) setIsGoogleLoading(false);
        return;
      }

      if (!isMounted.current) { store.setIsGoogleDelaying(false); return; }

      // ── STEP 3: Parse tokens ──────────────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 3: Parsing OAuth tokens', level: 'info' });
      const url = result.url;
      const hashPart = url.split('#')[1] || '';
      const queryPart = url.split('?')[1]?.split('#')[0] || '';
      const hashParams = new URLSearchParams(hashPart);
      const queryParams = new URLSearchParams(queryPart);
      const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');

      if (!accessToken || !refreshToken) {
        Sentry.captureMessage('Google OAuth: missing tokens in redirect URL', 'warning');
        store.setIsGoogleDelaying(false);
        store.reset();
        if (isMounted.current) {
          setIsGoogleLoading(false);
          Alert.alert('Sign In Failed', 'Could not complete Google sign-in. Please try again.');
        }
        return;
      }

      // ── STEP 4: Set session ───────────────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 4: Setting Supabase session', level: 'info' });
      const { data: { user }, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) throw sessionError;
      if (!user) throw new Error('No user returned from Google');

      // ── STEP 5: Validate email domain ─────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 5: Validating institutional email', level: 'info', data: { email: user.email } });
      if (!user.email || !INSTITUTIONAL_EMAIL_REGEX.test(user.email)) {
        store.setIsGoogleDelaying(false);
        await supabase.auth.signOut();
        store.reset();
        if (isMounted.current) {
          setIsGoogleLoading(false);
          Alert.alert('Wrong Google Account', 'Please use your UMYU institutional Google account (@students.umyu.edu.ng).');
        }
        return;
      }

      if (!isMounted.current) { store.setIsGoogleDelaying(false); return; }

      // ── STEP 6: Check account status ──────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 6: Checking account status', level: 'info' });
      try {
        const { data: accountStatus } = await supabase.rpc('check_existing_account', { email_addr: user.email });

        if (accountStatus === 'graduated') {
          store.setIsGoogleDelaying(false);
          await supabase.auth.signOut();
          store.reset();
          if (isMounted.current) { setIsGoogleLoading(false); Alert.alert('Account Graduated', 'This email belongs to a graduated student. Access is restricted to active students only.'); }
          return;
        }
        if (accountStatus === 'email') {
          store.setIsGoogleDelaying(false);
          await supabase.auth.signOut();
          store.reset();
          if (isMounted.current) { setIsGoogleLoading(false); Alert.alert('Account Exists', 'This email is already registered. Please sign in instead.'); }
          return;
        }
        if (accountStatus === 'google') {
          Sentry.addBreadcrumb({ category: 'signup.google', message: 'Existing Google account — redirecting to tabs', level: 'info' });
          store.setIsGoogleDelaying(false);
          if (isMounted.current) setIsGoogleLoading(false);
          return;
        }
      } catch (rpcErr) {
        // RPC failed — proceed anyway, server enforces rules at profile creation
        Sentry.addBreadcrumb({ category: 'signup.google', message: 'check_existing_account RPC failed — proceeding', level: 'warning', data: { error: (rpcErr as any)?.message } });
      }

      if (!isMounted.current) { store.setIsGoogleDelaying(false); return; }

      // ── STEP 7: Navigate to identity ──────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 7: Navigating to identity screen', level: 'info' });
      store.setProvider('google');
      store.setCredentials(user.email!, undefined);
      store.setGoogleTokens(user.email!, accessToken, refreshToken);
      store.setCurrentStep(2);
      store.touchActivity();
      store.setIsGoogleDelaying(false);

      if (isMounted.current) {
        setIsGoogleLoading(false);
        router.replace('/auth/identity' as any);
      }

    } catch (err: any) {
      useSignupStore.getState().setIsGoogleDelaying(false);
      useSignupStore.getState().reset();
      if (isMounted.current) {
        setIsGoogleLoading(false);
        const msg = err?.message || '';
        if (!msg.includes('cancelled') && !msg.includes('cancel')) {
          captureUIError('RegisterOptions.handleGoogleAuth', err);
          Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
        }
      }
    }
  };

  // ── Main register options screen ────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />

      {/* Top nav */}
      <View style={styles.topNav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/auth/login')}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.loginPill} onPress={() => router.replace('/auth/login')}>
          <Text style={styles.loginPillText}>Sign In</Text>
          <Ionicons name="log-in-outline" size={15} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <NalissLogo size={64} />
          </View>
          <Text style={styles.title}>Create Account</Text>

          {/* Show spinner while initial fetch is in progress */}
          {isFetching ? (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 8 }} />
          ) : (
            <Text style={styles.subtitle}>
              {allowRegistration
                ? 'Choose your preferred registration method'
                : 'Institutional registration is currently closed.'}
            </Text>
          )}
        </View>

        {/* Only render content once initial fetch is done */}
        {!isFetching && (
          <>
            {/* Closed banner */}
            {!allowRegistration && (
              <View style={styles.closedBanner}>
                <Ionicons name="lock-closed" size={18} color="#b91c1c" />
                <Text style={styles.closedText}>
                  New student signups are temporarily disabled by the administration. Contact your department for assistance.
                </Text>
              </View>
            )}

            {/* Options */}
            <View style={[styles.options, !allowRegistration && { opacity: 0.45 }]}>
              {/* Email option */}
              <TouchableOpacity
                style={styles.optionCard}
                onPress={() => allowRegistration && router.push('/auth/register-email')}
                disabled={!allowRegistration}
                activeOpacity={0.75}
              >
                <LinearGradient colors={['#e0f2fe', '#bae6fd']} style={styles.optionIcon}>
                  <Ionicons name="mail" size={22} color="#0284c7" />
                </LinearGradient>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Sign up with Email</Text>
                  <Text style={styles.optionSub}>Use your institutional address</Text>
                </View>
                <View style={styles.optionArrow}>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </View>
              </TouchableOpacity>

              {/* Google option */}
              <TouchableOpacity
                style={[
                  styles.optionCard,
                  (isGoogleLoading || !allowRegistration) && styles.optionDisabled,
                ]}
                onPress={() => allowRegistration && handleGoogleAuth()}
                disabled={isGoogleLoading || !allowRegistration}
                activeOpacity={0.75}
              >
                <LinearGradient colors={['#fee2e2', '#fecaca']} style={styles.optionIcon}>
                  {isGoogleLoading ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Ionicons name="logo-google" size={22} color="#ef4444" />
                  )}
                </LinearGradient>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Continue with Google</Text>
                  <Text style={styles.optionSub}>Fast and secure access</Text>
                </View>
                <View style={styles.optionArrow}>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Info note */}
            <View style={styles.infoNote}>
              <Ionicons name="information-circle-outline" size={17} color="#64748b" />
              <Text style={styles.infoNoteText}>
                Exclusively for LIS Department students, UMYU Katsina.
              </Text>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  topNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backBtn: { padding: 10, borderRadius: 12, backgroundColor: '#f1f5f9' },
  loginPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#f0fdf4', borderRadius: 20,
    borderWidth: 1, borderColor: '#bbf7d0',
  },
  loginPillText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: COLORS.primary },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  header: { alignItems: 'center', marginBottom: 36 },
  logoWrap: {
    width: 88, height: 88, borderRadius: 26,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15, shadowRadius: 14, elevation: 6,
    borderWidth: 1, borderColor: '#dcfce7',
  },
  title: { fontSize: 26, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', textAlign: 'center', lineHeight: 20 },
  closedBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fef2f2', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#fecaca', marginBottom: 24,
  },
  closedText: { flex: 1, fontSize: 13, fontFamily: 'Inter-Regular', color: '#b91c1c', lineHeight: 18 },
  options: { gap: 14, marginBottom: 28 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 18,
    padding: 16, gap: 14,
    borderWidth: 1.5, borderColor: '#f1f5f9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  optionDisabled: { opacity: 0.85 },
  optionIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 15, fontFamily: 'Inter-SemiBold', color: '#0f172a', marginBottom: 2 },
  optionSub: { fontSize: 12, fontFamily: 'Inter-Regular', color: '#64748b' },
  optionArrow: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center',
  },
  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#f1f5f9', borderRadius: 14, padding: 14,
  },
  infoNoteText: { flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: '#475569', lineHeight: 18 },
});
