import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError } from '../../src/utils/sentry';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, SafeAreaView, StatusBar, AppState, AppStateStatus,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { useSignupStore } from '../../src/stores/signup.store';
import { NalissLogo } from '../../src/components/NalissLogo';
import { cleanupIncompleteSignup } from '../../src/utils/signup-cleanup';

const OTP_LENGTH = 6;
const MAX_RESENDS = 3;
const RESEND_LOCK_MINUTES = 30;
const INITIAL_COOLDOWN = 60;

function formatLockCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

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

export default function RegisterOTP() {
  useSentryScreen('RegisterOTP');
  const { email } = useLocalSearchParams<{ email: string }>();
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(INITIAL_COOLDOWN);
  const [resendCount, setResendCount] = useState(0);
  const [lockCountdown, setLockCountdown] = useState<string | null>(null);
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const isMounted = useRef(true);
  const initDone = useRef(false); // prevents re-running init on AppState changes
  const autoVerifyAttempted = useRef(false); // prevents double auto-verify
  const router = useRouter();

  // Lock countdown ticker
  useEffect(() => {
    if (!lockedUntilMs) return;
    const tick = () => {
      const remaining = lockedUntilMs - Date.now();
      if (remaining <= 0) {
        if (isMounted.current) {
          setLockCountdown(null);
          setLockedUntilMs(null);
          setResendCount(0);
          useSignupStore.getState().clearOTPResendState(email as string);
        }
        return;
      }
      if (isMounted.current) setLockCountdown(formatLockCountdown(remaining));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockedUntilMs]);

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(p => p - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // ── Auto-verify: fires whenever all 6 digits are filled ──────────────────
  // Works for both iOS system suggestion and Android clipboard paste.
  // autoVerifyAttempted ref prevents double-firing if the effect re-runs.
  useEffect(() => {
    const code = otp.join('');
    if (code.length !== OTP_LENGTH) {
      // Reset the guard when digits are cleared so user can retry
      autoVerifyAttempted.current = false;
      return;
    }
    if (autoVerifyAttempted.current) return;
    autoVerifyAttempted.current = true;
    // Small tick to let the last digit render before the verify call
    const t = setTimeout(() => handleVerify(), 120);
    return () => clearTimeout(t);
  }, [otp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unified Clipboard Parsing ─────────────────────────────────────────────
  // We aggressively check the clipboard when the component mounts and whenever
  // the app transitions from the background to active state (e.g. returning from email).
  const latestOtpRef = useRef(otp);
  useEffect(() => { latestOtpRef.current = otp; }, [otp]);

  const checkClipboardForAuthCode = async () => {
    if (!isMounted.current || isLoading) return;
    try {
      const text = await Clipboard.getStringAsync();
      // Extract the first 6 digits. This handles both "123456" and the full push 
      // notification text "[123456] is your NALISS HUB verification code"
      const digits = text?.replace(/\D/g, '').slice(0, OTP_LENGTH);
      
      if (digits?.length === OTP_LENGTH) {
        const current = latestOtpRef.current.join('');
        if (current === digits) return; // already filled
        
        const newOtp = digits.split('');
        setOtp(newOtp);
        // Clear clipboard so we don't re-trigger accidentally on the same code later
        await Clipboard.setStringAsync('');
      }
    } catch {
      // silent — clipboard access is best-effort
    }
  };

  useEffect(() => {
    // Check immediately on mount
    checkClipboardForAuthCode();

    // Check again whenever the app comes to the foreground
    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        checkClipboardForAuthCode();
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendFreshCode = useCallback(async (isAutoSend = false) => {
    if (!email) return;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email as string,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      if (isMounted.current) {
        setOtp(Array(OTP_LENGTH).fill(''));
        setCooldown(INITIAL_COOLDOWN);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
        if (!isAutoSend) {
          Alert.alert('New Code Sent', 'A fresh 6-digit code was sent to your email.');
        }
      }
    } catch {
      if (isMounted.current && !isAutoSend) {
        Alert.alert('Resend Failed', 'Could not resend the code. Please check your connection.');
      }
    }
  }, [email]);

  // Mount init — runs once only
  useEffect(() => {
    isMounted.current = true;

    // Guard: if no email param in URL, try the store. If both fail, go back to email screen
    const resolvedEmail = email || useSignupStore.getState().email;
    if (!resolvedEmail) {
      router.replace('/auth/register-email');
      return;
    }

    const init = async () => {
      if (initDone.current) return;
      initDone.current = true;

      const store = useSignupStore.getState();
      if (store.lastActivityTime && store.hasTimedOut()) {
        store.reset();
        await cleanupIncompleteSignup();
        if (isMounted.current) {
          Alert.alert('Session Expired', 'Your sign-up session timed out. Please start again.');
          router.replace('/auth/register-options');
        }
        return;
      }
      store.touchActivity();

      const { count, lockedUntil } = store.getOTPResendState(email as string);
      if (isMounted.current) {
        setResendCount(count);
        if (lockedUntil) setLockedUntilMs(lockedUntil);
      }

      const prevStep = store.currentStep;
      const alreadyVerified = prevStep !== undefined && prevStep >= 3;
      store.setCurrentStep(2);

      if (alreadyVerified) return;

      // Send a fresh code only on first arrival at this screen (prevStep < 2).
      // If prevStep === 2 the user is returning (e.g. from email app) — keep
      // the existing code alive, do NOT resend (would invalidate the old one).
      const isFirstArrival = !prevStep || prevStep < 2;
      if (isFirstArrival) {
        await sendFreshCode(true);
      }
    };

    init();

    // AppState: when user comes back from minimizing, keep screen alive
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && isMounted.current) {
        useSignupStore.getState().touchActivity();
        // Re-focus first empty box for convenience
        const firstEmpty = otp.findIndex(d => !d);
        if (firstEmpty >= 0) {
          setTimeout(() => inputRefs.current[firstEmpty]?.focus(), 300);
        }
      }
    });

    return () => {
      isMounted.current = false;
      appStateSub.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOtpChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '');
    if (digit.length > 1) {
      const digits = digit.split('').slice(0, OTP_LENGTH - index);
      const newOtp = [...otp];
      digits.forEach((d, i) => { if (index + i < OTP_LENGTH) newOtp[index + i] = d; });
      setOtp(newOtp);
      inputRefs.current[Math.min(index + digits.length, OTP_LENGTH - 1)]?.focus();
      return;
    }
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (digit && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newOtp = [...otp];
      newOtp[index - 1] = '';
      setOtp(newOtp);
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length !== OTP_LENGTH) {
      Alert.alert('Incomplete', 'Please enter all 6 digits of the verification code.');
      return;
    }
    setIsLoading(true);
    let succeeded = false;
    try {
      const store = useSignupStore.getState();
      store.setCredentials(email as string, undefined);
      store.setCurrentStep(3);

      // Block ProtectedRoute from intercepting the navigation that follows
      // verifyOtp(). Without this, onAuthStateChange fires a SIGNED_IN event
      // which causes ProtectedRoute to race with our router.push() below.
      store.setIsGoogleDelaying(true);

      const { error } = await supabase.auth.verifyOtp({
        email: email as string,
        token: code,
        type: 'email',
      });

      if (error) {
        // Revert on failure so user can retry
        store.setCurrentStep(2);
        store.setIsGoogleDelaying(false);
        throw error;
      }

      succeeded = true;
      store.clearOTPResendState(email as string);

      if (!isMounted.current) {
        store.setIsGoogleDelaying(false);
        return;
      }

      // Navigate immediately — no success state, no animation frame delay.
      // Release the block just before navigating so ProtectedRoute sees
      // currentStep=3 and stays on register-password if it fires after this.
      store.setIsGoogleDelaying(false);
      router.push({ pathname: '/auth/register-password', params: { email } });

    } catch (err: any) {
      captureUIError('RegisterOTP.handleVerify', err, { email });
      if (!isMounted.current) return;
      if (err.message?.includes('expired') || err.message?.includes('Token has expired')) {
        Alert.alert('Code Expired', 'Your verification code has expired. Please request a new one.');
      } else if (err.message?.includes('invalid') || err.message?.includes('Invalid')) {
        Alert.alert('Wrong Code', 'The code you entered is incorrect. Please check and try again.');
      } else {
        Alert.alert('Verification Failed', 'Could not verify the code. Please try again.');
      }
    } finally {
      // Always clear the delay flag — even if component unmounted
      useSignupStore.getState().setIsGoogleDelaying(false);
      if (isMounted.current && !succeeded) setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || lockedUntilMs || isResending) return;
    setIsResending(true);
    try {
      const { lockedUntil } = useSignupStore.getState().incrementOTPResendCount(email as string);
      if (isMounted.current) {
        setResendCount(c => c + 1);
        if (lockedUntil) {
          setLockedUntilMs(lockedUntil);
          Alert.alert('Limit Reached', `Too many code requests. Please wait ${RESEND_LOCK_MINUTES} minutes.`);
          return;
        }
      }
      await sendFreshCode(false);
    } finally {
      if (isMounted.current) setIsResending(false);
    }
  };

  const handleBack = () => {
    Alert.alert(
      'Go Back?',
      'Going back will invalidate your current code. A new code will be sent when you return.',
      [
        { text: 'Stay Here', style: 'cancel' },
        { text: 'Go Back', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  const handleSignInRedirect = async () => {
    await cleanupIncompleteSignup();
    router.replace('/auth/login');
  };

  const maskedEmail = (email as string)?.replace(/(.{3})(.*)(@.*)/, (_, a, b, c) => a + '*'.repeat(b.length) + c);
  const remainingResends = MAX_RESENDS - resendCount;

  // Locked screen
  if (lockedUntilMs && lockCountdown) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.nav}>
          <View style={styles.backBtn} />
          <TouchableOpacity style={styles.signInBtn} onPress={handleSignInRedirect}>
            <Ionicons name="log-in-outline" size={16} color="#fff" />
            <Text style={styles.signInBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.lockContainer}>
          <View style={styles.lockIconWrap}>
            <Ionicons name="time-outline" size={48} color="#f59e0b" />
          </View>
          <Text style={styles.lockTitle}>Too Many Requests</Text>
          <Text style={styles.lockSubtitle}>
            You've reached the maximum of {MAX_RESENDS} code requests.{'\n'}
            Please wait before requesting a new code.
          </Text>
          <View style={styles.lockCountdownBox}>
            <Text style={styles.lockCountdownLabel}>TRY AGAIN IN</Text>
            <Text style={styles.lockCountdownValue}>{lockCountdown}</Text>
          </View>
          <Text style={styles.lockHint}>
            If you already have a valid code in your email, you can still enter it below.
          </Text>
          <View style={styles.otpRow}>
            {Array(OTP_LENGTH).fill(0).map((_, i) => (
              <TextInput
                key={i}
                ref={r => { inputRefs.current[i] = r; }}
                style={[styles.otpBox, otp[i] ? styles.otpFilled : null]}
                value={otp[i]}
                onChangeText={t => handleOtpChange(t, i)}
                onKeyPress={e => handleKeyPress(e, i)}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={i === 0 ? OTP_LENGTH : 1}
                selectTextOnFocus
              />
            ))}
          </View>
          <TouchableOpacity
            style={[styles.btn, isLoading && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <View style={styles.btnInner}><ActivityIndicator color="#fff" size="small" /><Text style={styles.btnText}>Verifying…</Text></View>
            ) : (
              <View style={styles.btnInner}><Text style={styles.btnText}>Verify Code</Text><Ionicons name="shield-checkmark" size={18} color="#fff" /></View>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.nav}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.signInBtn} onPress={handleSignInRedirect}>
          <Ionicons name="log-in-outline" size={16} color="#fff" />
          <Text style={styles.signInBtnText}>Sign In</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} bounces={false} keyboardShouldPersistTaps="handled">
        <StepBar current={2} total={5} />

        <View style={styles.logoWrap}>
          <NalissLogo size={72} rounded />
        </View>

        <Text style={styles.stepLabel}>Step 2 of 5</Text>
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{'\n'}
          <Text style={styles.emailHighlight}>{maskedEmail}</Text>
        </Text>
        <Text style={styles.expiry}>
          {Platform.OS === 'ios'
            ? 'Code valid for 1 hour · Tap the suggestion above your keyboard to auto-fill'
            : 'Code valid for 1 hour · Code will auto-fill from clipboard when copied'}
        </Text>
        <View style={styles.otpRow}>
          {Array(OTP_LENGTH).fill(0).map((_, i) => (
            <TextInput
              key={i}
              ref={r => { inputRefs.current[i] = r; }}
              style={[
                styles.otpBox,
                otp[i] ? styles.otpFilled : null,
              ]}
              value={otp[i]}
              onChangeText={t => handleOtpChange(t, i)}
              onKeyPress={e => handleKeyPress(e, i)}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={i === 0 ? OTP_LENGTH : 1}
              selectTextOnFocus
              autoFocus={i === 0}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.btn, isLoading && styles.btnDisabled]}
          onPress={handleVerify}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <View style={styles.btnInner}><ActivityIndicator color="#fff" size="small" /><Text style={styles.btnText}>Verifying…</Text></View>
          ) : (
            <View style={styles.btnInner}><Text style={styles.btnText}>Verify Code</Text><Ionicons name="shield-checkmark" size={18} color="#fff" /></View>
          )}
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't receive the code? </Text>
          <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || isResending || !!lockedUntilMs}>
            {isResending ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Text style={[styles.resendLink, (cooldown > 0 || !!lockedUntilMs) && styles.resendDisabled]}>
                {cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend Code'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {remainingResends > 0 && remainingResends < MAX_RESENDS && resendCount > 0 && (
          <Text style={styles.resendAttemptsHint}>
            {remainingResends} resend {remainingResends === 1 ? 'attempt' : 'attempts'} remaining
          </Text>
        )}

        <Text style={styles.footer}>Need help? Contact nalissumyuk@gmail.com</Text>
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
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40, alignItems: 'center' },
  logoWrap: { marginBottom: 20 },
  stepLabel: { fontSize: 11, fontFamily: 'Inter-Bold', color: COLORS.primary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  title: { fontSize: 26, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 4 },
  emailHighlight: { fontFamily: 'Inter-SemiBold', color: COLORS.primary },
  expiry: { fontSize: 11, fontFamily: 'Inter-Medium', color: '#94a3b8', marginBottom: 28, textAlign: 'center' },
  otpRow: { flexDirection: 'row', gap: 8, marginBottom: 32 },
  otpBox: {
    width: 44, height: 54, borderRadius: 12,
    borderWidth: 2, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    textAlign: 'center', fontSize: 20, fontFamily: 'Inter-Bold', color: '#0f172a',
  },
  otpFilled: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  btn: {
    backgroundColor: COLORS.primary, width: '100%', height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  btnDisabled: { opacity: 0.85 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold' },
  resendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  resendLabel: { fontSize: 13, fontFamily: 'Inter-Regular', color: '#94a3b8' },
  resendLink: { fontSize: 13, fontFamily: 'Inter-Bold', color: COLORS.primary },
  resendDisabled: { color: '#94a3b8', fontFamily: 'Inter-Regular' },
  resendAttemptsHint: { fontSize: 11, fontFamily: 'Inter-Regular', color: '#f59e0b', marginBottom: 24, textAlign: 'center' },
  footer: { fontSize: 11, fontFamily: 'Inter-Regular', color: '#cbd5e1', textAlign: 'center', marginTop: 8 },
  lockContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 40 },
  lockIconWrap: {
    width: 88, height: 88, borderRadius: 26,
    backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#fde68a',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  lockTitle: { fontSize: 22, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 10, textAlign: 'center' },
  lockSubtitle: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  lockCountdownBox: {
    backgroundColor: '#fffbeb', borderRadius: 16, borderWidth: 1.5, borderColor: '#fde68a',
    paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', marginBottom: 20, width: '100%',
  },
  lockCountdownLabel: { fontSize: 10, fontFamily: 'Inter-Bold', color: '#92400e', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  lockCountdownValue: { fontSize: 32, fontFamily: 'Inter-Bold', color: '#d97706' },
  lockHint: { fontSize: 12, fontFamily: 'Inter-Regular', color: '#94a3b8', textAlign: 'center', marginBottom: 24, lineHeight: 18 },
});
