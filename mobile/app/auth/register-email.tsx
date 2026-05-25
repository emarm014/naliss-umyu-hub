import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, SafeAreaView, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { INSTITUTIONAL_EMAIL_REGEX } from '../../src/utils/validation';
import { AuthGuardian } from '../../src/utils/auth-guardian';
import { useSignupStore } from '../../src/stores/signup.store';
import { useNetworkStore } from '../../src/stores/network.store';
import { cleanupIncompleteSignup } from '../../src/utils/signup-cleanup';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError, trackFeature } from '../../src/utils/sentry';

function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 5, marginBottom: 28 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{
          flex: 1, height: 4, borderRadius: 2,
          backgroundColor: i < current ? COLORS.primary : '#e2e8f0',
        }} />
      ))}
    </View>
  );
}

export default function RegisterEmail() {
  useSentryScreen('RegisterEmail');
  const [email, setEmail] = useState('');
  const [focused, setFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const isMounted = useRef(true);
  const router = useRouter();

  useEffect(() => {
    isMounted.current = true;
    const store = useSignupStore.getState();
    if (store.email && store.currentStep === 1) {
      setEmail(store.email);
    }
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const store = useSignupStore.getState();
    if (store.lastActivityTime && store.hasTimedOut()) {
      store.reset();
      return;
    }
    store.touchActivity();
    store.setCurrentStep(1);
  }, []);

  const handleNext = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    // ── Pre-flight checks (before loading state) ──────────────────────────
    if (!trimmedEmail) {
      Alert.alert('Required', 'Please enter your institutional email');
      return;
    }

    const online = await useNetworkStore.getState().checkNetworkStatus();
    if (!online) {
      Alert.alert('No Connection', 'You need an internet connection to register.');
      return;
    }

    const banHours = await AuthGuardian.checkBanStatus(trimmedEmail);
    if (banHours) {
      Alert.alert('Too Many Attempts', `Please try again in ${banHours} hour${banHours > 1 ? 's' : ''}.`);
      return;
    }

    if (!INSTITUTIONAL_EMAIL_REGEX.test(trimmedEmail)) {
      const attempts = await AuthGuardian.recordFailure(trimmedEmail);
      const remaining = 10 - attempts;
      if (remaining <= 0) {
        Alert.alert('Device Locked', 'Too many invalid attempts. Please try again in 4 hours.');
      } else {
        Alert.alert('Invalid Email', `Only UMYU institutional emails are accepted.\n(${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)`);
      }
      return;
    }

    await AuthGuardian.clearFailures(trimmedEmail);

    if (!isMounted.current) return;
    setIsLoading(true);
    setLoadingStatus('Checking…');

    try {
      // STEP 1: Clear any stale session only if one exists — silently, never blocks
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) await supabase.auth.signOut();
      } catch { /* silent */ }

      // STEP 2: Check if registration is open — silently, never blocks OTP
      try {
        const { data: regSetting } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'allow_registration')
          .maybeSingle();
        if (regSetting?.value === 'false') {
          Alert.alert('Registration Closed', 'New student registrations are currently closed. Please contact the administrator.');
          return;
        }
      } catch {
        // Settings check failed — allow through, server enforces this
      }

      setLoadingStatus('Verifying email…');
      if (!isMounted.current) return;

      // STEP 3: Check if account already exists
      // If RPC fails for any reason, allow through — the OTP itself proves email ownership,
      // and the DB constraint at profile creation is the real guard against duplicates.
      let provider = 'none';
      try {
        const { data, error } = await supabase.rpc('check_existing_account', { email_addr: trimmedEmail });
        if (!error && data) provider = data;
      } catch {
        // RPC failed — allow through, server enforces rules at profile creation
      }

      if (provider === 'google') {
        Alert.alert('Use Google Sign-In', 'This email is registered via Google. Please use "Continue with Google" instead.');
        return;
      }
      if (provider === 'graduated') {
        Alert.alert('Account Graduated', 'This email belongs to a graduated student. Access is restricted to active students only.');
        return;
      }
      if (provider === 'email') {
        Alert.alert(
          'Already Registered',
          'This email already has an account. Please sign in instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign In', onPress: () => router.replace('/auth/login') },
          ]
        );
        return;
      }

      // STEP 4: Save email and send OTP
      const store = useSignupStore.getState();
      store.setCredentials(trimmedEmail, undefined);

      setLoadingStatus('Sending verification code…');
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { shouldCreateUser: true },
      });
      if (otpError) throw otpError;

      if (!isMounted.current) return;

      // STEP 5: Update store and navigate immediately — no success state freeze
      store.setCurrentStep(2);
      store.touchActivity();

      if (!isMounted.current) return;
      router.push({ pathname: '/auth/register-otp' as any, params: { email: trimmedEmail } });

    } catch (err: any) {
      captureUIError('RegisterEmail.handleContinue', err, { email: email.trim().toLowerCase() });
      if (!isMounted.current) return;
      const msg = (err?.message || '').toLowerCase();

      if (err?.name === 'AbortError' || msg.includes('timeout') || msg.includes('connection')) {
        Alert.alert('Connection Timeout', 'The request took too long. Please check your connection and try again.');
      } else if (msg.includes('rate') || msg.includes('429')) {
        Alert.alert('Too Many Requests', 'Please wait a few minutes before trying again.');
      } else {
        Alert.alert('Something Went Wrong', `Could not send the verification code.\n\nError: ${err?.message || 'Unknown error'}`);
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
        setLoadingStatus(null);
      }
    }
  };

  const handleSignInRedirect = async () => {
    await cleanupIncompleteSignup();
    router.replace('/auth/login');
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.nav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.signInBtn} onPress={handleSignInRedirect}>
          <Ionicons name="log-in-outline" size={16} color="#fff" />
          <Text style={styles.signInBtnText}>Sign In</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <StepBar current={1} total={5} />

        <Text style={styles.stepLabel}>Step 1 of 5</Text>
        <Text style={styles.title}>Institutional Email</Text>
        <Text style={styles.subtitle}>Enter your university email to begin registration</Text>

        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>Institutional Email</Text>
          <View style={[styles.inputRow, focused && styles.inputFocused]}>
            <Ionicons name="mail-outline" size={18} color={focused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="@students.umyu.edu.ng"
              placeholderTextColor="#cbd5e1"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              keyboardType="email-address"
              autoFocus
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              editable={!isLoading}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.btn, isLoading && styles.btnDisabled]}
          onPress={handleNext}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <View style={styles.btnInner}>
              <ActivityIndicator color="#fff" size="small" />
              {loadingStatus && <Text style={styles.btnText}>{loadingStatus}</Text>}
            </View>
          ) : (
            <View style={styles.btnInner}>
              <Text style={styles.btnText}>Verify</Text>
              <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
  },
  backBtn: { padding: 10, borderRadius: 12, backgroundColor: '#f1f5f9' },
  signInBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  signInBtnText: { fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' },
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  stepLabel: { fontSize: 11, fontFamily: 'Inter-Bold', color: COLORS.primary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  title: { fontSize: 26, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', lineHeight: 20, marginBottom: 32 },
  fieldWrap: { marginBottom: 24 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8fafc', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e2e8f0',
    paddingHorizontal: 14, height: 54,
  },
  inputFocused: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter-Regular', color: '#0f172a' },
  btn: {
    backgroundColor: COLORS.primary, height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  btnDisabled: { opacity: 0.75 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold' },
});
