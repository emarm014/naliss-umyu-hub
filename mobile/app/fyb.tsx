import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, SafeAreaView, Image, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../src/api/supabase/client';
import { useTheme } from '../src/stores/theme.store';
import { useSentryScreen } from '../src/hooks/useSentryScreen';
import { useQuery } from '@tanstack/react-query';
import { mmkvStorage } from '../src/stores/mmkv.storage';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');
const CACHE_KEY = 'fyb_featured_students_cache';

type FeaturedStudentEntry = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  custom_image_url: string | null;
  is_active: boolean;
  published_at: string;
  expires_at: string | null;
  total_congratulations: number;
  created_at: string;
  users: {
    full_name: string;
    username: string;
    avatar_url: string | null;
  };
};

import { useFYBStore } from '../src/stores/fyb.store';

export default function FYBScreen() {
  useSentryScreen('FYBScreen');
  const { colors, isDark } = useTheme();
  
  const allEntries = useFYBStore(s => s.entries);
  const isLoading = useFYBStore(s => s.isLoading);
  const fetchFeatured = useFYBStore(s => s.fetchFeatured);
  
  const [isRefetching, setIsRefetching] = useState(false);

  const markAsRead = useFYBStore(s => s.markAsRead);

  useEffect(() => {
    markAsRead();
    fetchFeatured();
  }, [fetchFeatured, markAsRead]);

  const refetch = async () => {
    setIsRefetching(true);
    await fetchFeatured(true);
    setIsRefetching(false);
  };

  const now = new Date();

  const activeEntries = useMemo(() => 
    allEntries.filter(e => e.is_active && (!e.expires_at || new Date(e.expires_at) > now)),
    [allEntries]
  );

  const pastEntries = useMemo(() => 
    allEntries.filter(e => !e.is_active || (e.expires_at && new Date(e.expires_at) <= now)),
    [allEntries]
  );

  const cardBg = colors.card;
  const textColor = colors.text;
  const subtextColor = colors.textMuted;
  const borderColor = colors.border;

  const renderActiveCard = (item: FeaturedStudentEntry) => (
    <View key={item.id} style={[styles.activeCard, { borderColor }]}>
      {item.custom_image_url ? (
        <Image source={{ uri: item.custom_image_url }} style={styles.flyerImage} resizeMode="cover" />
      ) : (
        <LinearGradient colors={['#d97706', '#ea580c']} style={styles.flyerImage}>
          <Ionicons name="star" size={48} color="rgba(255,255,255,0.3)" />
        </LinearGradient>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.flyerOverlay}>
        <View style={styles.flyerContent}>
          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.activeBadgeText}>ACTIVE</Text>
          </View>
          <Text style={styles.flyerTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.flyerMeta}>
            {item.users?.avatar_url ? (
              <Image source={{ uri: item.users.avatar_url }} style={styles.flyerAvatar} />
            ) : (
              <View style={[styles.flyerAvatar, { backgroundColor: '#d97706', justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                  {item.users?.full_name?.[0] || '?'}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.flyerName} numberOfLines={1}>{item.users?.full_name}</Text>
              <Text style={styles.flyerHandle}>@{item.users?.username}</Text>
            </View>
            <View style={styles.congratsCount}>
              <Ionicons name="heart" size={14} color="#ef4444" />
              <Text style={styles.congratsText}>{item.total_congratulations}</Text>
            </View>
          </View>
          {item.subtitle && (
            <Text style={styles.flyerSubtitle} numberOfLines={1}>{item.subtitle}</Text>
          )}
        </View>
      </LinearGradient>
    </View>
  );

  const renderHistoryCard = (item: FeaturedStudentEntry) => (
    <View key={item.id} style={[styles.historyCard, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.historyRow}>
        {item.custom_image_url ? (
          <Image source={{ uri: item.custom_image_url }} style={styles.historyThumb} resizeMode="cover" />
        ) : (
          <LinearGradient colors={['#9ca3af', '#6b7280']} style={styles.historyThumb}>
            <Ionicons name="star" size={20} color="rgba(255,255,255,0.5)" />
          </LinearGradient>
        )}
        <View style={styles.historyInfo}>
          <Text style={[styles.historyTitle, { color: textColor }]} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.historyName, { color: subtextColor }]} numberOfLines={1}>
            {item.users?.full_name} · @{item.users?.username}
          </Text>
          <View style={styles.historyBottom}>
            <Text style={[styles.historyDate, { color: subtextColor }]}>
              {new Date(item.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            <View style={styles.historyHearts}>
              <Ionicons name="heart" size={12} color="#ef4444" />
              <Text style={[styles.historyHeartsText, { color: subtextColor }]}>{item.total_congratulations}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: borderColor }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>Featured Students</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={textColor} />}
      >
        {/* Active Section */}
        {activeEntries.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="star" size={18} color="#d97706" />
              <Text style={[styles.sectionTitle, { color: textColor }]}>Currently Featured</Text>
            </View>
            {activeEntries.map(renderActiveCard)}
          </View>
        )}

        {/* History Section */}
        {pastEntries.length > 0 && (
          <View style={[styles.section, { marginTop: activeEntries.length > 0 ? 28 : 0 }]}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="time" size={18} color={subtextColor} />
              <Text style={[styles.sectionTitle, { color: textColor }]}>History</Text>
            </View>
            <Text style={[styles.sectionSubtitle, { color: subtextColor }]}>
              Previously featured students and their achievements.
            </Text>
            {pastEntries.map(renderHistoryCard)}
          </View>
        )}

        {/* Empty State */}
        {!isLoading && allEntries.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="star-outline" size={64} color={subtextColor} style={{ opacity: 0.4 }} />
            <Text style={[styles.emptyTitle, { color: textColor }]}>No Featured Students Yet</Text>
            <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
              Check back later — featured students will appear here when announced.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  sectionSubtitle: { fontSize: 13, marginBottom: 16 },

  // Active Card
  activeCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  flyerImage: {
    width: '100%',
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flyerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  flyerContent: { padding: 16 },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(217, 119, 6, 0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 8,
    gap: 6,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf24' },
  activeBadgeText: { color: '#fbbf24', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  flyerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10, lineHeight: 26 },
  flyerMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flyerAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  flyerName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  flyerHandle: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  congratsCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  congratsText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  flyerSubtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8 },

  // History Card
  historyCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  historyRow: { flexDirection: 'row', gap: 12 },
  historyThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  historyInfo: { flex: 1, justifyContent: 'center' },
  historyTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  historyName: { fontSize: 12, marginBottom: 4 },
  historyBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyDate: { fontSize: 11 },
  historyHearts: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  historyHeartsText: { fontSize: 11, fontWeight: '600' },

  // Empty State
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', marginTop: 6, paddingHorizontal: 40 },
});
