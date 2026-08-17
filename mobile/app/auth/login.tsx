import React, { useState } from 'react';
import * as Sentry from '@sentry/react-native';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, StatusBar, Dimensions, TouchableWithoutFeedback, Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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

    const banMinutes = await AuthGuardian.checkBanStatus(email.trim().toLowerCase());
    if (banMinutes) {
      Alert.alert('Account Locked', `Too many invalid attempts. Try again in ${banMinutes} minute${banMinutes > 1 ? 's' : ''}.`);
      return;
    }

    if (!INSTITUTIONAL_EMAIL_REGEX.test(email)) {
      const attempts = await AuthGuardian.recordFailure(email.trim().toLowerCase());
      const remaining = Math.max(0, 5 - attempts);
      if (remaining <= 0) {
        Alert.alert('Lockout', 'Device locked for 30 minutes due to multiple invalid attempts.');
      } else {
        Alert.alert('Invalid Email', `Please use your institutional student email.\n(${remaining} attempt${remaining > 1 ? 's' : ''} left)`);
      }
      return;
    }

    setIsLoading(true);
    const finishTransaction = startTransaction('auth.login', { email: email.trim().toLowerCase() });
    try {
      const { data: provider, error: providerError } = await (supabase as any).rpc('check_existing_account', { email_addr: email.trim().toLowerCase() });

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
      (async () => { try { await (supabase as any).from('activity_logs' as any).insert({ action: 'auth.login_success', entity_type: 'auth', description: `Successful login: ${email.trim().toLowerCase()}`, metadata: { email: email.trim().toLowerCase(), method: 'email' } }); } catch (_) {} })();

    } catch (err: any) {
      finishTransaction('error');
      const msg = err.message || 'Login failed. Please try again.';
      // Sentry: capture login errors with full context
      Sentry.captureException(err, {
        tags: { location: 'LoginScreen.handleLogin' },
        extra: { email: email.trim().toLowerCase(), errorMessage: msg },
      });

      // Log failed login attempt server-side (best-effort, fire-and-forget)
      (async () => { try { await (supabase as any).from('activity_logs' as any).insert({ action: 'auth.login_failed', entity_type: 'auth', description: `Failed login attempt: ${email.trim().toLowerCase()}`, metadata: { email: email.trim().toLowerCase(), reason: msg, method: 'email' } }); } catch (_) {} })();

      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials') || msg.includes('Invalid password') || msg.includes('invalid password')) {
        const attempts = await AuthGuardian.recordFailure(email.trim().toLowerCase());
        const remaining = Math.max(0, 5 - attempts);
        if (remaining <= 0) {
          Alert.alert('Account Locked', 'Too many invalid login attempts. Device locked for 30 minutes.');
        } else {
          Alert.alert('Wrong Password', `The password you entered is incorrect.\n(${remaining} attempt${remaining > 1 ? 's' : ''} left before 30-min lockout)`);
        }
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
            // Purge invalid non-institutional Google account from Supabase
            try {
              await (supabase as any).rpc('purge_incomplete_account', { email_addr: user.email });
            } catch {}
            Alert.alert('Access Denied', 'Only institutional student emails (@students.umyu.edu.ng) are allowed.');
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

          // Check if this Google account belongs to a graduated student, external moderator, or is incomplete
          if (user?.id) {
            const { data: profileCheck } = await (supabase as any).from('users')
              .select('status, level, registration_number, role, is_external')
              .eq('id', user.id)
              .maybeSingle();

            if (
              profileCheck?.is_external === true ||
              (profileCheck?.role === 'moderator' && !profileCheck?.registration_number && !profileCheck?.level)
            ) {
              Alert.alert(
                'Access Denied',
                'External moderators are restricted to the Web Admin Portal only and cannot log into the mobile app.',
                [{ text: 'OK', style: 'default' }]
              );
              await supabase.auth.signOut();
              useSignupStore.getState().setIsGoogleDelaying(false);
              return;
            }

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

            // Incomplete Google registration — seamlessly route to Identity Screen (Step 2)
            if (!profileCheck || !profileCheck.level || !profileCheck.registration_number) {
              const store = useSignupStore.getState();
              store.setProvider('google');
              store.setCredentials(user.email!, undefined);
              store.setGoogleTokens(user.email!, accessToken, refreshToken);
              store.setCurrentStep(2);
              store.touchActivity();
              useAuthStore.getState().setIsProfileComplete(false);
              store.setIsGoogleDelaying(false);
              setIsGoogleLoading(false);
              router.replace('/auth/identity' as any);
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
      (async () => { try { await (supabase as any).from('activity_logs' as any).insert({ action: 'auth.login_failed', entity_type: 'auth', description: 'Failed Google sign-in attempt', metadata: { reason: err?.message || 'Unknown', method: 'google' } }); } catch (_) {} })();
      Alert.alert('Google Sign-In Failed', 'Sign-in failed. Please try again.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.root}>
        <StatusBar barStyle="light-content" />

        {/* Solid Curved Background */}
        <View style={styles.headerBg} />

        <View style={[styles.mainContent, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
          
          {/* Header Area (Logo & Title) */}
          <View style={styles.headerArea}>
            <View style={styles.logoContainer}>
              <NalissLogo size={46} />
            </View>
            <Text style={styles.headerTitle}>NALISS UMYU HUB</Text>
            <Text style={styles.headerTagline}>INFORMATION IS LIGHT</Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome Back</Text>
            <Text style={styles.cardSub}>Sign in to your student account</Text>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>INSTITUTIONAL EMAIL</Text>
              <View style={[styles.inputRow, emailFocused && styles.inputFocused]}>
                <Ionicons name="mail-outline" size={18} color="#6b7280" style={styles.inputIcon} />
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
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <View style={[styles.inputRow, passwordFocused && styles.inputFocused]}>
                <Ionicons name="lock-closed-outline" size={18} color="#6b7280" style={styles.inputIcon} />
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
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#6b7280" />
                </TouchableOpacity>
              </View>
              {/* Forgot password */}
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

            {/* Privacy Policy */}
            <View style={styles.policyRow}>
              <TouchableOpacity onPress={() => router.push('/auth/privacy-policy' as any)}>
                <Text style={styles.policyLink}>PRIVACY POLICY</Text>
              </TouchableOpacity>
              <Text style={styles.policySeparator}>·</Text>
              <TouchableOpacity onPress={() => router.push('/auth/terms-of-service' as any)}>
                <Text style={styles.policyLink}>TERMS OF SERVICE</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Footer Area */}
          <View style={styles.footerArea}>
            <Text style={styles.footerText}>NALISS UMYU HUB © 2026 • LIS DEPARTMENT</Text>
          </View>

        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: '#f8fafc' 
  },
  headerBg: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: height * 0.48,
    backgroundColor: '#0a7e51',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  headerArea: {
    alignItems: 'center',
    marginTop: 20,
  },
  logoContainer: {
    width: 76,
    height: 76,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter-Bold',
    color: '#ffffff',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  headerTagline: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#d1fae5',
    letterSpacing: 3,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 10,
    marginTop: 20,
    marginBottom: 20,
  },
  cardTitle: { 
    fontSize: 22, 
    fontFamily: 'Inter-Bold', 
    color: '#1f2937', 
    marginBottom: 6, 
    textAlign: 'center' 
  },
  cardSub: { 
    fontSize: 14, 
    fontFamily: 'Inter-Regular', 
    color: '#4b5563', 
    marginBottom: 24, 
    textAlign: 'center' 
  },
  field: { 
    marginBottom: 16 
  },
  fieldLabel: { 
    fontSize: 11, 
    fontFamily: 'Inter-Bold', 
    color: '#374151', 
    marginBottom: 8, 
    letterSpacing: 0.5 
  },
  inputRow: {
    flexDirection: 'row', 
    alignItems: 'center',
    backgroundColor: '#ffffff', 
    borderRadius: 8,
    borderWidth: 1, 
    borderColor: '#d1d5db',
    paddingHorizontal: 12, 
    height: 48,
  },
  inputFocused: { 
    borderColor: '#0a7e51', 
    borderWidth: 1.5,
  },
  inputIcon: { 
    marginRight: 8 
  },
  input: { 
    flex: 1, 
    fontSize: 14, 
    fontFamily: 'Inter-Regular', 
    color: '#1f2937', 
    height: '100%' 
  },
  eyeBtn: { 
    padding: 4 
  },
  forgotRow: { 
    alignItems: 'flex-end', 
    marginTop: 8 
  },
  forgotLink: { 
    fontSize: 13, 
    fontFamily: 'Inter-SemiBold', 
    color: '#026a3d' 
  },
  primaryBtn: {
    backgroundColor: '#026a3d', 
    height: 48, 
    borderRadius: 12,
    alignItems: 'center', 
    justifyContent: 'center', 
    marginTop: 8,
  },
  primaryBtnText: { 
    color: '#ffffff', 
    fontSize: 15, 
    fontFamily: 'Inter-Bold', 
    letterSpacing: 0.2 
  },
  btnDisabled: { 
    opacity: 0.6 
  },
  divider: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginVertical: 20 
  },
  dividerLine: { 
    flex: 1, 
    height: 1, 
    backgroundColor: '#e5e7eb' 
  },
  dividerText: { 
    marginHorizontal: 12, 
    fontSize: 12, 
    fontFamily: 'Inter-Regular', 
    color: '#6b7280' 
  },
  googleBtn: {
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center',
    height: 48, 
    borderRadius: 12, 
    borderWidth: 1,
    borderColor: '#fca5a5', 
    backgroundColor: '#ffffff', 
    gap: 8,
  },
  googleBtnText: { 
    fontSize: 14, 
    fontFamily: 'Inter-SemiBold', 
    color: '#ef4444' 
  },
  registerRow: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 20 
  },
  registerText: { 
    fontSize: 13, 
    fontFamily: 'Inter-Regular', 
    color: '#4b5563' 
  },
  registerLink: { 
    fontSize: 13, 
    fontFamily: 'Inter-Bold', 
    color: '#026a3d' 
  },
  policyRow: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 16 
  },
  policyLink: { 
    fontSize: 11, 
    color: '#026a3d', 
    fontFamily: 'Inter-Bold',
    letterSpacing: 0.5
  },
  policySeparator: { 
    fontSize: 11, 
    color: '#d1d5db', 
    marginHorizontal: 8 
  },
  footerArea: {
    alignItems: 'center',
    marginBottom: 10,
  },
  footerText: { 
    fontSize: 11, 
    fontFamily: 'Inter-SemiBold', 
    color: '#9ca3af', 
    letterSpacing: 1 
  },
});
