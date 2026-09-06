import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError } from '../../src/utils/sentry';

export default function UpdatePassword() {
  useSentryScreen('UpdatePassword');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const router = useRouter();

  // Verify there is a valid recovery session before allowing password update.
  // The reset link from email sets a session automatically via deep link handler.
  useEffect(() => {
    // Check immediately in case session is already set
    supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
            setSessionReady(true);
            return;
        }
    });

    // Listen for the recovery event — fires when setSession() completes in _layout.tsx
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
            setSessionReady(true);
        } else if (event === 'SIGNED_OUT') {
            setSessionError(true);
        }
    });

    // Safety timeout — only as last resort (5s, not 800ms)
    const fallback = setTimeout(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!session) setSessionError(true);
        });
    }, 5000);

    return () => {
        subscription.unsubscribe();
        clearTimeout(fallback);
    };
  }, []);

  const handleUpdate = async () => {
    if (password.length < 6) {
      Alert.alert('Too Short', 'Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match. Please check and try again.');
      return;
    }

    setIsLoading(true);
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000);
      });
      const updatePromise = supabase.auth.updateUser({ password });
      const { error } = await Promise.race([updatePromise, timeoutPromise]) as any;
      if (error) throw error;

      await supabase.auth.signOut();
      const { useSignupStore } = require('../../src/stores/signup.store');
      useSignupStore.getState().setIsRecoveryFlow(false);

      setIsSuccess(true);
    } catch (err: any) {
      captureUIError('UpdatePassword.handleUpdate', err);
      // Detect expired recovery link
      if (err.message?.includes('expired') || err.message?.includes('invalid')) {
        Alert.alert(
          'Link Expired',
          'Your password reset link has expired (valid for 1 hour). Please request a new one.',
          [{ text: 'Request New Link', onPress: () => router.replace('/auth/reset-password') }]
        );
      } else {
        Alert.alert('Update Failed', 'Could not update your password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Session error — link expired or invalid ──────────────────────────────────
  if (sessionError) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.centeredState}>
          <View style={[styles.iconWrap, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
            <Ionicons name="alert-circle-outline" size={44} color="#ef4444" />
          </View>
          <Text style={styles.stateTitle}>Link Expired</Text>
          <Text style={styles.stateSub}>
            This password reset link is invalid or has expired.{'\n'}Reset links are valid for 1 hour.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.replace('/auth/reset-password')} activeOpacity={0.85}>
            <View style={styles.btnInner}>
              <Text style={styles.btnText}>Request New Link</Text>
              <Ionicons name="send-outline" size={16} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Success state ─────────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.centeredState}>
          <View style={[styles.iconWrap, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
            <Ionicons name="checkmark-circle-outline" size={44} color={COLORS.primary} />
          </View>
          <Text style={styles.stateTitle}>Password Updated</Text>
          <Text style={styles.stateSub}>
            Your password has been changed successfully.{'\n'}You can now access your dashboard.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.replace('/auth/login')} activeOpacity={0.85}>
            <View style={styles.btnInner}>
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={styles.btnText}>Sign In</Text>
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading session check ─────────────────────────────────────────────────────
  if (!sessionReady) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={[styles.stateSub, { marginTop: 16 }]}>Verifying reset link…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Password strength (8+ = fair, 12+ = strong)
  const strength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3;
  const strengthColors = ['#e2e8f0', '#ef4444', '#f59e0b', '#16a34a'];
  const strengthLabels = ['', 'Weak', 'Fair', 'Strong'];

  // ── Form ──────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

        <View style={styles.nav}>
          <View style={styles.navSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.iconWrap}>
            <Ionicons name="lock-open-outline" size={44} color={COLORS.primary} />
          </View>

          <Text style={styles.title}>Create New Password</Text>
          <Text style={styles.subtitle}>
            Your identity has been verified. Enter a new secure password for your account.
          </Text>

          {/* New password */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>New Password</Text>
            <View style={[styles.inputRow, passFocused && styles.inputFocused]}>
              <Ionicons name="lock-closed-outline" size={18} color={passFocused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="At least 8 characters"
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

          {/* Confirm password */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Confirm New Password</Text>
            <View style={[
              styles.inputRow,
              confirmFocused && styles.inputFocused,
              confirmPassword.length > 0 && confirmPassword !== password && styles.inputError,
            ]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={confirmFocused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
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
            onPress={handleUpdate}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.btnInner}>
                <Text style={styles.btnText}>Update Password</Text>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.expiryNote}>
            ⏱ Reset links expire after 1 hour
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  nav: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  navSpacer: { height: 10 },
  body: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  centeredState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center',
    marginBottom: 24, borderWidth: 1, borderColor: '#bbf7d0',
  },
  stateTitle: { fontSize: 24, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 12, textAlign: 'center' },
  stateSub: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', textAlign: 'center', lineHeight: 21, marginBottom: 32 },
  title: { fontSize: 26, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 10 },
  subtitle: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#64748b', lineHeight: 21, marginBottom: 32 },
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
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
    marginBottom: 16,
  },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold' },
  expiryNote: { fontSize: 12, fontFamily: 'Inter-Regular', color: '#94a3b8', textAlign: 'center' },
});
