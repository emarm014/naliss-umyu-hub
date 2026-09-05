import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { useSignupStore } from '../../src/stores/signup.store';
import { cleanupIncompleteSignup } from '../../src/utils/signup-cleanup';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError } from '../../src/utils/sentry';

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

export default function RegisterPassword() {
  useSentryScreen('RegisterPassword');
  const { email: emailParam } = useLocalSearchParams<{ email: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const isMounted = useRef(true);
  const router = useRouter();
  const setCredentials = useSignupStore(state => state.setCredentials);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const store = useSignupStore.getState();
    if (store.lastActivityTime && store.hasTimedOut()) {
      store.reset();
      if (isMounted.current) {
        Alert.alert('Session Expired', 'Your sign-up session timed out. Please start again.');
        router.replace('/auth/register-options');
      }
      return;
    }
    store.touchActivity();
    store.setCurrentStep(3);
  }, []);

  const handleSignUp = async () => {
    if (!password || !confirmPassword) { Alert.alert('Required', 'Please fill in both password fields.'); return; }
    if (password.length < 6) { Alert.alert('Password Too Short', 'Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { Alert.alert('Passwords Do Not Match', 'Both password fields must be identical.'); return; }

    // Resolve email: prefer store value (persisted), fall back to route param
    const resolvedEmail = useSignupStore.getState().email || (emailParam as string);
    if (!resolvedEmail) {
      Alert.alert('Session Error', 'Could not resolve your email. Please restart registration.');
      router.replace('/auth/register-email');
      return;
    }

    setIsLoading(true);
    try {
      // Verify the Supabase session is still active before proceeding.
      // The OTP session from step 2 could have expired if the user took too long.
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000);
      });
      const getUserPromise = supabase.auth.getUser();
      const { data: { user }, error: sessionError } = await Promise.race([getUserPromise, timeoutPromise]) as any;
      if (sessionError || !user) {
        Alert.alert(
          'Session Expired',
          'Your verification session has expired. Please go back and verify your email again.',
          [{ text: 'Go Back', onPress: () => router.replace('/auth/register-email') }]
        );
        return;
      }

      // Save password to store — it will be applied to the account at the final step
      setCredentials(resolvedEmail, password);
      if (!isMounted.current) return;

      // Update step BEFORE navigating to prevent ProtectedRoute interference
      useSignupStore.getState().setCurrentStep(4);
      router.push('/auth/identity' as any);
    } catch (err) {
      captureUIError('RegisterPassword.handleSetPassword', err);
      if (isMounted.current) Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  };

  // Password strength
  const strength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3;
  const strengthColors = ['#e2e8f0', '#ef4444', '#f59e0b', '#16a34a'];
  const strengthLabels = ['', 'Weak', 'Fair', 'Strong'];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.signInBtn} onPress={async () => { await cleanupIncompleteSignup(); router.replace('/auth/login'); }}>
            <Ionicons name="log-in-outline" size={16} color="#fff" />
            <Text style={styles.signInBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <StepBar current={3} total={5} />

          <Text style={styles.stepLabel}>Step 3 of 5</Text>
          <Text style={styles.title}>Secure Your Account</Text>
          <Text style={styles.subtitle}>Create a strong password for your NALISS Hub profile</Text>

          {/* Password */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Create Password</Text>
            <View style={[styles.inputRow, passFocused && styles.inputFocused]}>
              <Ionicons name="lock-closed-outline" size={18} color={passFocused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="At least 6 characters"
                placeholderTextColor="#cbd5e1"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            {/* Strength bar */}
            {password.length > 0 && (
              <View style={styles.strengthWrap}>
                <View style={styles.strengthBar}>
                  {[1, 2, 3].map(s => (
                    <View key={s} style={[styles.strengthSeg, { backgroundColor: strength >= s ? strengthColors[strength] : '#e2e8f0' }]} />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: strengthColors[strength] }]}>{strengthLabels[strength]}</Text>
              </View>
            )}
          </View>

          {/* Confirm */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Confirm Password</Text>
            <View style={[styles.inputRow, confirmFocused && styles.inputFocused,
              confirmPassword.length > 0 && confirmPassword !== password && styles.inputError]}>
              <Ionicons name="shield-checkmark-outline" size={18}
                color={confirmFocused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Repeat your password"
                placeholderTextColor="#cbd5e1"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                onFocus={() => setConfirmFocused(true)}
                onBlur={() => setConfirmFocused(false)}
              />
              {confirmPassword.length > 0 && (
                <Ionicons
                  name={confirmPassword === password ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={confirmPassword === password ? '#16a34a' : '#ef4444'}
                />
              )}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.btn, isLoading && styles.btnDisabled]}
            onPress={handleSignUp}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.btnInner}>
                <Text style={styles.btnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
  field: { marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8fafc', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e2e8f0',
    paddingHorizontal: 14, height: 54,
  },
  inputFocused: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  inputError: { borderColor: '#ef4444', backgroundColor: '#fff5f5' },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter-Regular', color: '#0f172a' },
  eyeBtn: { padding: 4 },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  strengthBar: { flex: 1, flexDirection: 'row', gap: 4 },
  strengthSeg: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontFamily: 'Inter-SemiBold', width: 40, textAlign: 'right' },
  btn: {
    backgroundColor: COLORS.primary, height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: 12,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold' },
});
