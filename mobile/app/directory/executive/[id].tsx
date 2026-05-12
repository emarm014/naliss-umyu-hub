import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  SafeAreaView, StatusBar, Linking, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../../src/constants/Colors';
import { useDirectoryStore } from '../../../src/stores/directory.store';
import { getOptimizedCloudinaryUrl } from '../../../src/lib/cloudinary';
import { format } from 'date-fns';

export default function ExecutiveDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { executives } = useDirectoryStore();
  const [exec, setExec] = useState<any>(null);

  useEffect(() => {
    const found = executives.find((e: any) => e.id === id);
    if (found) setExec(found);
  }, [id, executives]);

  if (!exec) {
    return (
      <View style={styles.root}>
        <SafeAreaView>
          <TouchableOpacity style={styles.backBtnSafe} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const name = exec.full_name || exec.user?.full_name || 'Executive';
  const avatarUrl = exec.avatar_url || exec.user?.avatar_url;
  const initials = name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
  const isActive = exec.is_active !== false;

  const formatDate = (d: string | null) => {
    if (!d) return null;
    try { return format(new Date(d), 'MMM yyyy'); } catch { return null; }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Hero — gold/amber gradient for executives */}
      <LinearGradient
        colors={['#78350f', '#92400e', '#b45309']}
        style={styles.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.deco1} />
        <View style={styles.deco2} />

        <SafeAreaView>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
        </SafeAreaView>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarRing}>
            {avatarUrl ? (
              <Image
                source={{ uri: getOptimizedCloudinaryUrl(avatarUrl, 300, 300) }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
          </View>

          {/* Status badge */}
          <View style={[styles.statusBadge, isActive ? styles.statusActive : styles.statusInactive]}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? '#4ade80' : '#94a3b8' }]} />
            <Text style={styles.statusText}>{isActive ? 'CURRENT OFFICIAL' : 'FORMER OFFICIAL'}</Text>
          </View>
        </View>

        <Text style={styles.heroName}>{name}</Text>
        <Text style={styles.heroPosition}>{exec.position}</Text>
        {exec.position_code && (
          <Text style={styles.heroCode}>{exec.position_code}</Text>
        )}
        <Text style={styles.heroDept}>NALISS STUDENT UNION · UMYU KATSINA</Text>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>{exec.academic_session || 'NALISS UMYU HUB'}</Text>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {/* Tenure card */}
        <View style={styles.tenureRow}>
          {exec.academic_session && (
            <View style={styles.tenureCard}>
              <Ionicons name="calendar-outline" size={18} color="#b45309" />
              <Text style={styles.tenureLabel}>Session</Text>
              <Text style={styles.tenureValue}>{exec.academic_session}</Text>
            </View>
          )}
          {(exec.start_date || exec.end_date) && (
            <View style={styles.tenureCard}>
              <Ionicons name="time-outline" size={18} color="#b45309" />
              <Text style={styles.tenureLabel}>Tenure</Text>
              <Text style={styles.tenureValue}>
                {formatDate(exec.start_date) || '?'} – {formatDate(exec.end_date) || 'Present'}
              </Text>
            </View>
          )}
        </View>

        {/* Contact buttons */}
        {(exec.email || exec.phone) && (
          <View style={styles.contactRow}>
            {exec.email && (
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => Linking.openURL(`mailto:${exec.email}`)}
              >
                <Ionicons name="mail" size={16} color="#fff" />
                <Text style={styles.contactBtnText}>Email</Text>
              </TouchableOpacity>
            )}
            {exec.phone && (
              <TouchableOpacity
                style={[styles.contactBtn, styles.contactBtnOutline]}
                onPress={() => Linking.openURL(`tel:${exec.phone}`)}
              >
                <Ionicons name="call-outline" size={16} color="#b45309" />
                <Text style={[styles.contactBtnText, { color: '#b45309' }]}>Call</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Biography */}
        {exec.bio ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionAccent} />
              <Text style={styles.sectionTitle}>About</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.bioText}>{exec.bio}</Text>
            </View>
          </View>
        ) : null}

        {/* Role & Responsibilities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionTitle}>Official Role</Text>
          </View>
          <View style={styles.card}>
            <View style={styles.roleRow}>
              <View style={styles.roleIcon}>
                <Ionicons name="star" size={16} color="#b45309" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.roleTitle}>{exec.position}</Text>
                {exec.position_code && (
                  <Text style={styles.roleCode}>{exec.position_code}</Text>
                )}
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Ionicons name="school-outline" size={15} color="#b45309" />
              <Text style={styles.infoText}>
                Department of Library & Information Science, UMYU Katsina
              </Text>
            </View>
            {exec.academic_session && (
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={15} color="#b45309" />
                <Text style={styles.infoText}>Academic Session: {exec.academic_session}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Contact info */}
        {(exec.email || exec.phone) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionAccent} />
              <Text style={styles.sectionTitle}>Contact</Text>
            </View>
            <View style={styles.card}>
              {exec.email && (
                <View style={styles.infoRow}>
                  <Ionicons name="mail-outline" size={15} color="#b45309" />
                  <Text style={styles.infoText}>{exec.email}</Text>
                </View>
              )}
              {exec.phone && (
                <View style={styles.infoRow}>
                  <Ionicons name="call-outline" size={15} color="#b45309" />
                  <Text style={styles.infoText}>{exec.phone}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fffbeb' },
  backBtnSafe: { padding: 16 },

  hero: {
    paddingBottom: 32, paddingHorizontal: 24,
    position: 'relative', overflow: 'hidden',
  },
  deco1: {
    position: 'absolute', top: -60, right: -60,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  deco2: {
    position: 'absolute', bottom: -40, left: -80,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: Platform.OS === 'android' ? 12 : 0,
    marginBottom: 16,
  },
  avatarSection: { alignItems: 'center', marginBottom: 16 },
  avatarRing: {
    width: 110, height: 110, borderRadius: 28,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)',
  },
  avatar: { width: '100%', height: '100%' },
  avatarPlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 36, fontFamily: 'Inter-Bold', color: '#fff' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, marginTop: 10,
  },
  statusActive: { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.3)' },
  statusInactive: { backgroundColor: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.3)' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 9, fontFamily: 'Inter-Bold', color: '#fff', letterSpacing: 1.5 },
  heroName: { fontSize: 24, fontFamily: 'Inter-Bold', color: '#fff', textAlign: 'center', marginBottom: 4 },
  heroPosition: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: 2 },
  heroCode: { fontSize: 11, fontFamily: 'Inter-Bold', color: 'rgba(251,191,36,0.8)', textAlign: 'center', letterSpacing: 1, marginBottom: 4 },
  heroDept: { fontSize: 10, fontFamily: 'Inter-Bold', color: 'rgba(255,255,255,0.5)', textAlign: 'center', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  heroBadge: {
    alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  heroBadgeText: { fontSize: 10, fontFamily: 'Inter-Bold', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5 },

  content: { flex: 1 },
  tenureRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  tenureCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#fef3c7',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  tenureLabel: { fontSize: 10, fontFamily: 'Inter-Bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  tenureValue: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#0f172a', textAlign: 'center' },

  contactRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16, flexWrap: 'wrap' },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#b45309', paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 14, flex: 1, justifyContent: 'center',
    shadowColor: '#b45309', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  contactBtnOutline: { backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#fde68a', shadowOpacity: 0, elevation: 0 },
  contactBtnText: { fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' },

  section: { paddingHorizontal: 20, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionAccent: { width: 4, height: 20, backgroundColor: '#b45309', borderRadius: 2 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter-Bold', color: '#0f172a' },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#fef3c7',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  bioText: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#334155', lineHeight: 22 },
  roleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  roleIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  roleTitle: { fontSize: 15, fontFamily: 'Inter-Bold', color: '#0f172a', marginBottom: 2 },
  roleCode: { fontSize: 11, fontFamily: 'Inter-SemiBold', color: '#b45309', letterSpacing: 0.5 },
  divider: { height: 1, backgroundColor: '#fef3c7', marginVertical: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  infoText: { flex: 1, fontSize: 13, fontFamily: 'Inter-Regular', color: '#334155' },
});
