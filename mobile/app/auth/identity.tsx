import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { useSignupStore } from '../../src/stores/signup.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { validateRegistrationNumberMatch } from '../../src/utils/validation';
import { cleanupIncompleteSignup } from '../../src/utils/signup-cleanup';
import { supabase } from '../../src/api/supabase/client';
import { useNetworkStore } from '../../src/stores/network.store';
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

export default function RegisterIdentity() {
  useSentryScreen('RegisterIdentity');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [matricNo, setMatricNo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [focused, setFocused] = useState<string | null>(null);
  const isMounted = useRef(true);

  const router = useRouter();
  const signupStore = useSignupStore();
  const { session } = useAuthStore();

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      const signupState = useSignupStore.getState();
      if (signupState.lastActivityTime && signupState.hasTimedOut()) {
        signupState.reset();
        if (isMounted.current) {
          Alert.alert('Session Expired', 'Your sign-up session timed out. Please start again.');
          router.replace('/auth/register-options');
        }
        return;
      }
      signupState.touchActivity();

      // Determine provider from store (not from the outer-scope `isGoogle` which
      // is computed after this effect runs — reading directly from store is safe here)
      const isGoogleProvider = signupState.provider === 'google';
      signupState.setCurrentStep(isGoogleProvider ? 2 : 4);

      const currentEmail = signupState.email || session?.user?.email;
      if (!currentEmail && !session) {
        if (isMounted.current) {
          Alert.alert('Session Expired', 'Please restart the registration process.');
          router.replace('/auth/register-options');
        }
        return;
      }

      // Auto-populate full name from Google metadata only if field is still empty
      if (isMounted.current && session?.user?.user_metadata?.full_name) {
        setFullName(prev => prev || session.user!.user_metadata.full_name);
      }
      if (isMounted.current) setIsHydrating(false);
    };
    hydrate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContinue = async () => {
    const activeEmail = signupStore.email || session?.user?.email;

    // ── 1. Local field checks (no network needed) ─────────────────────────
    if (!fullName.trim() || !username.trim() || !matricNo.trim()) {
      Alert.alert('Required Fields', 'Please fill in all fields — Name, Username, and Registration Number.');
      return;
    }
    if (username.trim().length < 3) {
      Alert.alert('Username Too Short', 'Username must be at least 3 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      Alert.alert('Invalid Username', 'Username can only contain letters, numbers, and underscores.');
      return;
    }
    if (!activeEmail) {
      Alert.alert('Session Expired', 'Please restart the registration process.');
      router.replace('/auth/register-options');
      return;
    }

    // ── 2. Registration number format + email ID match (local, no network) ─
    const isValidMatch = validateRegistrationNumberMatch(activeEmail, matricNo.trim());
    if (!isValidMatch) {
      Alert.alert(
        'Invalid Registration Number',
        'The registration number format is wrong or the last 4 digits do not match your email student ID.\n\nExpected format: U1/22/BLIS/1234'
      );
      return;
    }

    // ── 3. Network + Supabase checks ──────────────────────────────────────
    setIsLoading(true);
    try {
      const { checkNetworkStatus } = useNetworkStore.getState();
      const isOnline = await checkNetworkStatus();
      if (!isOnline) {
        Alert.alert('No Connection', 'Please check your internet connection and try again.');
        return;
      }

      // 3a. Check registration number is not already taken
      // If RPC fails for any reason, allow through — DB constraint at profile creation
      // is the real guard. This check is a convenience to give early feedback only.
      try {
        const { data: matricAvailable, error: matricError } = await ((supabase as any).rpc as any)(
          'check_matric_availability',
          { p_matric_no: matricNo.trim(), p_email: activeEmail }
        );
        if (!matricError && matricAvailable === false) {
          Alert.alert(
            'Registration Number Taken',
            'This registration number is already linked to another account. If you believe this is an error, please contact support.'
          );
          return;
        }
      } catch {
        // RPC failed — allow through, DB enforces uniqueness at profile creation
      }

      // 3b. Check username is not already taken
      // Same pattern — non-blocking on failure
      try {
        const { data: usernameAvailable, error: usernameError } = await ((supabase as any).rpc as any)(
          'check_username_availability',
          { p_username: username.trim(), p_email: activeEmail }
        );
        if (!usernameError && usernameAvailable === false) {
          Alert.alert('Username Taken', 'This username is already in use. Please choose a different username.');
          return;
        }
      } catch {
        // RPC failed — allow through, DB enforces uniqueness at profile creation
      }

      // ── 4. All checks passed — save to store and navigate ─────────────
      if (!isMounted.current) return;
      signupStore.setIdentity(fullName.trim(), username.trim(), matricNo.trim());
      const isGoogleFlow = useSignupStore.getState().provider === 'google';
      signupStore.setCurrentStep(isGoogleFlow ? 3 : 5);
      router.push('/auth/level' as any);

    } catch (err) {
      captureUIError('RegisterIdentity.handleContinue', err);
      if (!isMounted.current) return;
      Alert.alert('Validation Error', 'Something went wrong. Please check your connection and try again.');
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  };

  const isGoogle = signupStore.provider === 'google';
  const stepCurrent = isGoogle ? 2 : 4;
  const stepTotal = isGoogle ? 3 : 5;

  if (isHydrating) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.signInBtn} onPress={async () => { await cleanupIncompleteSignup(); router.replace('/auth/login'); }}>
            <Ionicons name="log-in-outline" size={16} color="#fff" />
            <Text style={styles.signInBtnText}>Sign In</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <StepBar current={stepCurrent} total={stepTotal} />

          <Text style={styles.stepLabel}>Step {stepCurrent} of {stepTotal}</Text>
          <Text style={styles.title}>Identity Validation</Text>
          <Text style={styles.subtitle}>Help us verify your student status at UMYU Katsina</Text>

          {/* Full Name */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Full Name</Text>
            <View style={[styles.inputRow, focused === 'name' && styles.inputFocused]}>
              <Ionicons name="person-outline" size={18} color={focused === 'name' ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor="#cbd5e1"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                onFocus={() => setFocused('name')}
                onBlur={() => setFocused(null)}
              />
            </View>
          </View>

          {/* Username */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Username</Text>
            <View style={[styles.inputRow, focused === 'user' && styles.inputFocused]}>
              <Ionicons name="at-outline" size={18} color={focused === 'user' ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Choose a unique username"
                placeholderTextColor="#cbd5e1"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                onFocus={() => setFocused('user')}
                onBlur={() => setFocused(null)}
              />
            </View>
          </View>

          {/* Reg Number */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Registration Number</Text>
            <View style={[styles.inputRow, focused === 'reg' && styles.inputFocused]}>
              <Ionicons name="card-outline" size={18} color={focused === 'reg' ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="e.g. U1/22/BLIS/1234"
                placeholderTextColor="#cbd5e1"
                value={matricNo}
                onChangeText={setMatricNo}
                autoCapitalize="characters"
                onFocus={() => setFocused('reg')}
                onBlur={() => setFocused(null)}
              />
            </View>

          </View>

          {/* Security note */}
          <View style={styles.secureNote}>
            <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
            <Text style={styles.secureNoteText}>
              Used only for institutional verification and portal security. Never shared externally.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, isLoading && styles.btnDisabled]}
            onPress={handleContinue}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <View style={styles.btnInner}><ActivityIndicator color="#fff" size="small" /><Text style={styles.btnText}>Validating…</Text></View>
            ) : (
              <View style={styles.btnInner}><Text style={styles.btnText}>Validate</Text><Ionicons name="checkmark-done" size={18} color="#fff" /></View>
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
  field: { marginBottom: 18 },
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
  hint: { fontSize: 11, fontFamily: 'Inter-Regular', color: '#94a3b8', marginTop: 5, marginLeft: 4 },
  secureNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#f0fdf4', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#bbf7d0', marginBottom: 28,
  },
  secureNoteText: { flex: 1, fontSize: 13, fontFamily: 'Inter-Regular', color: '#166534', lineHeight: 18 },
  btn: {
    backgroundColor: COLORS.primary, height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold' },
});
