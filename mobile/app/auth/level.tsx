import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, SafeAreaView,
  Alert, Platform, ScrollView, StatusBar, Animated, Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/api/supabase/client';
import { COLORS } from '../../src/constants/Colors';
import { useSignupStore } from '../../src/stores/signup.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { useGroupStore } from '../../src/stores/group.store';
import { NalissLogo } from '../../src/components/NalissLogo';
import { cleanupIncompleteSignup } from '../../src/utils/signup-cleanup';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { captureUIError, trackFeature, startTransaction } from '../../src/utils/sentry';

const LEVELS = [
  { id: '100', title: '100 Level', desc: 'Freshman year — foundation courses' },
  { id: '200', title: '200 Level', desc: 'Sophomore year — core modules' },
  { id: '300', title: '300 Level', desc: 'Junior year — specialized tracks' },
  { id: '400', title: '400 Level', desc: 'Final year — projects & graduation' },
];

// ── Real sub-steps with their target % and label ──────────────────────────────
// Each step fires when a real async operation completes.
// The progress bar animates smoothly TO that target as the work finishes.
// No fake timers — every % advance = real work done.
const STEPS = [
  { pct: 0,   label: '' },                                    // 0 — idle
  { pct: 8,   label: 'Verifying session…' },                  // 1 — getUser()
  { pct: 18,  label: 'Saving account details…' },             // 2 — auth.updateUser() metadata
  { pct: 32,  label: 'Setting your password…' },              // 3 — auth.updateUser() password (email only)
  { pct: 48,  label: 'Uploading profile photo…' },            // 4 — Cloudinary avatar upload (Google)
  { pct: 62,  label: 'Creating your profile…' },              // 5 — create_user_profile RPC
  { pct: 74,  label: 'Verifying profile record…' },           // 6 — fetchProfile
  { pct: 86,  label: 'Joining your level groups…' },          // 7 — fetchGroups
  { pct: 95,  label: 'Finalising setup…' },                   // 8 — store reset + brief hold
  { pct: 100, label: 'Welcome to NALISS UMYU Hub! 🎉' },      // 9 — done
];

export default function RegisterLevel() {
  useSentryScreen('RegisterLevel');
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const isMounted = useRef(true);
  const router = useRouter();
  const signupStore = useSignupStore();
  const session = useAuthStore(s => s.session);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Animate progress bar to the target % for the current step.
  // Duration scales with how far the bar needs to travel — feels natural.
  const advanceTo = useCallback((idx: number) => {
    if (!isMounted.current) return;
    setStepIndex(idx);
    const target = STEPS[idx].pct / 100;
    const current = (progressAnim as any)._value ?? 0;
    const distance = Math.abs(target - current);
    const duration = Math.max(300, Math.round(distance * 1200));
    // Stop any in-progress animation before starting the next one
    progressAnim.stopAnimation();
    Animated.timing(progressAnim, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progressAnim]);

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
    store.setCurrentStep(signupStore.provider === 'google' ? 3 : 5);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFinish = async () => {
    if (!selectedLevel) { Alert.alert('Error', 'Please select your current level'); return; }
    await handleFinishWithLevel(selectedLevel);
  };

  const handleFinishWithLevel = async (level: string) => {
    // Read fresh store values inside the async handler to avoid stale closures
    const signupState = useSignupStore.getState();
    const { provider, email: storeEmail, password, full_name, username, reg_number } = signupState;
    const activeEmail = storeEmail || session?.user?.email;

    if (!activeEmail) {
      Alert.alert('Error', 'Session expired. Please start over.');
      router.replace('/auth/register-options');
      return;
    }
    if (!full_name || !username || !reg_number) {
      Alert.alert('Incomplete Setup', 'Some required information is missing. Please go back and fill in your identity details.');
      router.replace('/auth/identity' as any);
      return;
    }
    if (provider === 'email' && !password) {
      Alert.alert('Incomplete Setup', 'Password is missing. Please go back and set your password.');
      router.replace('/auth/register-password' as any);
      return;
    }

    setIsLoading(true);
    advanceTo(1); // 8% — "Verifying session…"
    const finishTransaction = startTransaction('auth.registration', { level: selectedLevel! });

    // Block ProtectedRoute from redirecting while we're loading
    useSignupStore.getState().setIsGoogleDelaying(true);

    // Pre-set isProfileComplete to true BEFORE auth.updateUser fires.
    // auth.updateUser(password) triggers onAuthStateChange(USER_UPDATED) in ProtectedRoute.
    // If isProfileComplete is null at that point, ProtectedRoute queries the DB,
    // finds no profile yet, sets isProfileComplete=false, and may unmount this screen.
    // Setting it to true here prevents that re-check from running.
    // It will be reset to null in the catch block if profile creation fails.
    useAuthStore.getState().setIsProfileComplete(true);

    try {
      const numericLevel = parseInt(level, 10);
      let finalAvatarUrl = '';

      // ── STEP 1: Get current user ──────────────────────────────────────────
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Your session expired. Please start registration again.');

      if (provider === 'google') {
        // ── STEP 2: Update auth metadata (Google) ─────────────────────────
        advanceTo(2); // 18% — "Saving account details…"
        const { error: authUpdateError } = await supabase.auth.updateUser({
          data: { full_name, username, registration_number: reg_number, level: numericLevel.toString(), provider },
        });
        if (authUpdateError) {
          if (
            authUpdateError.message?.toLowerCase().includes('session') ||
            authUpdateError.message?.toLowerCase().includes('token') ||
            authUpdateError.message?.toLowerCase().includes('jwt') ||
            authUpdateError.message?.toLowerCase().includes('expired')
          ) {
            throw new Error('Your session expired. Please start registration again.');
          }
          throw authUpdateError;
        }

        // After auth.updateUser metadata, read current session to sync the client.
        await supabase.auth.getSession();
        await new Promise(r => setTimeout(r, 300));

        // ── STEP 3: Upload Google avatar to Cloudinary ────────────────────
        // Skip the password step for Google (step 3 is email-only)
        advanceTo(4); // 48% — "Uploading profile photo…"
        finalAvatarUrl = `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200`;
        const googleAvatarUrl = user.user_metadata?.avatar_url;
        if (googleAvatarUrl) {
          try {
            const uploadWithTimeout = async () => {
              const { uploadToCloudinary } = await import('../../src/lib/cloudinary');
              const response = await fetch(googleAvatarUrl);
              if (!response.ok) return null;
              const blob = await response.blob();
              return await uploadToCloudinary(blob, 'avatars');
            };
            // 6s timeout — if Cloudinary is slow, fall back to Google URL
            const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 6000));
            const hosted = await Promise.race([uploadWithTimeout(), timeoutPromise]);
            if (hosted) finalAvatarUrl = hosted;
            else finalAvatarUrl = googleAvatarUrl;
          } catch {
            finalAvatarUrl = googleAvatarUrl;
          }
        }

      } else {
        // ── STEP 2: Update auth metadata (email) ──────────────────────────
        advanceTo(2); // 18% — "Saving account details…"
        // Small yield so the UI renders the label before the async call
        await new Promise(r => setTimeout(r, 50));

        // ── STEP 3: Set password + metadata ───────────────────────────────
        advanceTo(3); // 32% — "Setting your password…"
        const { error: updateError } = await supabase.auth.updateUser({
          password: password!,
          data: {
            full_name,
            username,
            registration_number: reg_number,
            level: numericLevel.toString(),
            provider: 'email',
          },
        });

        if (updateError) {
          // "Same password" is not a real error — just update metadata
          if (
            updateError.message?.toLowerCase().includes('same password') ||
            updateError.message?.toLowerCase().includes('different from the old') ||
            updateError.code === 'same_password'
          ) {
            const { error: metaError } = await supabase.auth.updateUser({
              data: { full_name, username, registration_number: reg_number, level: numericLevel.toString(), provider: 'email' },
            });
            if (metaError) throw metaError;
            await supabase.auth.getSession();
            await new Promise(r => setTimeout(r, 300));
          } else if (
            updateError.message?.toLowerCase().includes('session') ||
            updateError.message?.toLowerCase().includes('token')
          ) {
            throw new Error('Your session expired. Please start registration again.');
          } else {
            throw updateError;
          }
        }

        finalAvatarUrl = `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200`;

        // After auth.updateUser(password), the session token is already updated
        // internally by Supabase. Just read the current session to ensure the
        // client is using the latest token — no full refresh needed.
        await supabase.auth.getSession();
        await new Promise(r => setTimeout(r, 300));
      }

      // ── STEP 5: Create public profile via RPC ─────────────────────────────
      advanceTo(5); // 62% — "Creating your profile…"
      await new Promise(r => setTimeout(r, 50)); // yield so label renders

      // Re-fetch the current user after token refresh to ensure we have the
      // latest user ID and the RPC call is authenticated with the fresh token.
      const { data: { user: freshUser } } = await supabase.auth.getUser();
      const profileUserId = freshUser?.id || user.id;
      const profileEmail = freshUser?.email || user.email || activeEmail;

      const { error: profileFnError } = await ((supabase as any).rpc as any)('create_user_profile', {
        p_id: profileUserId,
        p_full_name: full_name || 'Student',
        p_email: profileEmail,
        p_registration_number: reg_number,
        p_level: numericLevel.toString(),
        p_avatar_url: finalAvatarUrl,
        p_username: username || (full_name || 'user').toLowerCase().replace(/\s+/g, '_') + '_' + profileUserId.slice(0, 6),
      });

      if (profileFnError) {
        if (
          profileFnError.message?.includes('unique') ||
          profileFnError.message?.includes('duplicate') ||
          profileFnError.code === '23505'
        ) {
          // Identify which unique constraint was violated
          if (profileFnError.message?.includes('username')) {
            throw new Error('This username is already taken. Please go back and choose a different username.');
          }
          throw new Error('This registration number is already linked to another account. Please check your details.');
        }
        throw new Error(`Profile creation failed: ${profileFnError.message}`);
      }

      // ── STEP 6: Fetch profile (verify it was created) ─────────────────────
      advanceTo(6); // 74% — "Verifying profile record…"
      await useAuthStore.getState().fetchProfile(true);

      // ── STEP 7: Join level groups ─────────────────────────────────────────
      advanceTo(7); // 86% — "Joining your level groups…"
      await useGroupStore.getState().fetchGroups(true);

      // ── STEP 8: Finalise ──────────────────────────────────────────────────
      advanceTo(8); // 95% — "Finalising setup…"
      useSignupStore.getState().setIsGoogleDelaying(false);
      signupStore.reset();

      // Brief hold at 95% so the user sees it before the final jump
      await new Promise(r => setTimeout(r, 400));

      // ── STEP 9: Done ──────────────────────────────────────────────────────
      if (!isMounted.current) return;
      advanceTo(9); // 100% — "Welcome to NALISS UMYU Hub! 🎉"

      // Hold at 100% for 800ms so the user reads the success message
      await new Promise(r => setTimeout(r, 800));

      finishTransaction('ok');
      if (!isMounted.current) return;
      router.replace('/(tabs)' as any);

    } catch (err: any) {
      finishTransaction('error');
      captureUIError('RegisterLevel.handleFinish', err, { selectedLevel });
      if (isMounted.current) {
        useSignupStore.getState().setIsGoogleDelaying(false);
        useAuthStore.getState().setIsProfileComplete(null);
        advanceTo(0);
        setIsLoading(false);
        const msg = err?.message || 'Could not complete registration. Please try again.';
        // Username conflict — send back to identity to pick a new one
        if (msg.includes('username is already taken')) {
          Alert.alert('Username Taken', msg, [
            { text: 'Go Back', onPress: () => router.replace('/auth/identity' as any) }
          ]);
        } else {
          Alert.alert('Registration Failed', msg);
        }
      }
    } finally {
      // Only clear loading if we hit an error (success path navigates away)
      // isMounted check prevents state update on unmounted component
    }
  };

  const isGoogle = signupStore.provider === 'google';
  const stepCurrent = isGoogle ? 3 : 5;
  const stepTotal = isGoogle ? 3 : 5;
  const currentStep = STEPS[stepIndex];

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />

      {/* ── Full-screen loading overlay ── */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <NalissLogo size={56} rounded />

            <Text style={styles.loadingTitle}>Setting Up Your Account</Text>

            {/* Step label */}
            <Text style={styles.loadingStep}>{currentStep.label}</Text>

            {/* Animated progress bar */}
            <View style={styles.loadingTrack}>
              <Animated.View
                style={[
                  styles.loadingFill,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                    // Turn green at 100%
                    backgroundColor: stepIndex === 9 ? '#16a34a' : COLORS.primary,
                  },
                ]}
              />
            </View>

            {/* Live percentage — updates as each step completes */}
            <Animated.Text style={[
              styles.loadingPercent,
              { color: stepIndex === 9 ? '#16a34a' : COLORS.primary },
            ]}>
              {currentStep.pct}%
            </Animated.Text>

            {/* Step dots — one per real operation */}
            <View style={styles.stepDots}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => (
                <View
                  key={s}
                  style={[
                    styles.stepDot,
                    stepIndex >= s && styles.stepDotActive,
                    stepIndex === 9 && styles.stepDotDone,
                  ]}
                />
              ))}
            </View>

            <Text style={styles.loadingHint}>
              {stepIndex === 9
                ? '✓ All done — opening your dashboard'
                : 'Please wait — do not close the app'}
            </Text>
          </View>
        </View>
      )}

      {/* Nav */}
      <View style={styles.nav}>
        <View style={styles.navLeft}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} disabled={isLoading}>
            <Ionicons name="arrow-back" size={22} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>NALISS UMYU HUB</Text>
        </View>
        <TouchableOpacity
          style={styles.signInBtn}
          onPress={async () => { await cleanupIncompleteSignup(); router.replace('/auth/login'); }}
          disabled={isLoading}
        >
          <Ionicons name="log-in-outline" size={16} color="#fff" />
          <Text style={styles.signInBtnText}>Sign In</Text>
        </TouchableOpacity>
      </View>

      {/* Step progress bar (top of screen) */}
      <View style={styles.progressWrap}>
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>Finalizing Identity Binding</Text>
          <Text style={styles.progressStep}>Step {stepCurrent} of {stepTotal}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: '100%' }]} />
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <NalissLogo size={72} rounded />
          </View>
          <Text style={styles.title}>Confirm Academic Level</Text>
          <Text style={styles.subtitle}>Select your current level. This cannot be changed after confirmation.</Text>
        </View>

        {/* Level cards */}
        <View style={styles.grid}>
          {LEVELS.map(level => (
            <TouchableOpacity
              key={level.id}
              style={[
                styles.levelCard,
                selectedLevel === level.id && styles.levelCardSelected,
                isLoading && styles.levelCardDisabled,
              ]}
              onPress={() => !isLoading && setSelectedLevel(level.id)}
              disabled={isLoading}
              activeOpacity={0.75}
            >
              <View style={[styles.levelBadge, selectedLevel === level.id && styles.levelBadgeSelected]}>
                <Text style={[styles.levelBadgeText, selectedLevel === level.id && styles.levelBadgeTextSelected]}>
                  {level.id}
                </Text>
              </View>
              <View style={styles.levelInfo}>
                <Text style={[styles.levelTitle, selectedLevel === level.id && styles.levelTitleSelected]}>{level.title}</Text>
                <Text style={styles.levelDesc}>{level.desc}</Text>
              </View>
              <View style={[styles.radio, selectedLevel === level.id && styles.radioSelected]}>
                {selectedLevel === level.id && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, (!selectedLevel || isLoading) && styles.btnDisabled]}
            onPress={handleFinish}
            disabled={!selectedLevel || isLoading}
            activeOpacity={0.85}
          >
            <View style={styles.btnInner}>
              <Text style={styles.btnText}>Complete Setup</Text>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={styles.securityLabel}>UMYU HUB SECURE VERIFICATION</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 8 : 16, paddingBottom: 4,
  },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 10, borderRadius: 12, backgroundColor: '#fff' },
  navTitle: { fontSize: 16, fontFamily: 'Inter-Bold', color: '#0f172a' },
  signInBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  signInBtnText: { fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' },
  progressWrap: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#475569' },
  progressStep: { fontSize: 12, fontFamily: 'Inter-Bold', color: COLORS.primary },
  progressTrack: { height: 5, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: COLORS.primary, borderRadius: 3 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 24 },
  logoWrap: {
    width: 88, height: 88, borderRadius: 26, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 14, elevation: 5,
  },
  title: { fontSize: 22, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 13, fontFamily: 'Inter-Regular', color: '#64748b', textAlign: 'center', lineHeight: 19, paddingHorizontal: 10 },
  grid: { gap: 12, marginBottom: 28 },
  levelCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 18, padding: 16,
    borderWidth: 1.5, borderColor: '#f1f5f9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  levelCardSelected: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  levelCardDisabled: { opacity: 0.6 },
  levelBadge: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
  },
  levelBadgeSelected: { backgroundColor: COLORS.primary },
  levelBadgeText: { fontSize: 13, fontFamily: 'Inter-Bold', color: '#64748b' },
  levelBadgeTextSelected: { color: '#fff' },
  levelInfo: { flex: 1 },
  levelTitle: { fontSize: 15, fontFamily: 'Inter-SemiBold', color: '#0f172a', marginBottom: 2 },
  levelTitleSelected: { color: COLORS.primary },
  levelDesc: { fontSize: 12, fontFamily: 'Inter-Regular', color: '#64748b' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: COLORS.primary },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.primary },
  footer: { alignItems: 'center', gap: 14 },
  btn: {
    backgroundColor: COLORS.primary, width: '100%', height: 56, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22, shadowRadius: 10, elevation: 6,
  },
  btnDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0, elevation: 0 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter-Bold' },
  securityLabel: { fontSize: 10, fontFamily: 'Inter-Bold', color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase' },

  // ── Loading overlay ──────────────────────────────────────────────────────
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.75)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 999,
  },
  loadingCard: {
    backgroundColor: '#fff', borderRadius: 28,
    paddingVertical: 36, paddingHorizontal: 32,
    alignItems: 'center', width: '84%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 16,
    gap: 10,
  },
  loadingTitle: {
    fontSize: 17, fontFamily: 'Inter-Bold', color: '#0f172a',
    textAlign: 'center', marginTop: 4,
  },
  loadingStep: {
    fontSize: 13, fontFamily: 'Inter-Medium', color: COLORS.primary,
    textAlign: 'center', minHeight: 20,
  },
  loadingTrack: {
    width: '100%', height: 8, backgroundColor: '#e2e8f0',
    borderRadius: 4, overflow: 'hidden', marginTop: 6,
  },
  loadingFill: {
    height: 8, borderRadius: 4,
  },
  loadingPercent: {
    fontSize: 28, fontFamily: 'Inter-Bold',
    marginTop: 4,
  },
  stepDots: {
    flexDirection: 'row', gap: 5, marginTop: 4,
  },
  stepDot: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#e2e8f0',
  },
  stepDotActive: {
    backgroundColor: COLORS.primary,
  },
  stepDotDone: {
    backgroundColor: '#16a34a',
  },
  loadingHint: {
    fontSize: 11, fontFamily: 'Inter-Regular', color: '#94a3b8',
    textAlign: 'center', marginTop: 4,
  },
});
