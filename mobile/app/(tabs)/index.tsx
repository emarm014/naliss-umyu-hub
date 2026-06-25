import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity,
  Image, RefreshControl, ActivityIndicator, Dimensions,
  StatusBar, Platform, Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { NetworkStatusDot } from '../_layout';
import { format } from 'date-fns';
import { COLORS } from '../../src/constants/Colors';
import { NalissLogo } from '../../src/components/NalissLogo';
import { useAnnouncementStore, useEventStore, useResourceStore, useAuthStore, useNotificationStore } from '../../src/stores';
import { getOptimizedCloudinaryUrl, uploadLocalFileToCloudinary, uploadToCloudinary } from '../../src/lib/cloudinary';
import { useTheme } from '../../src/stores/theme.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { PosterImage } from '../../src/components/PosterImage';
import { getCleanAvatarUrl } from '../../src/utils';
import * as ImagePicker from 'expo-image-picker';
import { trackFeature, captureUIError } from '../../src/utils/sentry';

import { CachedImage } from '../../src/components/common/CachedImage';

const { width } = Dimensions.get('window');

// ── Per-level theme config ────────────────────────────────────────────────────
const LEVEL_THEMES: Record<string, {
  gradient: [string, string, string];
  accentColor: string;
  accentBg: string;
  title: string;
  subtitle: string;
  icon: string;
  motifColor: string;
  badgeBg: string;
  badgeText: string;
  statusBorderColor: string;
  rankColor: string;
}> = {
  '100': {
    gradient: ['#064e3b', '#065f46', '#059669'],
    accentColor: '#fbbf24',
    accentBg: 'rgba(251,191,36,0.18)',
    title: 'Freshman',
    subtitle: 'Foundation Year',
    icon: 'leaf',
    motifColor: 'rgba(167,243,208,0.12)',
    badgeBg: 'rgba(167,243,208,0.2)',
    badgeText: '#a7f3d0',
    statusBorderColor: '#059669',
    rankColor: '#6ee7b7',
  },
  '200': {
    gradient: ['#14532d', '#166534', '#15803d'],
    accentColor: '#34d399',
    accentBg: 'rgba(52,211,153,0.18)',
    title: 'Sophomore',
    subtitle: 'Core Modules',
    icon: 'trending-up',
    motifColor: 'rgba(134,239,172,0.10)',
    badgeBg: 'rgba(134,239,172,0.2)',
    badgeText: '#86efac',
    statusBorderColor: '#16a34a',
    rankColor: '#4ade80',
  },
  '300': {
    gradient: ['#1e3a5f', '#1B5E20', '#2d6a4f'],
    accentColor: '#a78bfa',
    accentBg: 'rgba(167,139,250,0.18)',
    title: 'Junior',
    subtitle: 'Specialized Tracks',
    icon: 'rocket',
    motifColor: 'rgba(167,139,250,0.10)',
    badgeBg: 'rgba(167,139,250,0.2)',
    badgeText: '#c4b5fd',
    statusBorderColor: '#7c3aed',
    rankColor: '#c4b5fd',
  },
  '400': {
    gradient: ['#1c1917', '#1B5E20', '#78350f'],
    accentColor: '#f59e0b',
    accentBg: 'rgba(245,158,11,0.18)',
    title: 'Senior',
    subtitle: 'Final Year · Legacy',
    icon: 'trophy',
    motifColor: 'rgba(251,191,36,0.10)',
    badgeBg: 'rgba(251,191,36,0.2)',
    badgeText: '#fde68a',
    statusBorderColor: '#d97706',
    rankColor: '#fcd34d',
  },
};

const DEFAULT_THEME = LEVEL_THEMES['100'];

const getUserRank = (points: number) => {
  if (points >= 1000) return { label: 'Legend', icon: 'star' };
  if (points >= 500) return { label: 'Expert', icon: 'flash' };
  if (points >= 100) return { label: 'Senior', icon: 'ribbon' };
  if (points >= 50) return { label: 'Contributor', icon: 'thumbs-up' };
  return { label: 'Novice', icon: 'leaf' };
};

const quickActions = [
  { id: 'notepad', name: 'Notepad', icon: 'document-text', color: '#005A36', bg: '#e6f4ea', route: '/notepad' },
  { id: 'news', name: 'News', icon: 'newspaper', color: '#005A36', bg: '#e6f4ea', route: '/news' },
  { id: 'archive', name: 'ARCHIVE', icon: 'library', color: '#059669', bg: '#ecfdf5', route: '/archive' },
  { id: 'courses', name: 'Courses', icon: 'library', color: '#ea580c', bg: '#fff7ed', route: '/(tabs)/resources?tab=courses' },
  { id: 'event_pool', name: 'Event Pool', icon: 'trophy', color: '#d97706', bg: '#fef3c7', route: '/event-pool' },
  { id: 'directory', name: 'Directory', icon: 'people', color: '#0891b2', bg: '#ecfeff', route: '/(tabs)/resources?tab=directory' },
];

export default function HomeScreen() {
  useSentryScreen('HomeScreen');
  const user = useAuthStore(s => s.profile);
  const lastLocalUpdate = useAuthStore(s => s.lastLocalProfileUpdateAt);
  const confirmedAvatarUrl = useAuthStore(s => s.confirmedAvatarUrl);
  const isAdmin = user?.role === 'super_admin' || (user?.role as any) === 'system_owner';
  const announcements = useAnnouncementStore(s => s.announcements);
  const loadingAnnouncements = useAnnouncementStore(s => s.isLoading);
  const readIds = useAnnouncementStore(s => s.readIds);
  const events = useEventStore(s => s.events);
  const loadingEvents = useEventStore(s => s.isLoading);
  const materials = useResourceStore(s => s.materials);
  const fetchProfile = useAuthStore(s => s.fetchProfile);
  const fetchAnnouncements = useAnnouncementStore(s => s.fetchAnnouncements);
  const fetchUpcomingEvents = useEventStore(s => s.fetchUpcomingEvents);
  const fetchMaterials = useResourceStore(s => s.fetchMaterials);
  const fetchCourses = useResourceStore(s => s.fetchCourses);
  const markAsRead = useAnnouncementStore(s => s.markAsRead);
  const [refreshing, setRefreshing] = React.useState(false);
  const notifications = useNotificationStore(s => s.notifications);
  const unreadCount = notifications.filter(n => !n.isRead).length;
  const { colors, isDark } = useTheme();

  const updateProfile = useAuthStore(s => s.updateProfile);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [tempAvatarUri, setTempAvatarUri] = useState<string | null>(null);
  const [showAvatarConfirm, setShowAvatarConfirm] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const localAvatarUrl = useAuthStore(s => s.localAvatarUrl);

  const handleAvatarPress = () => {
    Alert.alert('Update Profile Picture', 'How would you like to update your avatar?', [
      { text: 'Pick from Gallery', onPress: pickImage },
      { text: 'Generate Random Sticker', onPress: generateSticker },
      { text: 'Cancel', style: 'cancel' }
    ], { cancelable: true });
  };

  const generateSticker = async () => {
    if (!user?.id) return;
    trackFeature('profile', 'generate_sticker_home', { userId: user.id });
    setIsUpdatingAvatar(true);
    try {
      const randomSeed = Math.random().toString(36).substring(7);
      const stickerUrl = `https://api.dicebear.com/9.x/fun-emoji/png?seed=${randomSeed}&size=200`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      let response: Response;
      try {
        response = await fetch(stickerUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === 'AbortError') {
          throw new Error('Request timed out. Please check your connection and try again.');
        }
        throw fetchErr;
      }

      if (!response.ok) throw new Error(`Failed to fetch sticker (${response.status})`);
      const blob = await response.blob();

      const hostedUrl = await uploadToCloudinary(blob, 'avatars');

      await updateProfile({ avatar_url: hostedUrl });

      Alert.alert('Done!', 'Your profile picture has been updated.');
    } catch (err: any) {
      captureUIError('HomeScreen.generateSticker', err, { userId: user?.id });
      const isNetwork = err?.message?.includes('fetch') ||
        err?.message?.includes('network') ||
        err?.message?.includes('timed out') ||
        err?.name === 'AbortError';
      if (isNetwork) {
        Alert.alert('Connection Error', 'Could not generate sticker. Please check your internet connection and try again.');
      } else {
        Alert.alert('Error', err?.message || 'Failed to generate sticker. Please try again.');
      }
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const pickImage = async () => {
    if (!user?.id) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant photo library access to change your avatar.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0].uri) {
      setTempAvatarUri(result.assets[0].uri);
      setShowAvatarConfirm(true);
    }
  };

  const confirmAndUploadAvatar = async () => {
    if (!tempAvatarUri || !user?.id) return;

    const uri = tempAvatarUri;
    const fileName = `${user.id}-avatar-${Date.now()}.jpg`;

    setIsUpdatingAvatar(true);
    setShowAvatarConfirm(false);
    setTempAvatarUri(null);

    try {
      const avatarUrl = await uploadLocalFileToCloudinary(uri, fileName, 'avatars', 'image/jpeg');

      await updateProfile({ avatar_url: avatarUrl });

      Alert.alert('Success', 'Profile photo updated successfully!');
    } catch (err: any) {
      captureUIError('HomeScreen.confirmAndUploadAvatar', err, { userId: user?.id });
      const isNetworkError = err?.message?.includes('fetch') ||
        err?.message?.includes('network') ||
        err?.message?.includes('timed out') ||
        err?.message?.includes('connection') ||
        err?.name === 'AbortError';

      if (isNetworkError) {
        Alert.alert('Slow Connection', 'Your photo was sent but the connection is slow. It may take a moment to appear.');
      } else {
        Alert.alert('Error', `Failed to upload profile photo: ${err?.message || 'Please try again.'}`);
      }
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const theme = LEVEL_THEMES[user?.level || ''] || DEFAULT_THEME;

  const userPoints = React.useMemo(() =>
    materials.reduce((t, m) => t + 10 + (m.download_count || 0), 0),
    [materials]
  );
  const rank = getUserRank(userPoints);

  const loadData = useCallback(async () => {
    const level = user?.level || undefined;
    await Promise.all([
      fetchAnnouncements(level),
      fetchUpcomingEvents(level),
      fetchMaterials({ level }),
      fetchCourses(level),
    ]);
  }, [user?.level, fetchAnnouncements, fetchUpcomingEvents, fetchMaterials, fetchCourses]);

  useEffect(() => {
    fetchProfile();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchProfile(), loadData()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);
  if (!user) return null;

  const displayName = user.username || user.full_name?.split(' ')[0] || 'Student';
  // localAvatarUrl is the local file URI, falling back to confirmedAvatarUrl (the iron-clad source),
  // then user.avatar_url (from DB), then to the DiceBear sticker seed.
  // Never shows blank — always has a valid URI.
  const avatar = getCleanAvatarUrl(localAvatarUrl || confirmedAvatarUrl || user.avatar_url)
    || `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200`;
  // Key includes lastLocalUpdate so RN image cache is busted on every profile update
  const avatarKey = `${avatar}-${lastLocalUpdate || 0}`;
  const matric = user.registration_number || '—';
  const levelNum = user.level || '100';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.card} translucent={false} />
      {/* Top Bar */}
      <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.topBarLeft}>
          <View>
            <NetworkStatusDot />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <NalissLogo size={32} />
              <Text style={[styles.appName, { color: colors.text }]}>NALISS UMYU HUB</Text>
            </View>
          </View>
        </View>
        <View style={styles.topBarRight}>
          <TouchableOpacity style={[styles.iconButton, { backgroundColor: colors.surface }]} onPress={() => router.push('/search')}>
            <Ionicons name="search" size={20} color={colors.text} />
          </TouchableOpacity>
          {unreadCount > 0 && (
            <TouchableOpacity
              style={[styles.iconButton, { backgroundColor: colors.surface }]}
              onPress={async () => {
                useNotificationStore.getState().markAllAsRead();
                await useAnnouncementStore.getState().markAllAsRead(user?.level);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark-done" size={20} color={colors.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.iconButton, { backgroundColor: colors.surface }]} onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications" size={20} color={colors.text} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accentColor} />}
      >
        {/* ── LEVEL-THEMED PROFILE HEADER ─────────────────────────────────── */}
        <LinearGradient
          colors={theme.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHeader}
        >
          {/* Decorative motif circles */}
          <View style={[styles.motif1, { backgroundColor: theme.motifColor }]} />
          <View style={[styles.motif2, { backgroundColor: theme.motifColor }]} />
          <View style={[styles.motif3, { backgroundColor: theme.motifColor }]} />

          {/* Level badge — top right */}
          <View style={[styles.levelBadge, { backgroundColor: theme.badgeBg, borderColor: theme.accentColor + '55' }]}>
            <Ionicons name={theme.icon as any} size={13} color={theme.accentColor} />
            <Text style={[styles.levelBadgeText, { color: theme.badgeText }]}>
              LEVEL {levelNum}
            </Text>
          </View>

          {/* Avatar + identity */}
          <View style={styles.headerBody}>
            <View style={styles.avatarSection}>
              {/* ACTION 1: Tap Avatar to View Privacy Snapshot */}
              <TouchableOpacity
                onPress={() => setShowSnapshot(true)}
                activeOpacity={0.8}
              >
                <View style={[styles.avatarRing, { borderColor: theme.accentColor + '80' }]}>
                  <CachedImage entityId={user?.id || ''} remoteUrl={avatar} assetType="user" style={styles.avatar} />
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.identitySection}>
              {/* Title row */}
              <View style={styles.titleRow}>
                <View style={[styles.titlePill, { backgroundColor: theme.badgeBg }]}>
                  <Text style={[styles.titlePillText, { color: theme.badgeText }]}>
                    {theme.title} · {theme.subtitle}
                  </Text>
                </View>
              </View>

              {/* Name */}
              <Text style={styles.fullName} numberOfLines={1}>{user.full_name}</Text>
              <Text style={[styles.handle, { color: theme.badgeText }]}>@{displayName.toLowerCase()}</Text>

              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={[styles.statPill, { backgroundColor: theme.accentBg }]}>
                  <Ionicons name={rank.icon as any} size={12} color={theme.rankColor} />
                  <Text style={[styles.statPillText, { color: theme.rankColor }]}>{rank.label}</Text>
                </View>
                <View style={[styles.statPill, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                  <Ionicons name="card-outline" size={12} color="rgba(255,255,255,0.7)" />
                  <Text style={[styles.statPillText, { color: 'rgba(255,255,255,0.8)' }]}>{matric}</Text>
                </View>
              </View>

              {/* Department */}
              <View style={styles.deptRow}>
                <Ionicons name="school-outline" size={13} color="rgba(255,255,255,0.5)" />
                <Text style={styles.deptText}>Library & Information Science · UMYU</Text>
              </View>
            </View>
          </View>

          {/* Bottom accent bar */}
          <View style={[styles.accentBar, { backgroundColor: theme.accentColor + '40' }]}>
            <View style={[styles.accentBarFill, { backgroundColor: theme.accentColor, width: `${Math.min((userPoints / 100) * 100, 100)}%` as any }]} />
            <Text style={styles.accentBarLabel}>
              {userPoints} pts · {rank.label}
            </Text>
          </View>
        </LinearGradient>

        <View style={[styles.mainContent, { backgroundColor: colors.background }]}>
          {/* Quick Actions */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
          </View>
          <View style={styles.actionsGrid}>
            {quickActions.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={[styles.actionItem]}
                onPress={() => router.push(action.route as any)}
              >
                <View style={[styles.actionIconBg, { backgroundColor: isDark ? colors.surfaceVariant : action.bg }]}>
                  <Ionicons name={action.icon as any} size={24} color={action.color} />
                </View>
                <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{action.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Announcements */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Announcements</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/announcements')}>
              <Text style={[styles.seeAllText, { color: theme.gradient[2] }]}>See All</Text>
            </TouchableOpacity>
          </View>

          {announcements.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              {loadingAnnouncements
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[styles.emptyText, { color: colors.textMuted }]}>No institutional updates</Text>}
            </View>
          ) : (
            <View style={styles.posterGrid}>
              {announcements.map((item) => {
                const isRead = readIds.includes(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.posterCard}
                    onPress={() => {
                      markAsRead(item.id).catch(() => {});
                      router.push({ pathname: '/announcement/[id]', params: { id: item.id } } as any);
                    }}
                  >
                    <PosterImage
                      uri={item.cover_image_url ? getOptimizedCloudinaryUrl(item.cover_image_url, 600, 400) : undefined}
                      fallbackUri={item.cover_image_url || undefined}
                      style={styles.posterImage}
                      gradientColors={['#0c4a6e', '#1e3a5f']}
                    />
                    <LinearGradient colors={['transparent', 'rgba(12,74,110,0.95)']} style={styles.posterGradient} />
                    <View style={styles.posterContent}>
                      <View style={styles.posterTagRow}>
                        <View style={[styles.posterTag, !isRead && { backgroundColor: theme.gradient[2] }]}>
                          <Text style={styles.posterTagText}>{item.category?.toUpperCase() || 'INFO'}</Text>
                        </View>
                        {!isRead && <View style={[styles.unreadDot, { backgroundColor: theme.accentColor }]} />}
                      </View>
                      <Text style={styles.posterTitle} numberOfLines={2}>{item.title}</Text>
                      <View style={styles.posterFooter}>
                        <Text style={styles.posterDate}>{item.created_at ? (() => { try { return format(new Date(item.created_at), 'MMMM d, yyyy'); } catch { return ''; } })() : ''}</Text>
                        <Text style={styles.posterSeeMore}>See more →</Text>
                      </View>
                    </View>
                    {/* Unread Border Overlay */}
                    <View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFillObject,
                        {
                          borderWidth: 2,
                          borderColor: isRead ? 'transparent' : theme.accentColor,
                          borderRadius: 24,
                          zIndex: 10,
                        }
                      ]}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Events */}
          <View style={[styles.sectionHeader, { marginTop: 24 }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming Events</Text>
          </View>

          {events.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              {loadingEvents
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[styles.emptyText, { color: colors.textMuted }]}>No upcoming events</Text>}
            </View>
          ) : (
            <View style={styles.posterGrid}>
              {events.map((event) => (
                <TouchableOpacity
                  key={event.id}
                  style={styles.posterCard}
                  onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } } as any)}
                >
                  <PosterImage
                    uri={event.cover_image_url ? getOptimizedCloudinaryUrl(event.cover_image_url, 600, 400) : undefined}
                    fallbackUri={event.cover_image_url || undefined}
                    style={styles.posterImage}
                    gradientColors={['#052e16', '#14532d']}
                  />
                  <LinearGradient colors={['transparent', 'rgba(5,46,22,0.95)']} style={styles.posterGradient} />
                  <View style={styles.posterContent}>
                    <View style={styles.posterTagRow}>
                      <View style={styles.posterTag}>
                        <Text style={styles.posterTagText}>{event.status?.toUpperCase() || 'EVENT'}</Text>
                      </View>
                    </View>
                    <Text style={styles.posterTitle} numberOfLines={2}>{event.title}</Text>
                    <View style={styles.posterFooter}>
                      <Text style={styles.posterDate}>
                        {event.start_date ? (() => { try { return format(new Date(event.start_date), 'MMMM d, yyyy'); } catch { return ''; } })() : ''}{event.venue ? ` · ${event.venue}` : ''}
                      </Text>
                      <Text style={styles.posterSeeMore}>See more →</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {isAdmin && (
          <TouchableOpacity style={[styles.adminBanner, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(tabs)/(admin)' as any)}>
            <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
            <Text style={[styles.adminBannerTitle, { color: colors.text }]}>Access Admin Panel</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Avatar Confirmation Modal */}
      <Modal
        visible={showAvatarConfirm}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAvatarConfirm(false)}
      >
        <View style={styles.avatarModalOverlay}>
          <View style={[styles.avatarModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.avatarModalHeader}>
              <Text style={[styles.avatarModalTitle, { color: colors.text }]}>Confirm New Photo</Text>
              <TouchableOpacity onPress={() => setShowAvatarConfirm(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.previewContainer}>
              {tempAvatarUri && (
                <Image source={{ uri: tempAvatarUri }} style={styles.avatarPreview} />
              )}
            </View>

            <Text style={[styles.modalDescription, { color: colors.textMuted }]}>
              This will be visible to everyone in the NALISS community.
            </Text>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelButton, { flex: 1, borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setShowAvatarConfirm(false)}
                disabled={isUpdatingAvatar}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, { flex: 1, marginLeft: 0, marginTop: 0, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }]}
                onPress={confirmAndUploadAvatar}
                disabled={isUpdatingAvatar}
              >
                {isUpdatingAvatar ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={[styles.saveButtonText, { fontSize: 13 }]}>SAVE AND UPLOAD</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Student Privacy Snapshot Modal */}
      <Modal
        visible={showSnapshot}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSnapshot(false)}
      >
        <View style={styles.avatarModalOverlay}>
          <View style={[styles.avatarModalContent, { backgroundColor: colors.card, alignItems: 'center', paddingVertical: 40 }]}>
            <Image 
              source={{ uri: avatar, cache: 'force-cache' }} 
              style={{ width: 160, height: 160, borderRadius: 80, marginBottom: 20, borderWidth: 4, borderColor: theme.accentColor + '50' }} 
            />
            <Text style={[styles.fullName, { color: colors.text, marginBottom: 4, textShadowRadius: 0 }]}>{user.full_name}</Text>
            <Text style={[styles.handle, { color: colors.textMuted, marginBottom: 30 }]}>@{displayName.toLowerCase()}</Text>
            
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 40 }]}
              onPress={() => setShowSnapshot(false)}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 12 : 60,
    paddingBottom: 15, paddingHorizontal: 20,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appName: { fontFamily: 'Inter-Bold', fontSize: 18, color: '#1B5E20', letterSpacing: 0.2 },
  topBarRight: { flexDirection: 'row', gap: 12 },
  iconButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  notifBadge: {
    position: 'absolute', top: -2, right: -2, backgroundColor: '#EF4444',
    borderRadius: 10, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFF', paddingHorizontal: 2,
  },
  notifBadgeText: { color: '#FFF', fontSize: 9, fontFamily: 'Inter-Bold', lineHeight: 11 },
  scrollView: { flex: 1 },

  // ── Profile Header ──────────────────────────────────────────────────────────
  profileHeader: {
    paddingTop: 28, paddingBottom: 0, paddingHorizontal: 22,
    overflow: 'hidden', position: 'relative',
  },
  motif1: {
    position: 'absolute', top: -60, right: -60,
    width: 220, height: 220, borderRadius: 110,
  },
  motif2: {
    position: 'absolute', bottom: 20, left: -80,
    width: 200, height: 200, borderRadius: 100,
  },
  motif3: {
    position: 'absolute', top: 40, right: 80,
    width: 80, height: 80, borderRadius: 40,
  },
  levelBadge: {
    position: 'absolute', top: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  levelBadgeText: { fontFamily: 'Inter-Bold', fontSize: 10, letterSpacing: 1.5 },
  headerBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 18, paddingTop: 8, paddingBottom: 20 },
  avatarSection: { position: 'relative', marginTop: 4 },
  avatarRing: {
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 3, padding: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  avatar: { width: '100%', height: '100%', borderRadius: 45 },
  onlineDot: {
    position: 'absolute', bottom: 4, right: 4,
    width: 18, height: 18, borderRadius: 9, borderWidth: 3,
  },
  identitySection: { flex: 1, paddingTop: 2 },
  titleRow: { marginBottom: 8 },
  titlePill: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10,
  },
  titlePillText: { fontFamily: 'Inter-Bold', fontSize: 10, letterSpacing: 1 },
  fullName: {
    fontFamily: 'Inter-Bold', fontSize: 24, color: '#FFFFFF',
    lineHeight: 30, marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  handle: { fontFamily: 'Inter-Medium', fontSize: 14, marginBottom: 12, opacity: 0.85 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  statPillText: { fontFamily: 'Inter-SemiBold', fontSize: 11 },
  deptRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  deptText: { fontFamily: 'Inter-Regular', fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1 },
  accentBar: {
    height: 36, marginHorizontal: -22, marginTop: 4,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 22, position: 'relative', overflow: 'hidden',
  },
  accentBarFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  accentBarLabel: {
    fontFamily: 'Inter-Bold', fontSize: 11, letterSpacing: 0.8,
    zIndex: 1, textTransform: 'uppercase',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ── Main Content ────────────────────────────────────────────────────────────
  mainContent: { padding: 20 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, marginTop: 8,
  },
  sectionTitle: { fontFamily: 'Inter-Bold', fontSize: 18, color: '#0F172A' },
  seeAllText: { fontFamily: 'Inter-Bold', fontSize: 14 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 24 },
  actionItem: { width: '30%', alignItems: 'center', marginBottom: 20 },
  actionIconBg: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  actionLabel: { fontFamily: 'Inter-Medium', fontSize: 12, color: '#1E293B', textAlign: 'center' },
  emptyCard: {
    padding: 32, alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 16, borderWidth: 1, borderColor: '#F1F5F9', borderStyle: 'dashed',
  },
  emptyText: { fontFamily: 'Inter-Medium', fontSize: 14, color: '#94A3B8' },
  posterGrid: { gap: 14, paddingHorizontal: 4, paddingBottom: 4 },
  posterCard: {
    width: '100%', height: 200,
    borderRadius: 24, overflow: 'hidden', backgroundColor: '#FFF',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 10,
  },
  posterImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  posterGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 },
  posterContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    padding: 20,
  },
  posterTagRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  posterTag: {
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  posterTagText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#FFF' },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  posterTitle: {
    fontFamily: 'Inter-Bold', fontSize: 20, color: '#FFF', marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  posterDate: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  posterFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  posterSeeMore: { fontFamily: 'Inter-Bold', fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  eventCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#F1F5F9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
    gap: 14,
  },
  eventIconBg: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  eventInfo: { flex: 1 },
  eventMeta: { fontFamily: 'Inter-Medium', fontSize: 11, color: '#64748B', marginBottom: 3 },
  eventTitle: { fontFamily: 'Inter-Bold', fontSize: 15, color: '#0F172A', marginBottom: 3 },
  eventSnippet: { fontFamily: 'Inter-Regular', fontSize: 12, color: '#475569', lineHeight: 17 },
  adminBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9',
    padding: 16, marginHorizontal: 20, borderRadius: 16, marginBottom: 8, gap: 12,
  },
  adminBannerTitle: { flex: 1, fontFamily: 'Inter-Bold', fontSize: 14, color: '#064E3B' },
  avatarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  avatarModalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  avatarModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarModalTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
  },
  previewContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  avatarPreview: {
    width: 200,
    height: 200,
    borderRadius: 24,
    backgroundColor: '#f1f5f9',
  },
  modalDescription: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginVertical: 15,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: '#FFF',
  },
});
