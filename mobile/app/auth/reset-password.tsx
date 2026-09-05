import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { INSTITUTIONAL_EMAIL_REGEX } from '../../src/utils/validation';
import { AuthGuardian } from '../../src/utils/auth-guardian';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError } from '../../src/utils/sentry';

export default function ResetPassword() {
  useSentryScreen('ResetPassword');
  const [email, setEmail] = useState('');
  const [focused, setFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [errorTip, setErrorTip] = useState<string | null>(null);
  const router = useRouter();

  const handleReset = async () => {
    if (!email) { Alert.alert('Error', 'Please enter your institutional email'); return; }

    const banHours = await AuthGuardian.checkBanStatus(email);
    if (banHours) { Alert.alert('Restricted', `Too many invalid attempts. Try again in ${banHours} hours.`); return; }

    const resetHours = await AuthGuardian.checkResetLimit(email);
    if (resetHours) { Alert.alert('Limit Reached', `Too many resets in 24 hours. Wait ${resetHours} hours.`); return; }

    if (!INSTITUTIONAL_EMAIL_REGEX.test(email)) {
      const attempts = await AuthGuardian.recordFailure(email);
      const remaining = 10 - attempts;
      if (remaining <= 0) {
        Alert.alert('Device Locked', 'Locked out for 24 hours due to multiple invalid format attempts.');
      } else {
        Alert.alert('Invalid Email', `Please use your institutional email.\nAttempts remaining: ${remaining}`);
      }
      return;
    }

    await AuthGuardian.clearFailures(email);
    setIsLoading(true);
    setErrorTip(null);

    try {
      // Use explicit deep link URL — naliss://auth/update-password
      // This must be whitelisted in Supabase Dashboard → Auth → URL Configuration → Redirect URLs
      const redirectUrl = Linking.createURL('auth/update-password');
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000);
      });
      const resetPromise = supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: redirectUrl,
      });
      const { error } = await Promise.race([resetPromise, timeoutPromise]) as any;
      if (error) throw error;
      await AuthGuardian.recordResetAttempt(email.trim().toLowerCase());
      setIsSent(true);
    } catch (err: any) {
      captureUIError('ResetPassword.handleReset', err, { email: email.trim().toLowerCase() });
      if (err.message?.includes('Error sending recovery email') || err.message?.includes('rate limit')) {
        setErrorTip('You may have reached the email limit (3/hour). Please wait 1 hour and try again.');
        Alert.alert('Limit Reached', 'Too many reset requests. Please wait 1 hour and try again.');
      } else if (err.message?.includes('fetch') || err.message?.includes('network')) {
        Alert.alert('No Connection', 'Could not reach the server. Please check your internet connection.');
      } else {
        Alert.alert('Reset Failed', 'Could not send reset email. Please try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Success state ────────────────────────────────────────────────────────────
  if (isSent) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.successRoot}>
          <View style={styles.successIconWrap}>
            <Ionicons name="mail-unread-outline" size={52} color={COLORS.primary} />
          </View>
          <Text style={styles.successTitle}>Check Your Email</Text>
          <Text style={styles.successSub}>
            A reset link was sent to{'\n'}
            <Text style={styles.successEmail}>{email}</Text>
            {'\n\n'}The link is valid for 1 hour.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.replace('/auth/login')} activeOpacity={0.85}>
            <View style={styles.btnInner}>
              <Ionicons name="arrow-back" size={18} color="#fff" />
              <Text style={styles.btnText}>Back to Sign In</Text>
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.nav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Icon */}
        <View style={styles.iconWrap}>
          <Ionicons name="lock-open-outline" size={44} color={COLORS.primary} />
        </View>

        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          Enter your registered student email and we'll send you a secure reset link.
        </Text>

        {/* Email input */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Institutional Email</Text>
          <View style={[styles.inputRow, focused && styles.inputFocused]}>
            <Ionicons name="mail-outline" size={18} color={focused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="yourname@students.umyu.edu.ng"
              placeholderTextColor="#cbd5e1"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </View>
          {errorTip && (
            <View style={styles.errorTip}>
              <Ionicons name="information-circle-outline" size={15} color="#b91c1c" />
              <Text style={styles.errorTipText}>{errorTip}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.btn, isLoading && styles.btnDisabled]}
          onPress={handleReset}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.btnInner}>
              <Text style={styles.btnText}>Send Reset Link</Text>
              <Ionicons name="send-outline" size={16} color="#fff" />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backToLogin} onPress={() => router.back()}>
          <Text style={styles.backToLoginText}>← Back to Sign In</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  nav: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  backBtn: { padding: 10, borderRadius: 12, backgroundColor: '#f1f5f9', alignSelf: 'flex-start' },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40 },
  iconWrap: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center',
    marginBottom: 24, borderWidth: 1, borderColor: '#bbf7d0',
  },
  title: { fontSize: 26, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 10 },
  subtitle: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', lineHeight: 21, marginBottom: 32 },
  field: { marginBottom: 24 },
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
  errorTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#fef2f2', borderRadius: 10, padding: 10, marginTop: 10,
  },
  errorTipText: { flex: 1, fontSize: 12, fontFamily: 'Inter-Regular', color: '#b91c1c', lineHeight: 17 },
  btn: {
    backgroundColor: COLORS.primary, height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
    marginBottom: 16,
  },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold' },
  backToLogin: { alignItems: 'center', paddingVertical: 8 },
  backToLoginText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: COLORS.primary },
  // Success
  successRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  successIconWrap: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center',
    marginBottom: 28, borderWidth: 1, borderColor: '#bbf7d0',
  },
  successTitle: { fontSize: 26, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 14, textAlign: 'center' },
  successSub: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  successEmail: { fontFamily: 'Inter-SemiBold', color: COLORS.primary },
});
