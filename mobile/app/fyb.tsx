import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Image, Dimensions, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../src/api/supabase/client';
import { useTheme } from '../src/stores/theme.store';
import { useSentryScreen } from '../src/hooks/useSentryScreen';
import { useQuery } from '@tanstack/react-query';
import { mmkvStorage } from '../src/stores/mmkv.storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CachedImage } from '../src/components/common/CachedImage';
import { UniversalViewer } from '../src/components/common/UniversalViewer';
import { useFYBStore } from '../src/stores/fyb.store';

type FeaturedStudentEntry = any;

export default function FYBScreen() {
  useSentryScreen('FYBScreen');
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const allEntries = useFYBStore(s => s.entries);
  const isLoading = useFYBStore(s => s.isLoading);
  const fetchFeatured = useFYBStore(s => s.fetchFeatured);
  
  const [isRefetching, setIsRefetching] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerFile, setViewerFile] = useState({ uri: '', name: '' });

  const markAsRead = useFYBStore(s => s.markAsRead);

  useEffect(() => {
    markAsRead();
    fetchFeatured();

    const channel = supabase
      .channel(`fyb_tab_listener_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'featured_students' },
        () => {
          fetchFeatured(true);
        }
      )
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
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

  const renderActiveCard = (item: FeaturedStudentEntry) => {
    const mediaUri = item.custom_image_url || item.users?.avatar_url || `https://api.dicebear.com/9.x/fun-emoji/png?seed=${encodeURIComponent(item.users?.full_name || 'student')}&size=200`;
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.activeCard, { borderColor }]}
        activeOpacity={0.9}
        onPress={() => {
          setViewerFile({ uri: mediaUri, name: item.title });
          setViewerVisible(true);
        }}
      >
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
              <CachedImage remoteUrl={item.users.avatar_url} style={styles.flyerAvatar} entityId={item.user_id} assetType="user" />
              <View style={{ flex: 1 }}>
                <Text style={styles.flyerName} numberOfLines={1}>{item.users?.full_name}</Text>
                {item.subtitle && <Text style={styles.flyerDept} numberOfLines={1}>{item.subtitle}</Text>}
              </View>
            </View>
            {item.description && <Text style={styles.flyerDesc} numberOfLines={3}>{item.description}</Text>}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderHistoryCard = (item: FeaturedStudentEntry) => {
    const avatarUri = item.users?.avatar_url || `https://api.dicebear.com/9.x/fun-emoji/png?seed=${encodeURIComponent(item.users?.full_name || 'student')}&size=200`;
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.historyCard, { backgroundColor: cardBg, borderColor }]}
        activeOpacity={0.8}
        onPress={() => {
          setViewerFile({ uri: item.custom_image_url || avatarUri, name: item.title });
          setViewerVisible(true);
        }}
      >
        <CachedImage remoteUrl={item.users.avatar_url} style={styles.historyAvatar} entityId={item.user_id} assetType="user" />
        <View style={styles.historyInfo}>
          <Text style={[styles.historyTitle, { color: textColor }]} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.historyName, { color: subtextColor }]} numberOfLines={1}>{item.users?.full_name}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={subtextColor} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: cardBg, borderBottomColor: borderColor, paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>Featured Students</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && allEntries.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#ea580c" />
        </View>
      ) : (
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
          {allEntries.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="star-outline" size={64} color={subtextColor} style={{ opacity: 0.4 }} />
              <Text style={[styles.emptyTitle, { color: textColor }]}>No Featured Students Yet</Text>
              <Text style={[styles.emptySubtitle, { color: subtextColor }]}>
                Check back later — featured students will appear here when announced.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <UniversalViewer
        isVisible={viewerVisible}
        onClose={() => setViewerVisible(false)}
        fileUri={viewerFile.uri}
        fileType="image"
        fileName={viewerFile.name}
        showDownload={true}
        showShare={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start', marginLeft: -8 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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

  flyerDept: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  flyerDesc: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 12, lineHeight: 18 },

  // History Card
  historyCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e2e8f0',
  },
  historyInfo: { flex: 1, justifyContent: 'center' },
  historyTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  historyName: { fontSize: 12 },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', paddingHorizontal: 20, lineHeight: 20 },
});
