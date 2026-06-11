import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  SafeAreaView, StatusBar, Linking, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../../src/constants/Colors';
import { useDirectoryStore } from '../../../src/stores/directory.store';
import { getOptimizedCloudinaryUrl } from '../../../src/lib/cloudinary';
import { getCleanAvatarUrl } from '../../../src/utils';
import { useOfflineImage } from '../../../src/hooks/useOfflineImage';
import { UniversalViewer } from '../../../src/components/common/UniversalViewer';

export default function LecturerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lecturers } = useDirectoryStore();
  const [lecturer, setLecturer] = useState<any>(null);
  const [viewerVisible, setViewerVisible] = useState(false);

  useEffect(() => {
    const found = lecturers.find(l => l.id === id);
    if (found) setLecturer(found);
  }, [id, lecturers]);

  if (!lecturer) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const initials = lecturer.full_name
    ?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'LT';

  const qualifications: string[] = Array.isArray(lecturer.qualifications)
    ? lecturer.qualifications
    : typeof lecturer.qualifications === 'string' && lecturer.qualifications
    ? lecturer.qualifications.split('\n').filter(Boolean)
    : [];

  const socialLinks = lecturer.social_links || {};

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Hero Header */}
      <LinearGradient
        colors={['#052e16', '#14532d', '#166534']}
        style={styles.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {/* Decorative circles */}
        <View style={styles.deco1} />
        <View style={styles.deco2} />

        {/* Back button */}
        <SafeAreaView>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
        </SafeAreaView>

        {/* Avatar */}
        <LecturerHeroAvatar
          avatarUrl={lecturer.avatar_url}
          initials={initials}
          title={lecturer.title}
          onPressAvatar={() => setViewerVisible(true)}
        />

        {/* Name & info */}
        <Text style={styles.heroName}>{lecturer.full_name}</Text>
        <Text style={styles.heroPosition}>{lecturer.position || 'Lecturer'}</Text>
        <Text style={styles.heroDept}>DEPT. OF LIBRARY & INFORMATION SCIENCE</Text>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>NALISS UMYU HUB</Text>
        </View>
      </LinearGradient>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {/* Quick info cards */}
        <View style={styles.statsRow}>
          {lecturer.specialization && (
            <View style={styles.statCard}>
              <Ionicons name="flask-outline" size={18} color={COLORS.primary} />
              <Text style={styles.statLabel}>Specialization</Text>
              <Text style={styles.statValue} numberOfLines={2}>{lecturer.specialization}</Text>
            </View>
          )}
          {lecturer.office_hours && (
            <View style={styles.statCard}>
              <Ionicons name="time-outline" size={18} color={COLORS.primary} />
              <Text style={styles.statLabel}>Office Hours</Text>
              <Text style={styles.statValue} numberOfLines={2}>{lecturer.office_hours}</Text>
            </View>
          )}
        </View>

        {/* Contact buttons */}
        <View style={styles.contactRow}>
          {lecturer.email && (
            <TouchableOpacity
              style={styles.contactBtn}
              onPress={() => Linking.openURL(`mailto:${lecturer.email}`)}
            >
              <Ionicons name="mail" size={16} color="#fff" />
              <Text style={styles.contactBtnText}>Email</Text>
            </TouchableOpacity>
          )}
          {lecturer.office_location && (
            <TouchableOpacity
              style={[styles.contactBtn, styles.contactBtnOutline]}
              onPress={() => {}}
            >
              <Ionicons name="location-outline" size={16} color={COLORS.primary} />
              <Text style={[styles.contactBtnText, { color: COLORS.primary }]}>
                {lecturer.office_location}
              </Text>
            </TouchableOpacity>
          )}
          {lecturer.phone && (
            <TouchableOpacity
              style={[styles.contactBtn, styles.contactBtnOutline]}
              onPress={() => Linking.openURL(`tel:${lecturer.phone}`)}
            >
              <Ionicons name="call-outline" size={16} color={COLORS.primary} />
              <Text style={[styles.contactBtnText, { color: COLORS.primary }]}>Call</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Biography */}
        {lecturer.bio ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionAccent} />
              <Text style={styles.sectionTitle}>Biography</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.bioText}>{lecturer.bio}</Text>
            </View>
          </View>
        ) : null}

        {/* Academic Qualifications */}
        {qualifications.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionAccent} />
              <Text style={styles.sectionTitle}>Academic Qualifications</Text>
            </View>
            <View style={styles.card}>
              {qualifications.map((q: string, i: number) => (
                <View key={i} style={styles.qualItem}>
                  <View style={styles.qualIcon}>
                    <Ionicons name="school" size={14} color={COLORS.primary} />
                  </View>
                  <Text style={styles.qualText}>{q}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Contact Info */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionTitle}>Contact Information</Text>
          </View>
          <View style={styles.card}>
            {lecturer.email && (
              <View style={styles.infoRow}>
                <Ionicons name="mail-outline" size={16} color={COLORS.primary} />
                <Text style={styles.infoText}>{lecturer.email}</Text>
              </View>
            )}
            {lecturer.phone && (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={16} color={COLORS.primary} />
                <Text style={styles.infoText}>{lecturer.phone}</Text>
              </View>
            )}
            {lecturer.office_location && (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={COLORS.primary} />
                <Text style={styles.infoText}>{lecturer.office_location}</Text>
              </View>
            )}
            {lecturer.office_hours && (
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={16} color={COLORS.primary} />
                <Text style={styles.infoText}>Office Hours: {lecturer.office_hours}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <UniversalViewer
        isVisible={viewerVisible}
        onClose={() => setViewerVisible(false)}
        fileUri={getCleanAvatarUrl(lecturer.avatar_url) || ''}
        fileType="image"
        fileName={lecturer.full_name}
        showDownload={false}
      />
    </View>
  );
}

function LecturerHeroAvatar({ avatarUrl, initials, title, onPressAvatar }: {
  avatarUrl: string | null;
  initials: string;
  title: string | null;
  onPressAvatar: () => void;
}) {
  const cleanUrl = getCleanAvatarUrl(avatarUrl);
  const optimizedUrl = cleanUrl ? getOptimizedCloudinaryUrl(cleanUrl, 300, 300) : null;
  const cachedUri = useOfflineImage(optimizedUrl);

  return (
    <View style={styles.avatarSection}>
      <TouchableOpacity
        style={styles.avatarRing}
        onPress={onPressAvatar}
        disabled={!cachedUri}
        activeOpacity={0.8}
      >
        {cachedUri ? (
          <Image source={{ uri: cachedUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Title badge */}
      <View style={styles.titleBadge}>
        <Ionicons name="school" size={10} color="#fbbf24" />
        <Text style={styles.titleBadgeText}>
          {(title || 'Lecturer').toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Hero
  hero: {
    paddingBottom: 32,
    paddingHorizontal: 24,
    position: 'relative',
    overflow: 'hidden',
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
  titleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(251,191,36,0.15)',
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    marginTop: 10,
  },
  titleBadgeText: {
    fontSize: 9, fontFamily: 'Inter-Bold',
    color: '#fbbf24', letterSpacing: 1.5,
  },
  heroName: {
    fontSize: 24, fontFamily: 'Inter-Bold',
    color: '#fff', textAlign: 'center', marginBottom: 4,
  },
  heroPosition: {
    fontSize: 14, fontFamily: 'Inter-SemiBold',
    color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginBottom: 4,
  },
  heroDept: {
    fontSize: 10, fontFamily: 'Inter-Bold',
    color: 'rgba(255,255,255,0.5)', textAlign: 'center',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12,
  },
  heroBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroBadgeText: {
    fontSize: 10, fontFamily: 'Inter-Bold',
    color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5,
  },

  // Content
  content: { flex: 1 },
  statsRow: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4,
  },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16,
    padding: 14, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#f1f5f9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  statLabel: { fontSize: 10, fontFamily: 'Inter-Bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#0f172a', textAlign: 'center' },

  // Contact buttons
  contactRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingVertical: 16, flexWrap: 'wrap',
  },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 14, flex: 1, justifyContent: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  contactBtnOutline: {
    backgroundColor: '#f0fdf4', borderWidth: 1.5, borderColor: '#bbf7d0',
    shadowOpacity: 0, elevation: 0,
  },
  contactBtnText: { fontSize: 13, fontFamily: 'Inter-Bold', color: '#fff' },

  // Sections
  section: { paddingHorizontal: 20, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionAccent: { width: 4, height: 20, backgroundColor: COLORS.primary, borderRadius: 2 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter-Bold', color: '#0f172a' },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#f1f5f9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  bioText: { fontSize: 14, fontFamily: 'Inter-Regular', color: '#334155', lineHeight: 22 },

  // Qualifications
  qualItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  qualIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  qualText: { flex: 1, fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#0f172a', lineHeight: 20 },

  // Info rows
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  infoText: { flex: 1, fontSize: 13, fontFamily: 'Inter-Regular', color: '#334155' },
});
