import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError } from '../../src/utils/sentry';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, StatusBar, AppState, AppStateStatus,
  Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { useSignupStore } from '../../src/stores/signup.store';
import { NalissLogo } from '../../src/components/NalissLogo';
import { cleanupIncompleteSignup } from '../../src/utils/signup-cleanup';
import { normalizeError } from '../../src/utils/sentry';

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

/**
 * Safely extracts a 6-digit OTP from text copied to the clipboard.
 * Returns null if the text is an email address, URL, matriculation number, phone number,
 * or contains non-OTP context.
 */
function extractOtpFromText(rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  const text = rawText.trim();
  if (!text) return null;

  // Never match if text contains email address, URLs, or path separators
  if (text.includes('@') || text.includes('http://') || text.includes('https://') || text.includes('/')) {
    return null;
  }

  // Exact 6-digit standalone code
  if (/^\d{6}$/.test(text)) {
    return text;
  }

  // Bracketed code: e.g. "[123456]"
  const bracketMatch = text.match(/\[(\d{6})\]/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1];
  }

  // Explicit OTP keyword context: e.g. "code: 123456", "verification code is 123456", "OTP: 123456"
  const otpKeywordMatch = text.match(/(?:code|otp|verification|token)\D{0,15}(\b\d{6}\b)/i);
  if (otpKeywordMatch && otpKeywordMatch[1]) {
    return otpKeywordMatch[1];
  }

  // If text is short (< 80 chars) and contains ONLY a single 6-digit number and NO other numbers
  const allNumbers = text.match(/\d+/g);
  if (allNumbers && allNumbers.length === 1 && allNumbers[0].length === OTP_LENGTH && text.length < 80) {
    const wordBoundMatch = text.match(/\b(\d{6})\b/);
    if (wordBoundMatch && wordBoundMatch[1]) {
      return wordBoundMatch[1];
    }
  }

  return null;
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
  const isVerifyingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedClipboardRef = useRef<string>('');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
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
  useEffect(() => {
    const code = otp.join('');
    if (code.length !== OTP_LENGTH) {
      autoVerifyAttempted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (autoVerifyAttempted.current || isVerifyingRef.current) return;
    autoVerifyAttempted.current = true;

    timerRef.current = setTimeout(() => {
      handleVerify();
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [otp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unified Clipboard Parsing ─────────────────────────────────────────────
  // Only checks clipboard when user returns to the app from background (e.g. copying OTP from email).
  // Never runs on mount to prevent picking up stale data (e.g. student email with matric digits).
  const latestOtpRef = useRef(otp);
  useEffect(() => { latestOtpRef.current = otp; }, [otp]);

  const checkClipboardForAuthCode = async () => {
    if (!isMounted.current || isLoading || isVerifyingRef.current) return;
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || text === lastProcessedClipboardRef.current) return;

      const code = extractOtpFromText(text);
      if (code && code.length === OTP_LENGTH) {
        lastProcessedClipboardRef.current = text;
        const current = latestOtpRef.current.join('');
        if (current === code) return; // already filled

        const newOtp = code.split('');
        setOtp(newOtp);
      }
    } catch {
      // silent — clipboard access is best-effort
    }
  };

  const sendFreshCode = useCallback(async (isAutoSend = false) => {
    if (!email) return;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email as string,
        options: { shouldCreateUser: true },
      });
      if (error) throw normalizeError(error);
      if (isMounted.current) {
        setOtp(Array(OTP_LENGTH).fill(''));
        setCooldown(INITIAL_COOLDOWN);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
        if (!isAutoSend) {
          Alert.alert('New Code Sent', 'A fresh 6-digit code was sent to your email.');
        }
      }
    } catch (err: any) {
      if (isMounted.current && !isAutoSend) {
        if (err?.status === 429 || err?.message?.includes('429') || err?.message?.toLowerCase().includes('rate limit')) {
          Alert.alert('Too Many Requests', 'You are requesting codes too quickly. Please wait a moment and try again.');
        } else {
          Alert.alert('Resend Failed', 'Could not resend the code. Please check your connection.');
        }
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

      store.setCurrentStep(2);

      // NOTE: RegisterEmail already dispatched the verification OTP immediately
      // before routing to this screen. We do NOT call sendFreshCode() on mount.
      // Auto-sending on mount causes Supabase to generate a 2nd OTP, invalidating
      // the 1st OTP that the user is about to open in their inbox.
    };

    init();

    // AppState: when user returns from background (e.g. email client), keep session alive
    // and check clipboard safely for the copied OTP code.
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;

      if (wasBackground && nextState === 'active' && isMounted.current) {
        useSignupStore.getState().touchActivity();
        checkClipboardForAuthCode();

        // Re-focus first empty box for convenience if incomplete
        const firstEmpty = latestOtpRef.current.findIndex(d => !d);
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

    // Strict concurrency lock: abort if already running
    if (isVerifyingRef.current) return;
    isVerifyingRef.current = true;
    setIsLoading(true);

    let succeeded = false;
    try {
      const store = useSignupStore.getState();
      store.setCredentials(email as string, undefined);
      store.setCurrentStep(3);
      store.setIsGoogleDelaying(true);

      const { error } = await supabase.auth.verifyOtp({
        email: (email as string).trim().toLowerCase(),
        token: code.trim(),
        type: 'email',
      });

      if (error) {
        store.setCurrentStep(2);
        store.setIsGoogleDelaying(false);
        throw normalizeError(error);
      }

      succeeded = true;
      store.clearOTPResendState(email as string);

      if (!isMounted.current) {
        store.setIsGoogleDelaying(false);
        return;
      }

      store.setIsGoogleDelaying(false);
      router.push({ pathname: '/auth/register-password', params: { email } });
    } catch (err: any) {
      isVerifyingRef.current = false; // Release lock on error to allow retry
      autoVerifyAttempted.current = false;
      captureUIError('RegisterOTP.handleVerify', err, { email });
      if (!isMounted.current) return;

      // Clear the invalid digits and refocus first box so user can retry cleanly
      setOtp(Array(OTP_LENGTH).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 150);

      const errMsg = (err?.message || '').toLowerCase();
      const isExpiredOrInvalid = 
        errMsg.includes('token has expired or is invalid') ||
        (errMsg.includes('expired') && errMsg.includes('invalid'));

      if (isExpiredOrInvalid) {
        Alert.alert(
          'Invalid Code',
          'The verification code is incorrect or has expired. Please check your email or tap "Resend Code" for a new one.'
        );
      } else if (errMsg.includes('expired')) {
        Alert.alert('Code Expired', 'Your verification code has expired. Please tap "Resend Code" to request a new one.');
      } else if (errMsg.includes('invalid')) {
        Alert.alert('Wrong Code', 'The code you entered is incorrect. Please check and try again.');
      } else {
        Alert.alert('Verification Failed', err?.message || 'Could not verify the code. Please try again.');
      }
    } finally {
      useSignupStore.getState().setIsGoogleDelaying(false);
      if (isMounted.current && !succeeded) {
        setIsLoading(false);
        isVerifyingRef.current = false;
      }
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
