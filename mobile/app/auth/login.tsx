import React, { useState } from 'react';
import * as Sentry from '@sentry/react-native';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, StatusBar, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { NalissLogo } from '../../src/components/NalissLogo';
import { useAuthStore } from '../../src/stores/auth.store';
import { useSignupStore } from '../../src/stores/signup.store';
import { INSTITUTIONAL_EMAIL_REGEX } from '../../src/utils/validation';
import { AuthGuardian } from '../../src/utils/auth-guardian';
import { useNetworkStore } from '../../src/stores/network.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { startTransaction, trackUserAction } from '../../src/utils/sentry';

const { height } = Dimensions.get('window');

export default function LoginScreen() {
  useSentryScreen('LoginScreen');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const router = useRouter();
  const isOnline = useNetworkStore(s => s.isOnline);
  const checkNetworkStatus = useNetworkStore(s => s.checkNetworkStatus);
  const setError = useAuthStore(s => s.setError);

  const handleLogin = async () => {
    trackUserAction('login.submit', { email: email.trim().toLowerCase() });
    if (!email.trim() || !password) {
      Alert.alert('Missing Fields', 'Please enter both email and password');
      return;
    }

    const online = await checkNetworkStatus();
    if (!online) {
      Alert.alert('No Connection', 'You need an internet connection to sign in. Please check your network and try again.');
      return;
    }

    const banHours = await AuthGuardian.checkBanStatus(email);
    if (banHours) {
      Alert.alert('Access Denied', `Too many invalid attempts. Try again in ${banHours} hours.`);
      return;
    }

    if (!INSTITUTIONAL_EMAIL_REGEX.test(email)) {
      const attempts = await AuthGuardian.recordFailure(email);
      const remaining = 10 - attempts;
      if (remaining <= 0) {
        Alert.alert('Lockout', 'Device locked for 4 hours due to multiple invalid attempts.');
      } else {
        Alert.alert('Invalid Email', `Please use your institutional student email.\n(${remaining} attempts left)`);
      }
      return;
    }

    setIsLoading(true);
    const finishTransaction = startTransaction('auth.login', { email: email.trim().toLowerCase() });
    try {
      const { data: provider, error: providerError } = await supabase.rpc('check_existing_account', { email_addr: email.trim().toLowerCase() });

      // Only block on known provider responses — if RPC errors, fall through to normal auth
      if (!providerError) {
        // Sentry: log what check_existing_account returned
        Sentry.addBreadcrumb({
          category: 'auth.rpc',
          message: `check_existing_account result: ${provider}`,
          data: { provider, email: email.trim().toLowerCase() },
          level: 'info',
        });
        if (provider === 'google') {
          Alert.alert('Use Google Sign-In', 'This account is linked to Google. Please use "Continue with Google" below.');
          setIsLoading(false);
          return;
        }

        if (provider === 'graduated') {
          Alert.alert(
            'Account Graduated',
            'This email belongs to a graduated student. The NALISS UMYU Hub is only for currently enrolled students.\n\nYour alumni record is preserved in the system.',
            [{ text: 'OK', style: 'default' }]
          );
          setIsLoading(false);
          return;
        }

        if (provider === 'incomplete') {
          Alert.alert(
            'Registration Incomplete',
            'Your account registration was not completed. Please create an account to finish setting up your profile.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Create Account', onPress: () => router.push('/auth/eligibility' as any) },
            ]
          );
          setIsLoading(false);
          return;
        }

        if (provider === 'none') {
          Alert.alert(
            'Account Not Found',
            'No account found with this email. Would you like to sign up?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Create Account', onPress: () => router.push('/auth/eligibility' as any) },
            ]
          );
          setIsLoading(false);
          return;
        }
      }

      await AuthGuardian.clearFailures(email);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out. Please check your connection and try again.')), 15000);
      });
      const signInPromise = supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      const { error } = await Promise.race([signInPromise, timeoutPromise]) as any;
      if (error) throw error;
      finishTransaction('ok');
      // Sentry: breadcrumb for successful login
      Sentry.addBreadcrumb({
        category: 'auth',
        message: 'Login successful',
        data: { email: email.trim().toLowerCase(), method: 'email' },
        level: 'info',
      });
      // Navigation handled by ProtectedRoute's onAuthStateChange

      // Log successful login (best-effort, fire-and-forget)
      (async () => { try { await supabase.from('activity_logs' as any).insert({ action: 'auth.login_success', entity_type: 'auth', description: `Successful login: ${email.trim().toLowerCase()}`, metadata: { email: email.trim().toLowerCase(), method: 'email' } }); } catch (_) {} })();

    } catch (err: any) {
      finishTransaction('error');
      const msg = err.message || 'Login failed. Please try again.';
      // Sentry: capture login errors with full context
      Sentry.captureException(err, {
        tags: { location: 'LoginScreen.handleLogin' },
        extra: { email: email.trim().toLowerCase(), errorMessage: msg },
      });

      // Log failed login attempt server-side (best-effort, fire-and-forget)
      (async () => { try { await supabase.from('activity_logs' as any).insert({ action: 'auth.login_failed', entity_type: 'auth', description: `Failed login attempt: ${email.trim().toLowerCase()}`, metadata: { email: email.trim().toLowerCase(), reason: msg, method: 'email' } }); } catch (_) {} })();

      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        Alert.alert('Wrong Password', 'The password you entered is incorrect. Please try again.');
      } else if (msg.includes('Email not confirmed')) {
        Alert.alert('Email Not Verified', 'Please check your email and verify your account before signing in.');
      } else {
        Alert.alert('Login Failed', msg);
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      setIsGoogleLoading(true);

      const online = await checkNetworkStatus();
      if (!online) {
        Alert.alert('No Connection', 'You need an internet connection to sign in with Google.');
        setIsGoogleLoading(false);
        return;
      }

      useSignupStore.getState().setIsGoogleDelaying(true);

      const redirectUrl = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      // Check if session got set in the background during deep link redirect
      const { data: { session: activeSession } } = await supabase.auth.getSession();

      if ((result.type === 'success' && (result as any).url) || activeSession) {
        let user = activeSession?.user || null;
        let accessToken = activeSession?.access_token || null;
        let refreshToken = activeSession?.refresh_token || null;

        if (!accessToken || !refreshToken) {
          if ((result as any).url) {
            const url = (result as any).url;
            const hashPart = url.split('#')[1] || '';
            const queryPart = url.split('?')[1]?.split('#')[0] || '';
            const hashParams = new URLSearchParams(hashPart);
            const queryParams = new URLSearchParams(queryPart);
            accessToken = hashParams.get('access_token') || queryParams.get('access_token');
            refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
          }
        }

        if (accessToken && refreshToken) {
          if (!activeSession) {
            const { data: { user: sessionUser }, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) throw sessionError;
            user = sessionUser;
          }

          if (user?.email && !INSTITUTIONAL_EMAIL_REGEX.test(user.email)) {
            await AuthGuardian.recordFailure(user.email);
            Alert.alert('Access Denied', 'Only institutional student emails are allowed.');
            await supabase.auth.signOut();
            useSignupStore.getState().setIsGoogleDelaying(false);
            return;
          }

          // Strict account separation: Block Google logins if the account was originally registered via Email/Password
          if (user?.app_metadata?.provider === 'email') {
            Alert.alert(
              'Use Email Sign-In',
              'This account is registered via Email and Password. Please sign in using your password.',
              [{ text: 'OK', style: 'default' }]
            );
            await supabase.auth.signOut();
            useSignupStore.getState().setIsGoogleDelaying(false);
            return;
          }

          // Check if this Google account belongs to a graduated student
          if (user?.id) {
            const { data: profileCheck } = await supabase
              .from('users')
              .select('status, level')
              .eq('id', user.id)
              .maybeSingle();

            if (profileCheck?.status === 'graduated') {
              Alert.alert(
                'Account Graduated',
                'This account belongs to a graduated student. The NALISS UMYU Hub is only for currently enrolled students.\n\nYour alumni record is preserved in the system.',
                [{ text: 'OK', style: 'default' }]
              );
              await supabase.auth.signOut();
              useSignupStore.getState().setIsGoogleDelaying(false);
              return;
            }

            if (!profileCheck || !profileCheck.level) {
              Alert.alert(
                'Registration Incomplete',
                'Your account registration was not completed. Please create an account to finish setting up your profile.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Create Account', onPress: () => router.push('/auth/eligibility' as any) },
                ]
              );
              await supabase.auth.signOut();
              useSignupStore.getState().setIsGoogleDelaying(false);
              return;
            }
          }

          // Fetch profile and check completeness before releasing isGoogleDelaying
          await useAuthStore.getState().fetchProfile(true);
          await useAuthStore.getState().checkProfileComplete(user!.id);
          useSignupStore.getState().setIsGoogleDelaying(false);
        } else {
          // Tokens not found in redirect URL — silent fail, user likely cancelled
          useSignupStore.getState().setIsGoogleDelaying(false);
          setIsGoogleLoading(false);
          return;
        }
      } else {
        useSignupStore.getState().setIsGoogleDelaying(false);
      }
    } catch (err: any) {
      useSignupStore.getState().setIsGoogleDelaying(false);
      // Log Google auth failure (best-effort)
      (async () => { try { await supabase.from('activity_logs' as any).insert({ action: 'auth.login_failed', entity_type: 'auth', description: 'Failed Google sign-in attempt', metadata: { reason: err?.message || 'Unknown', method: 'google' } }); } catch (_) {} })();
      Alert.alert('Google Sign-In Failed', 'Sign-in failed. Please try again.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Hero gradient header */}
      <LinearGradient
        colors={['#052e16', '#14532d', '#166534']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroDeco1} />
        <View style={styles.heroDeco2} />
        <View style={styles.heroDeco3} />
        <View style={styles.heroContent}>
          <View style={styles.logoRing}>
            <NalissLogo size={56} />
          </View>
          <Text style={styles.heroTitle}>NALISS UMYU HUB</Text>
          <Text style={styles.heroTagline}>Information is Light</Text>
        </View>
      </LinearGradient>

      {/* Form card */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome Back</Text>
          <Text style={styles.cardSub}>Sign in to your student account</Text>

          {/* Email */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Institutional Email</Text>
            <View style={[styles.inputRow, emailFocused && styles.inputFocused]}>
              <Ionicons name="mail-outline" size={18} color={emailFocused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
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
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View style={[styles.inputRow, passwordFocused && styles.inputFocused]}>
              <Ionicons name="lock-closed-outline" size={18} color={passwordFocused ? COLORS.primary : '#94a3b8'} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#cbd5e1"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            {/* Forgot password — below input, right-aligned */}
            <TouchableOpacity onPress={() => router.push('/auth/reset-password')} style={styles.forgotRow}>
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Sign In */}
          <TouchableOpacity
            style={[styles.primaryBtn, (isLoading || !isOnline) && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={isLoading || isGoogleLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>{isOnline ? 'Sign In' : 'No Connection'}</Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google */}
          <TouchableOpacity
            style={[styles.googleBtn, isGoogleLoading && styles.btnDisabled]}
            onPress={handleGoogleAuth}
            disabled={isLoading || isGoogleLoading}
            activeOpacity={0.85}
          >
            {isGoogleLoading ? (
              <ActivityIndicator color="#ef4444" size="small" />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color="#ef4444" />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Register */}
          <View style={styles.registerRow}>
            <Text style={styles.registerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/auth/eligibility' as any)}>
              <Text style={styles.registerLink}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.footer}>NALISS UMYU HUB © 2026 • LIS Department</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  hero: {
    height: height * 0.30,
    justifyContent: 'flex-end',
    paddingBottom: 28,
    overflow: 'hidden',
  },
  heroDeco1: { position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.05)' },
  heroDeco2: { position: 'absolute', top: 10, left: -70, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.04)' },
  heroDeco3: { position: 'absolute', bottom: -30, right: 30, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.04)' },
  heroContent: { alignItems: 'center', paddingHorizontal: 24 },
  logoRing: {
    width: 76, height: 76, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { fontSize: 20, fontFamily: 'Inter-Bold', color: '#fff', letterSpacing: 1.5, marginBottom: 3 },
  heroTagline: { fontSize: 12, fontFamily: 'Inter-Medium', color: 'rgba(255,255,255,0.55)', letterSpacing: 2.5, textTransform: 'uppercase' },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 28,
    marginTop: -22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 8,
  },
  cardTitle: { fontSize: 22, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 3, textAlign: 'center' },
  cardSub: { fontSize: 13, fontFamily: 'Inter-Regular', color: '#64748b', marginBottom: 26, textAlign: 'center' },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#374151', marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.5 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  forgotLink: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: COLORS.primary },
  forgotRow: { alignItems: 'flex-end', marginTop: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8fafc', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e2e8f0',
    paddingHorizontal: 14, height: 52,
  },
  inputFocused: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter-Regular', color: '#0f172a', height: '100%' },
  eyeBtn: { padding: 4 },
  primaryBtn: {
    backgroundColor: COLORS.primary, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 6,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 10, elevation: 5,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter-Bold', letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.55 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerText: { marginHorizontal: 12, fontSize: 11, fontFamily: 'Inter-Medium', color: '#94a3b8' },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 14, borderWidth: 1.5,
    borderColor: '#fca5a5', backgroundColor: '#fff5f5', gap: 10,
  },
  googleBtnText: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: '#dc2626' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 22 },
  registerText: { fontSize: 13, fontFamily: 'Inter-Regular', color: '#64748b' },
  registerLink: { fontSize: 13, fontFamily: 'Inter-Bold', color: COLORS.primary },
  footer: { textAlign: 'center', fontSize: 11, fontFamily: 'Inter-Regular', color: '#cbd5e1', marginTop: 22, letterSpacing: 0.5 },
});
