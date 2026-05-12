import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NalissLogo } from '../../src/components/NalissLogo';
import { COLORS } from '../../src/constants/Colors';

const { width } = Dimensions.get('window');

const ELIGIBILITY_POINTS = [
  {
    icon: 'school-outline' as const,
    title: 'Enrolled Students Only',
    body: 'You must be a currently enrolled student of the Department of Library and Information Science (LIS/BLIS), Umaru Musa Yar\'adua University, Katsina.',
  },
  {
    icon: 'mail-outline' as const,
    title: 'Institutional Email Required',
    body: 'Registration requires a valid UMYU institutional email address ending in @students.umyu.edu.ng.',
  },
  {
    icon: 'card-outline' as const,
    title: 'Valid Registration Number',
    body: 'Your UMYU registration number (e.g. U1/22/BLIS/1234) must match your student email ID for identity verification.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    title: 'One Account Per Student',
    body: 'Each student is permitted one account only. Duplicate accounts will be removed and access may be revoked.',
  },
  {
    icon: 'people-outline' as const,
    title: 'Community Standards',
    body: 'By joining, you agree to use this platform respectfully. Misuse, harassment, or sharing of inappropriate content will result in immediate account suspension.',
  },
  {
    icon: 'lock-closed-outline' as const,
    title: 'Access Revocation',
    body: 'Access is automatically revoked upon graduation, suspension, or violation of platform rules. Alumni records are preserved for institutional purposes.',
  },
];

export default function EligibilityScreen() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const checkAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;

  const handleToggle = () => {
    const next = !accepted;
    setAccepted(next);

    Animated.spring(checkAnim, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      tension: 120,
      friction: 8,
    }).start();

    if (next) {
      Animated.sequence([
        Animated.timing(btnAnim, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.back(1.5)) }),
      ]).start();
    } else {
      Animated.timing(btnAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  };

  const handleProceed = () => {
    if (!accepted) return;
    router.push('/auth/register-options');
  };

  const checkScale = checkAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const checkOpacity = checkAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const btnScale = btnAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <LinearGradient
        colors={['#052e16', '#14532d', '#166534']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        {/* Decorative circles */}
        <View style={styles.deco1} />
        <View style={styles.deco2} />

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        <View style={styles.headerContent}>
          <View style={styles.logoRing}>
            <NalissLogo size={52} />
          </View>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Ionicons name="shield-checkmark" size={11} color="#86efac" />
              <Text style={styles.badgeText}>ELIGIBILITY VERIFICATION</Text>
            </View>
          </View>
          <Text style={styles.headerTitle}>Access Requirements</Text>
          <Text style={styles.headerSub}>
            NALISS UMYU Hub is an exclusive platform for LIS students at UMYU Katsina.
            Please read and confirm your eligibility before proceeding.
          </Text>
        </View>
      </LinearGradient>

      {/* Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Institution card */}
        <View style={styles.institutionCard}>
          <View style={styles.institutionIconWrap}>
            <Ionicons name="business" size={22} color={COLORS.primary} />
          </View>
          <View style={styles.institutionText}>
            <Text style={styles.institutionName}>
              Department of Library & Information Science
            </Text>
            <Text style={styles.institutionUniversity}>
              Umaru Musa Yar'adua University, Katsina
            </Text>
          </View>
        </View>

        {/* Eligibility points */}
        <Text style={styles.sectionLabel}>ELIGIBILITY CRITERIA</Text>

        {ELIGIBILITY_POINTS.map((point, index) => (
          <View key={index} style={styles.pointCard}>
            <View style={styles.pointIconWrap}>
              <Ionicons name={point.icon} size={20} color={COLORS.primary} />
            </View>
            <View style={styles.pointContent}>
              <Text style={styles.pointTitle}>{point.title}</Text>
              <Text style={styles.pointBody}>{point.body}</Text>
            </View>
          </View>
        ))}

        {/* Acceptance checkbox */}
        <TouchableOpacity
          style={[styles.checkboxRow, accepted && styles.checkboxRowActive]}
          onPress={handleToggle}
          activeOpacity={0.8}
        >
          <TouchableOpacity
            style={[styles.checkbox, accepted && styles.checkboxChecked]}
            onPress={handleToggle}
            activeOpacity={0.7}
          >
            <Animated.View style={{ transform: [{ scale: checkScale }], opacity: checkOpacity }}>
              <Ionicons name="checkmark" size={16} color="#fff" />
            </Animated.View>
          </TouchableOpacity>
          <Text style={[styles.checkboxLabel, accepted && styles.checkboxLabelActive]}>
            I confirm that I am a currently enrolled LIS/BLIS student at UMYU Katsina and I agree to the access requirements above.
          </Text>
        </TouchableOpacity>

        {/* Proceed button */}
        <Animated.View style={{ transform: [{ scale: accepted ? btnScale : new Animated.Value(1) }] }}>
          <TouchableOpacity
            style={[styles.proceedBtn, !accepted && styles.proceedBtnDisabled]}
            onPress={handleProceed}
            disabled={!accepted}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={accepted ? ['#14532d', '#166534', '#15803d'] : ['#94a3b8', '#94a3b8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.proceedGradient}
            >
              <Text style={styles.proceedText}>
                {accepted ? 'Proceed to Registration' : 'Please Accept to Continue'}
              </Text>
              {accepted && (
                <View style={styles.proceedArrow}>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

        {/* Footer note */}
        <View style={styles.footerNote}>
          <Ionicons name="information-circle-outline" size={15} color="#94a3b8" />
          <Text style={styles.footerNoteText}>
            Already have an account?{' '}
            <Text style={styles.footerNoteLink} onPress={() => router.replace('/auth/login')}>
              Sign In
            </Text>
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  deco1: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  deco2: {
    position: 'absolute',
    bottom: -40,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  headerContent: {
    alignItems: 'center',
  },
  logoRing: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  badgeRow: {
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(134,239,172,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.25)',
  },
  badgeText: {
    fontSize: 9,
    fontFamily: 'Inter-Bold',
    color: '#86efac',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter-Bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },

  // ── Scroll ───────────────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },

  // ── Institution card ─────────────────────────────────────────────────────────
  institutionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    gap: 14,
  },
  institutionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  institutionText: {
    flex: 1,
  },
  institutionName: {
    fontSize: 13,
    fontFamily: 'Inter-Bold',
    color: '#14532d',
    marginBottom: 3,
    lineHeight: 18,
  },
  institutionUniversity: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#166534',
    lineHeight: 16,
  },

  // ── Section label ────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: '#94a3b8',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginLeft: 2,
  },

  // ── Eligibility points ───────────────────────────────────────────────────────
  pointCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  pointIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  pointContent: {
    flex: 1,
  },
  pointTitle: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#0f172a',
    marginBottom: 4,
  },
  pointBody: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#64748b',
    lineHeight: 18,
  },

  // ── Checkbox ─────────────────────────────────────────────────────────────────
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  checkboxRowActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#f0fdf4',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
    backgroundColor: '#f8fafc',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#64748b',
    lineHeight: 20,
  },
  checkboxLabelActive: {
    color: '#14532d',
    fontFamily: 'Inter-Medium',
  },

  // ── Proceed button ───────────────────────────────────────────────────────────
  proceedBtn: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  proceedBtnDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  proceedGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
    gap: 10,
  },
  proceedText: {
    fontSize: 15,
    fontFamily: 'Inter-Bold',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  proceedArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
  },
  footerNoteText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    color: '#94a3b8',
  },
  footerNoteLink: {
    fontFamily: 'Inter-Bold',
    color: COLORS.primary,
  },
});
