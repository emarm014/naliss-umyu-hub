import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Image, Modal, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { BlurView } from 'expo-blur';
import { useTheme } from '../src/stores/theme.store';
import { useSentryScreen } from '../src/hooks/useSentryScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CachedImage } from '../src/components/common/CachedImage';
import { UniversalViewer } from '../src/components/common/UniversalViewer';
import { useFYBStore, FeaturedStudentEntry } from '../src/stores/fyb.store';
import { realtimeManager } from '../src/lib/realtimeManager';

const ICON_MAP: Record<string, string> = {
  'star': 'star',
  'crown': 'ribbon',
  'trophy': 'trophy',
  'award': 'ribbon',
  'medal': 'medal',
  'sparkles': 'sparkles',
  'heart': 'heart',
  'zap': 'flash',
  'flame': 'flame',
  'shield': 'shield',
  'rocket': 'rocket',
  'diamond': 'diamond',
  'graduation-cap': 'school',
};

export default function FYBScreen() {
  useSentryScreen('FYBScreen');
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  const allEntries = useFYBStore(s => s.entries);
  const isLoading = useFYBStore(s => s.isLoading);
  const fetchFeatured = useFYBStore(s => s.fetchFeatured);
  const markAsRead = useFYBStore(s => s.markAsRead);
  
  const [isRefetching, setIsRefetching] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<FeaturedStudentEntry | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerFile, setViewerFile] = useState({ uri: '', name: '' });

  useEffect(() => {
    markAsRead();
    fetchFeatured(true);

    const unsubscribe = realtimeManager.registerFeaturedListener(() => {
      fetchFeatured(true);
    });
      
    return () => {
      unsubscribe();
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

  const getBadgeMeta = (item: FeaturedStudentEntry) => {
    const accentColor = item.color || (item.type === 'legend_of_the_month' ? '#059669' : item.type === 'event_winner' ? '#10b981' : '#d97706');
    const iconName = ICON_MAP[item.icon || ''] || (item.type === 'legend_of_the_month' ? 'medal' : item.type === 'event_winner' ? 'trophy' : 'star');
    const titleLabel = item.title || 'Featured Student';
    return {
      accentColor,
      gradient: [accentColor, '#022c22'] as [string, string],
      iconName,
      titleLabel,
    };
  };

  const formatEntryDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      return format(new Date(dateStr), 'MMM d, yyyy');
    } catch {
      return '';
    }
  };

  const renderActiveCard = (item: FeaturedStudentEntry) => {
    const badge = getBadgeMeta(item);
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.activeCard, { borderColor }]}
        activeOpacity={0.9}
        onPress={() => setSelectedEntry(item)}
      >
        {item.custom_image_url ? (
          <Image source={{ uri: item.custom_image_url }} style={styles.flyerImage} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[badge.accentColor, '#0f172a']} style={styles.flyerImage}>
            <Ionicons name={badge.iconName as any} size={48} color="rgba(255,255,255,0.3)" />
          </LinearGradient>
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.88)']} style={styles.flyerOverlay}>
          <View style={styles.flyerContent}>
            <View style={styles.activeTopRow}>
              <View style={styles.activeBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeBadgeText}>ACTIVE FEATURE</Text>
              </View>
              <View style={styles.congratsPill}>
                <Ionicons name="heart" size={12} color="#ef4444" />
                <Text style={styles.congratsPillText}>{item.total_congratulations || 0}</Text>
              </View>
            </View>
            <Text style={styles.flyerTitle} numberOfLines={2}>{item.title}</Text>
            <View style={styles.flyerMeta}>
              <CachedImage remoteUrl={item.users?.avatar_url} style={styles.flyerAvatar} entityId={item.user_id} assetType="user" />
              <View style={{ flex: 1 }}>
                <Text style={styles.flyerName} numberOfLines={1}>{item.users?.full_name || 'Featured Student'}</Text>
                {item.subtitle && <Text style={styles.flyerDept} numberOfLines={1}>{item.subtitle}</Text>}
              </View>
            </View>
            {item.description ? (
              <Text style={styles.flyerDesc} numberOfLines={2}>"{item.description}"</Text>
            ) : null}
            <View style={styles.tapHintRow}>
              <Ionicons name="reader-outline" size={13} color="#fbbf24" />
              <Text style={styles.tapHintText}>Tap to open card & read full note</Text>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderHistoryCard = (item: FeaturedStudentEntry) => {
    const badge = getBadgeMeta(item);
    const featuredDate = formatEntryDate(item.published_at || item.created_at);

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.historyCard, { backgroundColor: cardBg, borderColor }]}
        activeOpacity={0.85}
        onPress={() => setSelectedEntry(item)}
      >
        <View style={styles.historyTopRow}>
          <CachedImage
            remoteUrl={item.custom_image_url || item.users?.avatar_url}
            style={styles.historyAvatar}
            entityId={item.user_id}
            assetType="user"
          />
          <View style={styles.historyInfo}>
            <View style={styles.historyBadgeRow}>
              <View style={[styles.historyMiniBadge, { backgroundColor: badge.accentColor + '20' }]}>
                <Ionicons name={badge.iconName as any} size={11} color={badge.accentColor} />
                <Text style={[styles.historyMiniBadgeText, { color: badge.accentColor }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </View>
              {featuredDate ? (
                <Text style={[styles.historyDateText, { color: subtextColor }]}>{featuredDate}</Text>
              ) : null}
            </View>
            <Text style={[styles.historyName, { color: textColor }]} numberOfLines={1}>
              {item.users?.full_name || 'Featured Student'}
            </Text>
            {item.subtitle ? (
              <Text style={[styles.historySubtitle, { color: subtextColor }]} numberOfLines={1}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
          <View style={styles.historyRightCol}>
            <View style={styles.historyHeartBadge}>
              <Ionicons name="heart" size={12} color="#ef4444" />
              <Text style={styles.historyHeartText}>{item.total_congratulations || 0}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={subtextColor} />
          </View>
        </View>

        {item.description ? (
          <View style={[styles.historyNotePreview, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc', borderColor }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={badge.accentColor} style={{ marginTop: 2 }} />
            <Text style={[styles.historyNoteText, { color: textColor }]} numberOfLines={2}>
              "{item.description}"
            </Text>
          </View>
        ) : (
          <View style={styles.historyTapRow}>
            <Ionicons name="document-text-outline" size={13} color={subtextColor} />
            <Text style={[styles.historyTapText, { color: subtextColor }]}>Tap to open featured student card</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderDetailCardModal = () => {
    if (!selectedEntry) return null;
    const badge = getBadgeMeta(selectedEntry);
    const isEntryActive = selectedEntry.is_active && (!selectedEntry.expires_at || new Date(selectedEntry.expires_at) > new Date());
    const bgImage = selectedEntry.custom_image_url || selectedEntry.users?.avatar_url;
    const studentName = selectedEntry.users?.full_name || 'Featured Student';
    const featuredDate = formatEntryDate(selectedEntry.published_at || selectedEntry.created_at);
    const expiryDate = formatEntryDate(selectedEntry.expires_at);

    return (
      <Modal
        transparent
        visible={!!selectedEntry}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSelectedEntry(null)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={isDark ? 65 : 45} style={StyleSheet.absoluteFillObject} tint={isDark ? 'dark' : 'light'} />

          <View style={[styles.cardModalContainer, { backgroundColor: cardBg, borderColor: badge.accentColor + '55' }]}>
            {/* Top Honor Banner */}
            <LinearGradient colors={badge.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.modalTopBanner}>
              <View style={styles.modalBannerLeft}>
                <Ionicons name="sparkles" size={14} color="#FFF" />
                <Text style={styles.modalBannerText} numberOfLines={1}>
                  {badge.titleLabel.toUpperCase()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedEntry(null)}
                style={styles.modalCloseIconBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </LinearGradient>

            {/* Stats & Status Row */}
            <View style={[styles.modalStatsRow, { backgroundColor: isDark ? '#111827' : '#f8fafc', borderBottomColor: borderColor }]}>
              <View style={[styles.modalTypeBadge, { backgroundColor: badge.accentColor }]}>
                <Ionicons name={badge.iconName as any} size={13} color="#FFF" />
                <Text style={styles.modalTypeBadgeText}>
                  {isEntryActive ? '✨ ACTIVE FEATURE' : '🏛️ HALL OF FAME ARCHIVE'}
                </Text>
              </View>

              <View style={styles.modalStatsRight}>
                {featuredDate ? (
                  <View style={styles.modalDateChip}>
                    <Ionicons name="calendar-outline" size={12} color={subtextColor} />
                    <Text style={[styles.modalDateChipText, { color: subtextColor }]}>{featuredDate}</Text>
                  </View>
                ) : null}
                <View style={styles.modalCongratsBadge}>
                  <Ionicons name="heart" size={14} color="#ef4444" />
                  <Text style={styles.modalCongratsText}>{selectedEntry.total_congratulations || 0}</Text>
                </View>
              </View>
            </View>

            {/* Scrollable Card Content so user can scroll down to read the full note/motivation */}
            <ScrollView
              style={styles.modalScrollArea}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={true}
              bounces={true}
            >
              {/* Student Header Photo (Tap photo to expand full image if desired) */}
              <TouchableOpacity
                style={styles.modalImageHeader}
                activeOpacity={0.9}
                onPress={() => {
                  if (bgImage) {
                    setViewerFile({ uri: bgImage, name: `${studentName} — ${selectedEntry.title}` });
                    setViewerVisible(true);
                  }
                }}
              >
                {bgImage ? (
                  <CachedImage
                    remoteUrl={bgImage}
                    style={styles.modalCoverImage as any}
                    resizeMode="cover"
                    entityId={`fyb_modal_${selectedEntry.id}`}
                    assetType="featured_student"
                  />
                ) : (
                  <LinearGradient colors={[badge.accentColor, '#0f172a']} style={styles.modalCoverImage}>
                    <Ionicons name={badge.iconName as any} size={56} color="rgba(255,255,255,0.25)" />
                  </LinearGradient>
                )}

                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.88)']} style={styles.modalImageOverlay}>
                  <View style={styles.modalStudentRow}>
                    <CachedImage
                      remoteUrl={selectedEntry.users?.avatar_url}
                      style={styles.modalStudentAvatar}
                      entityId={selectedEntry.user_id}
                      assetType="user"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalStudentName} numberOfLines={1}>
                        {studentName}
                      </Text>
                      <Text style={styles.modalStudentHandle} numberOfLines={1}>
                        {selectedEntry.users?.username ? `@${selectedEntry.users.username}` : 'NALISS Student'}
                        {selectedEntry.subtitle ? ` • ${selectedEntry.subtitle}` : selectedEntry.users?.level ? ` • ${selectedEntry.users.level} Level` : ''}
                      </Text>
                    </View>
                    {bgImage ? (
                      <View style={styles.expandImagePill}>
                        <Ionicons name="expand-outline" size={14} color="#FFF" />
                        <Text style={styles.expandImageText}>Photo</Text>
                      </View>
                    ) : null}
                  </View>
                </LinearGradient>
              </TouchableOpacity>

              {/* Recognition Title & Headline */}
              <View style={styles.modalBodyPadding}>
                <Text style={[styles.modalMainHeadline, { color: isDark ? '#34d399' : '#059669' }]}>
                  {selectedEntry.title}
                </Text>
                {selectedEntry.subtitle ? (
                  <Text style={[styles.modalSubHeadline, { color: badge.accentColor }]}>
                    {selectedEntry.subtitle}
                  </Text>
                ) : null}

                {/* Student Note / Motivation / Description Section */}
                <View
                  style={[
                    styles.noteSectionCard,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc',
                      borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
                    },
                  ]}
                >
                  <View style={styles.noteSectionHeader}>
                    <View style={[styles.noteIconCircle, { backgroundColor: badge.accentColor + '20' }]}>
                      <Ionicons name="chatbubble-ellipses" size={15} color={badge.accentColor} />
                    </View>
                    <Text style={[styles.noteSectionLabel, { color: badge.accentColor }]}>
                      FEATURED NOTE & MOTIVATION
                    </Text>
                  </View>

                  {selectedEntry.description && selectedEntry.description.trim().length > 0 ? (
                    <Text style={[styles.noteFullText, { color: textColor }]}>
                      "{selectedEntry.description.trim()}"
                    </Text>
                  ) : (
                    <Text style={[styles.noteFallbackText, { color: subtextColor }]}>
                      Recognized for outstanding academic excellence, leadership, and positive contribution in the Department of Library and Information Science (NALISS), UMYU.
                    </Text>
                  )}
                </View>

                {/* Feature Duration / Timeline Info */}
                <View style={[styles.timelineMetaBox, { borderColor }]}>
                  <View style={styles.timelineMetaItem}>
                    <Ionicons name="ribbon-outline" size={16} color={badge.accentColor} />
                    <Text style={[styles.timelineMetaText, { color: subtextColor }]}>
                      Featured on {featuredDate || 'NALISS Hall of Fame'}
                    </Text>
                  </View>
                  {expiryDate ? (
                    <View style={styles.timelineMetaItem}>
                      <Ionicons name="time-outline" size={16} color={subtextColor} />
                      <Text style={[styles.timelineMetaText, { color: subtextColor }]}>
                        {isEntryActive ? `Active until ${expiryDate}` : `Feature period ended ${expiryDate}`}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Optional links: Event Room or Student Profile */}
                <View style={styles.modalActionLinksRow}>
                  {selectedEntry.user_id ? (
                    <TouchableOpacity
                      style={[styles.secondaryActionBtn, { borderColor }]}
                      onPress={() => {
                        const targetUserId = selectedEntry.user_id;
                        setSelectedEntry(null);
                        router.push(`/chat/user_profile?id=${targetUserId}` as any);
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="person-outline" size={16} color={textColor} />
                      <Text style={[styles.secondaryActionText, { color: textColor }]}>View Student Profile</Text>
                    </TouchableOpacity>
                  ) : null}

                  {selectedEntry.type === 'event_winner' && selectedEntry.pool_id ? (
                    <TouchableOpacity
                      style={[styles.secondaryActionBtn, { borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}
                      onPress={() => {
                        const poolId = selectedEntry.pool_id;
                        setSelectedEntry(null);
                        router.push(`/event-pool/${poolId}` as any);
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="trophy-outline" size={16} color="#10b981" />
                      <Text style={[styles.secondaryActionText, { color: '#10b981' }]}>Winning Event Room</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </ScrollView>

            {/* Footer Close Button */}
            <View style={[styles.modalFooter, { borderTopColor: borderColor, backgroundColor: cardBg }]}>
              <TouchableOpacity
                style={[styles.closeCardBtn, { backgroundColor: badge.accentColor }]}
                onPress={() => setSelectedEntry(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.closeCardBtnText}>Done Reading</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
                Tap any previously featured student to open their card and read their note & motivation.
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

      {/* Featured Student Detail Card Modal (Opens on tap instead of raw image) */}
      {renderDetailCardModal()}

      <UniversalViewer
        isVisible={viewerVisible}
        onClose={() => setViewerVisible(false)}
        fileUri={viewerFile.uri}
        fileType="image"
        fileName={viewerFile.name}
        showDownload={false}
        showShare={false}
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
  sectionSubtitle: { fontSize: 13, marginBottom: 16, lineHeight: 18 },

  // Active Card
  activeCard: {
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  flyerImage: {
    width: '100%',
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flyerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  flyerContent: { padding: 16 },
  activeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(217, 119, 6, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf24' },
  activeBadgeText: { color: '#fbbf24', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  congratsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  congratsPillText: { fontSize: 12, fontWeight: '800', color: '#ef4444' },
  flyerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8, lineHeight: 25 },
  flyerMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flyerAvatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#fbbf24' },
  flyerName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  flyerDept: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 1 },
  flyerDesc: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 10, lineHeight: 18, fontStyle: 'italic' },
  tapHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  tapHintText: { color: '#fbbf24', fontSize: 11, fontWeight: '700' },

  // History Card
  historyCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  historyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#e2e8f0',
  },
  historyInfo: { flex: 1, justifyContent: 'center' },
  historyBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  historyMiniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
    maxWidth: '72%',
  },
  historyMiniBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  historyDateText: { fontSize: 11, fontWeight: '500' },
  historyName: { fontSize: 15, fontWeight: '800' },
  historySubtitle: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  historyRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
  },
  historyHeartBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  historyHeartText: { fontSize: 11, fontWeight: '800', color: '#ef4444' },
  historyNotePreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  historyNoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  historyTapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  historyTapText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Detail Card Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 18,
  },
  cardModalContainer: {
    width: '100%',
    maxHeight: '86%',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 20,
  },
  modalTopBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  modalBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  modalCloseIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  modalTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 5,
  },
  modalTypeBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalStatsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  modalDateChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalCongratsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  modalCongratsText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ef4444',
  },
  modalScrollArea: {
    flexGrow: 0,
  },
  modalScrollContent: {
    paddingBottom: 16,
  },
  modalImageHeader: {
    height: 195,
    width: '100%',
    position: 'relative',
    backgroundColor: '#1f2937',
  },
  modalCoverImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 14,
  },
  modalStudentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalStudentAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#fbbf24',
  },
  modalStudentName: {
    color: '#fbbf24',
    fontSize: 18,
    fontWeight: '900',
  },
  modalStudentHandle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  expandImagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  expandImageText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  modalBodyPadding: {
    padding: 16,
  },
  modalMainHeadline: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 24,
  },
  modalSubHeadline: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  noteSectionCard: {
    width: '100%',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
  },
  noteSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  noteIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteSectionLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  noteFullText: {
    fontSize: 14,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  noteFallbackText: {
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  timelineMetaBox: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 6,
  },
  timelineMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineMetaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalActionLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  secondaryActionBtn: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalFooter: {
    padding: 14,
    borderTopWidth: 1,
  },
  closeCardBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCardBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', paddingHorizontal: 20, lineHeight: 20 },
});
