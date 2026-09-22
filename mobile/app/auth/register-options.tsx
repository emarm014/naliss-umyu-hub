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
import { useAuthStore } from '../../src/stores/auth.store';
import { useNetworkStore } from '../../src/stores/network.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError, trackFeature } from '../../src/utils/sentry';
import * as Sentry from '@sentry/react-native';
import { useRegistrationLimiter } from '../../src/stores/registration-limiter.store';
import { normalizeError } from '../../src/utils/sentry';

export default function RegisterOptions() {
  useSentryScreen('RegisterOptions');
  const router = useRouter();

  // Local state for registration flag — fetched directly as anon (no session needed)
  const [allowRegistration, setAllowRegistration] = useState(true);

  // Track whether the initial fresh fetch has completed
  const [isFetching, setIsFetching] = useState(true);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    // 1. Fetch allow_registration directly as anonymous user (no session guard)
    const fetchRegistrationStatus = async () => {
      try {
        const { data, error } = await (supabase as any).from('system_settings')
          .select('value')
          .eq('key', 'allow_registration')
          .maybeSingle();

        if (!error && data && isMounted.current) {
          setAllowRegistration(data.value !== 'false');
        }
      } catch {
        // On error, default to true — server-side trigger is the final guard
      } finally {
        if (isMounted.current) setIsFetching(false);
      }
    };

    fetchRegistrationStatus();

    // 2. Realtime subscription — works without auth, listens for admin changes
    const channel = supabase
      .channel(`reg_options_settings_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: 'key=eq.allow_registration' },
        (payload) => {
          const record = payload.new as any;
          if (record?.key === 'allow_registration' && isMounted.current) {
            setAllowRegistration(record.value !== 'false');
          }
        }
      )
      .subscribe();

    return () => {
      isMounted.current = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const handleEmailSignup = async () => {
    try {
      // Check if this device had a previous orphan record from a reinstall or back navigation
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !useAuthStore.getState().isProfileComplete) {
        await (supabase as any).rpc('delete_incomplete_signup');
        await supabase.auth.signOut();
      } else if (session) {
        await supabase.auth.signOut();
      }
    } catch { /* silent */ }
    useSignupStore.getState().reset();
    router.push('/auth/register-email');
  };

  const handleGoogleAuth = async () => {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);
    trackFeature('signup', 'google_oauth_start');

    const store = useSignupStore.getState();
    store.setIsGoogleDelaying(true);
    store.touchActivity();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.auth.signOut(); // clear any lingering orphan session
      }

      const { isOnline } = useNetworkStore.getState();
      if (!isOnline) {
        store.setIsGoogleDelaying(false);
        Alert.alert('No Connection', 'You need an internet connection to sign up with Google.');
        if (isMounted.current) setIsGoogleLoading(false);
        return;
      }

      const limiter = useRegistrationLimiter.getState();

      if (limiter.checkLimit()) {
        store.setIsGoogleDelaying(false);
        const mins = limiter.getRemainingTime() || 60;
        Alert.alert(
          '⚠️ Registration attempt limit reached',
          `Please wait for your limit to reset before trying again. (${mins} min remaining)`
        );
        if (isMounted.current) setIsGoogleLoading(false);
        return;
      }

      store.reset();

      // Track the attempt
      limiter.incrementAttempt();

      // ── STEP 1: Get OAuth URL ─────────────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 1: Getting OAuth URL', level: 'info' });
      // CRITICAL FIX: Use auth/callback to match login.tsx so the deep link routes to callback.tsx,
      // avoiding index.tsx which kicks incomplete users to the login screen.
      const redirectUrl = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });

      if (error) throw normalizeError(error);
      if (!data.url) throw new Error('No OAuth URL returned');

      // ── STEP 2: Open browser ──────────────────────────────────────────────
      Sentry.addBreadcrumb({ category: 'signup.google', message: 'Step 2: Opening OAuth browser', level: 'info' });
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type === 'success' && (result as any).url) {
        // Let the global OAuth redirect handler parse the tokens and setup the store
        const { handleOAuthRedirect } = require('../../src/utils/oauth-redirect');
        await handleOAuthRedirect((result as any).url);
      } else {
        Sentry.addBreadcrumb({ category: 'signup.google', message: 'OAuth cancelled by user', level: 'info' });
        store.setIsGoogleDelaying(false);
        store.reset();
      }

    } catch (err: any) {
      store.setIsGoogleDelaying(false);
      store.reset();
      if (isMounted.current) {
        const msg = err?.message || '';
        if (!msg.includes('cancelled') && !msg.includes('cancel')) {
          captureUIError('RegisterOptions.handleGoogleAuth', err);
          Alert.alert('Sign In Failed', 'Google sign-in failed. Please try again.');
        }
      }
    } finally {
      if (isMounted.current) {
        setIsGoogleLoading(false);
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
                onPress={() => allowRegistration && handleEmailSignup()}
                disabled={!allowRegistration}
                activeOpacity={0.75}
              >
                <LinearGradient colors={['#e0f2fe', '#bae6fd']} style={styles.optionIcon}>
                  <Ionicons name="mail" size={22} color="#0284c7" />
                </LinearGradient>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Sign up with Email</Text>
                  <Text style={styles.optionSub}>{allowRegistration ? 'Use your institutional address' : 'Currently locked'}</Text>
                </View>
                <View style={styles.optionArrow}>
                  <Ionicons name={allowRegistration ? 'chevron-forward' : 'lock-closed'} size={16} color={allowRegistration ? '#94a3b8' : '#b91c1c'} />
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
                  <Text style={styles.optionSub}>{allowRegistration ? 'Fast and secure access' : 'Currently locked'}</Text>
                </View>
                <View style={styles.optionArrow}>
                  <Ionicons name={allowRegistration ? 'chevron-forward' : 'lock-closed'} size={16} color={allowRegistration ? '#94a3b8' : '#b91c1c'} />
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
