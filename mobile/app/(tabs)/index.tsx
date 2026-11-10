import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity,
  Image, RefreshControl, ActivityIndicator, Dimensions,
  StatusBar, Platform, Alert,
} from 'react-native';
import { SafeModal } from '../../src/components/common/overlays';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { UniversalViewer } from '../../src/components/common/UniversalViewer';
import { router } from 'expo-router';
import { NetworkStatusDot } from '../_layout';
import { useNetworkStore, registerOnlineCallback } from '../../src/stores/network.store';
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
import * as FileSystem from 'expo-file-system/legacy';
import { trackFeature, captureUIError } from '../../src/utils/sentry';
import { isBefore } from 'date-fns';
import { useEventPoolStore } from '../../src/stores/event-pool.store';

import { CachedImage } from '../../src/components/common/CachedImage';
import { FeaturedStudentCongratsCard } from '../../src/components/FeaturedStudentCongratsCard';
import { FeaturedStudentCard } from '../../src/components/FeaturedStudentCard';

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

import { useNewsStore } from '../../src/stores/news.store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mmkvStorage } from '../../src/stores/mmkv.storage';
import { supabase } from '../../src/api/supabase/client';
import { realtimeManager } from '../../src/lib/realtimeManager';
import { normalizeError } from '../../src/utils/sentry';

const quickActions = [
  { id: 'notepad', name: 'Notepad', icon: 'document-text', lightColor: '#059669', darkColor: '#34d399', lightBg: '#ecfdf5', darkBg: 'rgba(52, 211, 153, 0.15)', route: '/notepad' },
  { id: 'news', name: 'News', icon: 'newspaper', lightColor: '#0284c7', darkColor: '#34d399', lightBg: '#f0f9ff', darkBg: 'rgba(52, 211, 153, 0.15)', route: '/news' },
  { id: 'archive', name: 'Archive', icon: 'library', lightColor: '#059669', darkColor: '#34d399', lightBg: '#ecfdf5', darkBg: 'rgba(52, 211, 153, 0.15)', route: '/archive' },
  { id: 'fyb', name: 'FYB', icon: 'star', lightColor: '#d97706', darkColor: '#34d399', lightBg: '#fffbeb', darkBg: 'rgba(52, 211, 153, 0.15)', route: '/fyb' },
  { id: 'event_pool', name: 'Event Pool', icon: 'trophy', lightColor: '#d97706', darkColor: '#34d399', lightBg: '#fffbeb', darkBg: 'rgba(52, 211, 153, 0.15)', route: '/event-pool' },
  { id: 'gallery', name: 'Gallery', icon: 'images', lightColor: '#8b5cf6', darkColor: '#34d399', lightBg: '#faf5ff', darkBg: 'rgba(52, 211, 153, 0.15)', route: '/gallery' },
];

export default function HomeScreen() {
  useSentryScreen('HomeScreen');
  const queryClient = useQueryClient();
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
  const fetchNewsUnreadCount = useNewsStore(s => s.fetchUnreadCount);
  const newsUnreadCount = useNewsStore(s => s.unreadCount);
  const fetchArchiveUnreadCount = require('../../src/stores/archive.store').useArchiveStore((s: any) => s.fetchUnreadCount);
  const archiveUnreadCount = require('../../src/stores/archive.store').useArchiveStore((s: any) => s.unreadCount);
  const fetchFYBUnreadCount = require('../../src/stores/fyb.store').useFYBStore((s: any) => s.fetchUnreadCount);
  const fybUnreadCount = require('../../src/stores/fyb.store').useFYBStore((s: any) => s.unreadCount);
  const fetchPools = useEventPoolStore(s => s.fetchPools);
  const pools = useEventPoolStore(s => s.pools);
  const serverTimeOffset = useEventPoolStore(s => s.serverTimeOffset);
  const [tick, setTick] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const notifications = useNotificationStore(s => s.notifications);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  // ─── Pinned Featured Students (FYB) ───────────────────────
  const FYB_CACHE_KEY = 'home_pinned_fyb_cache';
  const { data: pinnedFeatured = [] } = useQuery({
    queryKey: ['home_pinned_fyb'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('featured_students')
        .select(`
          id, title, subtitle, custom_image_url, published_at, expires_at,
          users!featured_students_user_id_fkey ( full_name, username, avatar_url )
        `)
        .eq('is_active', true)
        .neq('type', 'event_winner')
        .order('published_at', { ascending: false });
      if (error) throw normalizeError(error);
      const result = data || [];
      try {
        await mmkvStorage.setItem(FYB_CACHE_KEY, JSON.stringify(result));
      } catch { }
      return result;
    },
    initialData: () => {
      try {
        const cached = require('../../src/stores/mmkv.storage').getSyncItem(FYB_CACHE_KEY);
        if (cached) return JSON.parse(cached);
      } catch { }
      return undefined;
    },
    staleTime: 5 * 60 * 1000,
  });

  const activePinnedFeatured = React.useMemo(() => {
    const now = new Date();
    return (pinnedFeatured as any[]).filter((f: any) => !f.expires_at || new Date(f.expires_at) > now);
  }, [pinnedFeatured]);
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useNetworkStore(s => s.isOnline);

  const updateProfile = useAuthStore(s => s.updateProfile);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [tempAvatarUri, setTempAvatarUri] = useState<string | null>(null);
  const [showAvatarConfirm, setShowAvatarConfirm] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ uri: string, remoteUrl?: string, type: 'image', name: string } | null>(null);

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

      // Download the sticker to a local temp file first — React Native's blob API
      // is unreliable and causes "network error" when passed to FormData.
      // Using FileSystem.downloadAsync is the proven, working pattern.
      const tempPath = `${FileSystem.cacheDirectory}sticker-${Date.now()}.png`;
      const downloadResult = await FileSystem.downloadAsync(stickerUrl, tempPath);

      if (downloadResult.status !== 200) {
        throw new Error(`Failed to download sticker (HTTP ${downloadResult.status})`);
      }

      // Verify the file was actually saved
      const fileInfo = await FileSystem.getInfoAsync(downloadResult.uri);
      if (!fileInfo.exists) {
        throw new Error('Downloaded sticker file not found on disk.');
      }

      // Upload to Cloudinary using the reliable local-file method
      const fileName = `${user.id}-sticker-${Date.now()}.png`;
      const hostedUrl = await uploadLocalFileToCloudinary(downloadResult.uri, fileName, 'avatars', 'image/png');

      await updateProfile({ avatar_url: hostedUrl });

      // Clean up temp file (fire-and-forget)
      FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => { });

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
      mediaTypes: ['images'],
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

  const normalizedLevel = String(user?.level || '100').replace(/[^0-9]/g, '') || '100';
  const baseTheme = LEVEL_THEMES[normalizedLevel] || DEFAULT_THEME;
  const theme = React.useMemo(() => {
    if (!isDark) return baseTheme;

    // Premium dark mode adaptations matching the new announcement cards
    const emeraldAccent = '#34d399';
    return {
      ...baseTheme,
      // Deep slate gradient to match the card background
      gradient: ['#1e293b', '#0f172a', '#020617'] as [string, string, string],
      // Override level-specific colors with the emerald accent in dark mode for consistency
      accentColor: emeraldAccent,
      motifColor: 'rgba(52, 211, 153, 0.05)', // Very subtle motif
      badgeBg: 'rgba(52, 211, 153, 0.15)',
      badgeText: emeraldAccent,
      rankColor: emeraldAccent,
      accentBg: 'rgba(52, 211, 153, 0.15)',
      statusBorderColor: emeraldAccent,
    };
  }, [baseTheme, isDark]);

  const userPoints = React.useMemo(() =>
    materials
      .filter(m => m.uploaded_by === user?.id)
      .reduce((t, m) => t + 10 + (m.download_count || 0), 0),
    [materials, user?.id]
  );
  const rank = getUserRank(userPoints);

  const combinedItems = React.useMemo(() => {
    const ann = announcements.map(a => ({
      ...a,
      _type: 'announcement' as const,
      _sortDate: new Date(a.published_at || a.created_at).getTime()
    }));
    const evt = events.map(e => ({
      ...e,
      _type: 'event' as const,
      _sortDate: new Date(e.start_date || e.created_at).getTime()
    }));
    return [...ann, ...evt].sort((a, b) => b._sortDate - a._sortDate);
  }, [announcements, events]);

  const loadData = useCallback(async (force = true) => {
    const level = user?.level || undefined;
    await Promise.all([
      fetchAnnouncements(level, force),
      fetchUpcomingEvents(level, force),
      fetchMaterials({ level }, force),
      fetchCourses(level, force),
      fetchNewsUnreadCount(),
      fetchArchiveUnreadCount(),
      fetchFYBUnreadCount(),
      fetchPools(force),
    ]);
  }, [user?.level, fetchAnnouncements, fetchUpcomingEvents, fetchMaterials, fetchCourses, fetchNewsUnreadCount, fetchArchiveUnreadCount, fetchFYBUnreadCount, fetchPools]);

  useEffect(() => {
    fetchProfile();
    loadData();

    const interval = setInterval(() => setTick(t => t + 1), 10000); // 10s tick for badges

    if (user?.id) {
      realtimeManager.init(user.id);
    }

    const unsubFeatured = realtimeManager.registerFeaturedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['home_pinned_fyb'] });
    });

    const unsubPool = realtimeManager.registerPoolListener(() => {
      fetchUpcomingEvents(user?.level || undefined, true);
    });

    const unregisterOnline = registerOnlineCallback(() => {
      // Background auto-refresh when network comes back online
      fetchProfile();
      loadData();
    });

    return () => {
      unsubFeatured();
      unsubPool();
      unregisterOnline();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, user?.id, user?.level]);

  const eventPoolBadge = React.useMemo(() => {
    const now = new Date(Date.now() + serverTimeOffset);
    let hasScheduled = false;
    for (const p of pools) {
      if (p.status === 'scheduled' || p.status === 'live') {
        const start = new Date(p.start_time);
        const end = p.end_time ? new Date(p.end_time) : null;
        if (isBefore(now, start)) {
          hasScheduled = true;
        } else if (!end || isBefore(now, end)) {
          return 'LIVE';
        }
      }
    }
    return hasScheduled ? 'SOON' : null;
  }, [pools, serverTimeOffset, tick]);

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
  const levelNum = normalizedLevel;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.card} translucent={false} />
      {/* Top Bar */}
      <View style={[styles.topBar, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
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
        {/* ── LEVEL-THEMED PROFILE HEADER (PER-LEVEL DESIGN) ──────────────── */}
        {levelNum === '300' ? (
          <LinearGradient
            colors={theme.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.level300Card}
          >
            <View style={[styles.motif1, { backgroundColor: theme.motifColor }]} />
            <View style={[styles.motif2, { backgroundColor: theme.motifColor }]} />

            {/* 1. Top Row: Status Pill (Left) + Level Badge (Right) — Zero Overlap */}
            <View style={styles.level300TopRow}>
              <View style={[styles.level300StatusPill, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.16)' }]}>
                <View style={[styles.level300StatusDot, { backgroundColor: theme.accentColor }]} />
                <Text style={styles.level300StatusText}>
                  {theme.title} · {theme.subtitle}
                </Text>
              </View>
              <View style={[styles.level300Badge, { backgroundColor: theme.badgeBg, borderColor: theme.accentColor + '66' }]}>
                <Ionicons name={theme.icon as any} size={13} color={theme.accentColor} />
                <Text style={[styles.level300BadgeText, { color: theme.badgeText }]}>
                  LEVEL {levelNum}
                </Text>
              </View>
            </View>

            {/* 2. Middle Identity Row: Circular Avatar (No Dot) + Name/Handle/Points */}
            <View style={styles.level300IdentityRow}>
              <TouchableOpacity
                onPress={() => {
                  if (avatar) {
                    const remoteAvatar = confirmedAvatarUrl
                      || user.avatar_url
                      || (user.id ? `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200` : undefined);
                    setViewerFile({
                      uri: avatar,
                      remoteUrl: remoteAvatar,
                      type: 'image',
                      name: `${user.full_name || 'Profile'}'s Avatar`,
                    });
                    setViewerVisible(true);
                  }
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.level300AvatarRing, { borderColor: theme.accentColor + '90' }]}>
                  <CachedImage entityId={user?.id || ''} remoteUrl={confirmedAvatarUrl || user.avatar_url || avatar} assetType="user" style={styles.avatar} />
                </View>
              </TouchableOpacity>

              <View style={styles.level300IdentityInfo}>
                <Text style={styles.level300FullName} numberOfLines={1}>{user.full_name}</Text>
                <Text style={[styles.level300Handle, { color: theme.badgeText }]}>@{displayName.toLowerCase()}</Text>
                <View style={[styles.level300PtsPill, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.15)' }]}>
                  <Ionicons name="flash" size={12} color={theme.accentColor} />
                  <Text style={styles.level300PtsText}>{userPoints} PTS · {rank.label.toUpperCase()}</Text>
                </View>
              </View>
            </View>

            {/* 3. Full Italic Department Line (No "Department" Title, Unclipped) */}
            <Text style={styles.level300DeptItalic} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              Library & Information Science · UMYU
            </Text>

            {/* 4. Bottom 2-Column Strip: REGISTRATION NUMBER + RANK */}
            <View style={styles.level300BottomStrip}>
              <View style={styles.level300RegCol}>
                <View style={styles.level300MicroLabelRow}>
                  <Ionicons name="card-outline" size={11} color="rgba(255,255,255,0.65)" />
                  <Text style={styles.level300MicroLabel}>REGISTRATION NUMBER</Text>
                </View>
                <Text style={styles.level300RegValue} numberOfLines={1}>{matric}</Text>
              </View>

              <View style={styles.level300StripDivider} />

              <View style={styles.level300RankCol}>
                <Text style={styles.level300MicroLabel}>RANK</Text>
                <View style={styles.level300RankValueRow}>
                  <Ionicons name={rank.icon as any} size={13} color={theme.rankColor} />
                  <Text style={[styles.level300RankValue, { color: theme.rankColor }]}>{rank.label}</Text>
                </View>
              </View>
            </View>
          </LinearGradient>
        ) : levelNum === '200' ? (
          <LinearGradient
            colors={theme.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.level200Card}
          >
            <View style={[styles.motif1, { backgroundColor: theme.motifColor }]} />
            <View style={[styles.motif2, { backgroundColor: theme.motifColor }]} />

            <View style={styles.level200SplitRow}>
              {/* Left Column: Avatar (No Dot) + @handle + LEVEL 200 Badge */}
              <View style={styles.level200LeftCol}>
                <TouchableOpacity
                  onPress={() => {
                    if (avatar) {
                      const remoteAvatar = confirmedAvatarUrl
                        || user.avatar_url
                        || (user.id ? `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200` : undefined);
                      setViewerFile({
                        uri: avatar,
                        remoteUrl: remoteAvatar,
                        type: 'image',
                        name: `${user.full_name || 'Profile'}'s Avatar`,
                      });
                      setViewerVisible(true);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.level200AvatarRing, { borderColor: theme.accentColor + '90' }]}>
                    <CachedImage entityId={user?.id || ''} remoteUrl={confirmedAvatarUrl || user.avatar_url || avatar} assetType="user" style={styles.avatar} />
                  </View>
                </TouchableOpacity>

                <Text style={[styles.level200Handle, { color: theme.badgeText }]} numberOfLines={1}>
                  @{displayName.toLowerCase()}
                </Text>

                <View style={[styles.level200BadgeBox, { backgroundColor: 'rgba(0,0,0,0.22)', borderColor: theme.accentColor + '44' }]}>
                  <Ionicons name={theme.icon as any} size={13} color={theme.accentColor} />
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[styles.level200BadgeLabel, { color: theme.badgeText }]}>LEVEL</Text>
                    <Text style={[styles.level200BadgeNum, { color: '#FFFFFF' }]}>{levelNum}</Text>
                  </View>
                </View>
              </View>

              {/* Vertical Dashed Pass Perforation Line */}
              <View style={styles.level200PerforationCol}>
                {Array.from({ length: 14 }).map((_, idx) => (
                  <View key={idx} style={styles.level200DashSegment} />
                ))}
              </View>

              {/* Right Column: Status + Name + Italic Dept + Reg Box + Points/Rank */}
              <View style={styles.level200RightCol}>
                <Text style={[styles.level200StatusUpper, { color: theme.badgeText }]}>
                  {theme.title.toUpperCase()} · {theme.subtitle.toUpperCase()}
                </Text>

                <Text style={styles.level200FullName} numberOfLines={1}>
                  {user.full_name}
                </Text>

                <Text style={styles.level200DeptItalic} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                  Library & Information Science · UMYU
                </Text>

                <View style={[styles.level200RegBox, { backgroundColor: 'rgba(0,0,0,0.22)', borderColor: 'rgba(255,255,255,0.14)' }]}>
                  <Text style={styles.level200RegMicroLabel}>REGISTRATION NUMBER</Text>
                  <Text style={[styles.level200RegValue, { color: isDark ? theme.accentColor : '#FFFFFF' }]} numberOfLines={1}>
                    {matric}
                  </Text>
                </View>

                <View style={styles.level200FooterRow}>
                  <Text style={styles.level200PtsRankText}>
                    {userPoints} PTS · {rank.label}
                  </Text>
                  <Ionicons name="checkmark-done-circle-outline" size={16} color={theme.accentColor} />
                </View>
              </View>
            </View>
          </LinearGradient>
        ) : levelNum === '100' ? (
          <LinearGradient
            colors={theme.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.level100Card}
          >
            <View style={[styles.motif1, { backgroundColor: theme.motifColor }]} />
            <View style={[styles.motif2, { backgroundColor: theme.motifColor }]} />

            {/* 1. Top Row: Avatar (No Dot) + Name/Handle on Left, LEVEL 100 Badge on Right */}
            <View style={styles.level100TopRow}>
              <View style={styles.level100TopLeft}>
                <TouchableOpacity
                  onPress={() => {
                    if (avatar) {
                      const remoteAvatar = confirmedAvatarUrl
                        || user.avatar_url
                        || (user.id ? `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200` : undefined);
                      setViewerFile({
                        uri: avatar,
                        remoteUrl: remoteAvatar,
                        type: 'image',
                        name: `${user.full_name || 'Profile'}'s Avatar`,
                      });
                      setViewerVisible(true);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.level100AvatarRing, { borderColor: theme.accentColor + '90' }]}>
                    <CachedImage entityId={user?.id || ''} remoteUrl={confirmedAvatarUrl || user.avatar_url || avatar} assetType="user" style={styles.avatar} />
                  </View>
                </TouchableOpacity>

                <View style={styles.level100NameStack}>
                  <Text style={styles.level100FullName} numberOfLines={1}>{user.full_name}</Text>
                  <Text style={[styles.level100Handle, { color: theme.badgeText }]} numberOfLines={1}>
                    @{displayName.toLowerCase()}
                  </Text>
                </View>
              </View>

              <View style={[styles.level100BadgePill, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.22)' }]}>
                <Ionicons name={theme.icon as any} size={13} color={theme.accentColor} />
                <Text style={[styles.level100BadgeText, { color: theme.accentColor }]}>
                  LEVEL {levelNum}
                </Text>
              </View>
            </View>

            {/* 2. Middle Full-Width Frosted Bento Box: Freshman · Foundation Year + Italic Dept */}
            <View style={[styles.level100MidBentoBox, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.18)' }]}>
              <View style={styles.level100MidTitleRow}>
                <Ionicons name="school" size={14} color={theme.accentColor} />
                <Text style={[styles.level100MidTitleText, { color: isDark ? theme.accentColor : '#FFFFFF' }]}>
                  {theme.title} · {theme.subtitle}
                </Text>
              </View>
              <Text style={styles.level100DeptItalic} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                Library & Information Science · UMYU
              </Text>
            </View>

            {/* 3. Bottom 2-Card Bento Grid: REGISTRATION NUMBER + ACADEMIC RANK */}
            <View style={styles.level100BottomGrid}>
              <View style={[styles.level100BentoTile, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.18)' }]}>
                <Text style={[styles.level100MicroLabel, { color: theme.badgeText }]}>
                  {'REGISTRATION\nNUMBER'}
                </Text>
                <Text style={styles.level100TileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  {matric}
                </Text>
              </View>

              <View style={[styles.level100BentoTile, { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.18)' }]}>
                <Text style={[styles.level100MicroLabel, { color: theme.badgeText }]}>
                  ACADEMIC RANK
                </Text>
                <Text style={styles.level100TileValue} numberOfLines={1}>
                  {rank.label} · {userPoints} PTS
                </Text>
              </View>
            </View>
          </LinearGradient>
        ) : (
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
                {/* ACTION 1: Tap Avatar to View in Universal Viewer */}
                <TouchableOpacity
                  onPress={() => {
                    if (avatar) {
                      const remoteAvatar = confirmedAvatarUrl
                        || user.avatar_url
                        || (user.id ? `https://api.dicebear.com/9.x/fun-emoji/png?seed=${user.id}&size=200` : undefined);
                      setViewerFile({
                        uri: avatar,
                        remoteUrl: remoteAvatar,
                        type: 'image',
                        name: `${user.full_name || 'Profile'}'s Avatar`,
                      });
                      setViewerVisible(true);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.avatarRing, { borderColor: theme.accentColor + '80' }]}>
                    <CachedImage entityId={user?.id || ''} remoteUrl={confirmedAvatarUrl || user.avatar_url || avatar} assetType="user" style={styles.avatar} />
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
        )}

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
                onPress={() => {
                  if (action.id === 'news') useNewsStore.getState().markAsRead();
                  if (action.id === 'archive') require('../../src/stores/archive.store').useArchiveStore.getState().markAsRead();
                  if (action.id === 'fyb') require('../../src/stores/fyb.store').useFYBStore.getState().markAsRead();
                  router.push(action.route as any);
                }}
              >
                <View style={[styles.actionIconBg, { backgroundColor: isDark ? action.darkBg : action.lightBg }]}>
                  <Ionicons name={action.icon as any} size={24} color={isDark ? action.darkColor : action.lightColor} />
                  {action.id === 'news' && newsUnreadCount > 0 && (
                    <View style={styles.newsBadge}>
                      <Text style={styles.newsBadgeText}>{newsUnreadCount > 99 ? '99+' : newsUnreadCount}</Text>
                    </View>
                  )}
                  {action.id === 'archive' && archiveUnreadCount > 0 && (
                    <View style={styles.newsBadge}>
                      <Text style={styles.newsBadgeText}>{archiveUnreadCount > 99 ? '99+' : archiveUnreadCount}</Text>
                    </View>
                  )}
                  {action.id === 'fyb' && fybUnreadCount > 0 && (
                    <View style={styles.newsBadge}>
                      <Text style={styles.newsBadgeText}>{fybUnreadCount > 99 ? '99+' : fybUnreadCount}</Text>
                    </View>
                  )}
                  {action.id === 'event_pool' && eventPoolBadge && (
                    <View style={[styles.newsBadge, { backgroundColor: eventPoolBadge === 'LIVE' ? '#ef4444' : '#f59e0b', width: 'auto', paddingHorizontal: 5, right: -10 }]}>
                      <Text style={[styles.newsBadgeText, { fontSize: 9, letterSpacing: 0.5 }]}>{eventPoolBadge}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{action.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ─── Featured Student Realtime Congratulations Notification Card ── */}
          {user?.id && <FeaturedStudentCongratsCard userId={user.id} />}

          {/* ─── Pinned Featured Students (FYB) ─────────────── */}
          {activePinnedFeatured.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Featured Students</Text>
                <TouchableOpacity onPress={() => router.push('/fyb' as any)}>
                  <Text style={[styles.seeAllText, { color: isDark ? theme.accentColor : theme.gradient[2] }]}>See All</Text>
                </TouchableOpacity>
              </View>
              {activePinnedFeatured.map((item: any) => (
                <FeaturedStudentCard
                  key={`fyb-${item.id}`}
                  item={item}
                  onPress={() => router.push('/fyb' as any)}
                />
              ))}
            </View>
          )}

          {/* Combined Announcements & Events */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Announcements</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/announcements')}>
              <Text style={[styles.seeAllText, { color: isDark ? theme.accentColor : theme.gradient[2] }]}>See All</Text>
            </TouchableOpacity>
          </View>

          {combinedItems.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              {(loadingAnnouncements || loadingEvents)
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={[styles.emptyText, { color: colors.textMuted }]}>No updates available</Text>}
            </View>
          ) : (
            <View style={styles.posterGrid}>
              {combinedItems.map((item) => {
                if (item._type === 'announcement') {
                  const isRead = readIds.includes(item.id);
                  return (
                    <TouchableOpacity
                      key={`ann-${item.id}`}
                      style={[styles.posterCard, { borderColor: isDark ? 'rgba(52, 211, 153, 0.15)' : 'rgba(0,0,0,0.05)', backgroundColor: isDark ? '#0f172a' : '#fff' }]}
                      onPress={() => {
                        markAsRead(item.id).catch(() => { });
                        router.push({ pathname: '/announcement/[id]', params: { id: item.id } } as any);
                      }}
                    >
                      <CachedImage
                        remoteUrl={item.cover_image_url ? getOptimizedCloudinaryUrl(item.cover_image_url, 600, 400) : null}
                        style={styles.posterImage}
                        entityId={item.id}
                        assetType="announcement_cover"
                        resizeMode="cover"
                        onPress={(localUri) => {
                          setViewerFile({
                            uri: localUri || item.cover_image_url || '',
                            type: 'image',
                            name: item.title || '',
                          });
                          setViewerVisible(true);
                        }}
                      />
                      <LinearGradient colors={['rgba(15,23,42,0.1)', 'rgba(15,23,42,0.95)']} style={styles.posterGradient} />
                      <View style={styles.posterContent}>
                        <View style={styles.posterTagRow}>
                          <View style={[styles.posterTag, !isRead ? styles.posterTagUnread : styles.posterTagRead]}>
                            <Text style={[styles.posterTagText, !isRead ? { color: '#34d399' } : { color: '#ffffff' }]}>{item.category?.toUpperCase() || 'GENERAL'}</Text>
                          </View>
                        </View>
                        <Text style={styles.posterTitle} numberOfLines={2}>{item.title}</Text>
                        <View style={styles.posterFooter}>
                          <Text style={styles.posterDate}>{item.created_at ? (() => { try { return format(new Date(item.created_at), 'MMMM d, yyyy'); } catch { return ''; } })() : ''}</Text>
                          <Text style={[styles.posterSeeMore, !isRead ? { color: '#34d399' } : { color: '#ffffff' }]}>See more →</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                } else {
                  return (
                    <TouchableOpacity
                      key={`evt-${item.id}`}
                      style={styles.posterCard}
                      onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } } as any)}
                    >
                      <PosterImage
                        uri={item.cover_image_url ? getOptimizedCloudinaryUrl(item.cover_image_url, 600, 400) : undefined}
                        fallbackUri={item.cover_image_url || undefined}
                        style={styles.posterImage}
                        gradientColors={['#052e16', '#14532d']}
                      />
                      <LinearGradient colors={['transparent', 'rgba(5,46,22,0.95)']} style={styles.posterGradient} />
                      <View style={styles.posterContent}>
                        <View style={styles.posterTagRow}>
                          <View style={styles.posterTag}>
                            <Text style={styles.posterTagText}>{item.status?.toUpperCase() || 'EVENT'}</Text>
                          </View>
                        </View>
                        <Text style={styles.posterTitle} numberOfLines={2}>{item.title}</Text>
                        <View style={styles.posterFooter}>
                          <Text style={styles.posterDate}>
                            {item.start_date ? (() => { try { return format(new Date(item.start_date), 'MMMM d, yyyy'); } catch { return ''; } })() : ''}{item.venue ? ` · ${item.venue}` : ''}
                          </Text>
                          <Text style={styles.posterSeeMore}>See more →</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }
              })}
            </View>
          )}
        </View>

        {isAdmin && (
          <TouchableOpacity style={[styles.adminBanner, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push('/(tabs)/(admin)' as any)}>
            <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            <Text style={[styles.adminBannerTitle, { color: colors.text }]}>Access Admin Panel</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Avatar Confirmation Modal */}
      <SafeModal
        visible={showAvatarConfirm}
        onClose={() => setShowAvatarConfirm(false)}
        contentStyle={{ backgroundColor: colors.card }}
        animationType="fade"
      >
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
      </SafeModal>
      {/* Universal Viewer for Profile Picture */}
      {viewerFile && (
        <UniversalViewer
          isVisible={viewerVisible}
          onClose={() => {
            setViewerVisible(false);
            setTimeout(() => setViewerFile(null), 300);
          }}
          fileUri={viewerFile?.uri || ''}
          remoteUrl={viewerFile?.remoteUrl}
          fileType={viewerFile?.type || 'image'}
          fileName={viewerFile?.name || ''}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  appName: { fontFamily: 'Inter-Bold', fontSize: 18, color: '#1B5E20', letterSpacing: 0.2 },
  topBarRight: { flexDirection: 'row', gap: 12 },
  iconButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  offlineText: {
    fontSize: 13,
    fontWeight: '600',
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

  // ── Level 300 Card (Executive Academic Pass) ───────────────────────────────
  level300Card: {
    paddingTop: 20,
    paddingBottom: 18,
    paddingHorizontal: 22,
    overflow: 'hidden',
    position: 'relative',
  },
  level300TopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  level300StatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  level300StatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  level300StatusText: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: 'rgba(255,255,255,0.92)',
  },
  level300Badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  level300BadgeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  level300IdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 14,
  },
  level300AvatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    padding: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  level300IdentityInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  level300FullName: {
    fontFamily: 'Inter-Bold',
    fontSize: 21,
    color: '#FFFFFF',
    lineHeight: 26,
    marginBottom: 2,
  },
  level300Handle: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    marginBottom: 8,
  },
  level300PtsPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  level300PtsText: {
    fontFamily: 'Inter-Bold',
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: 0.5,
  },
  level300DeptItalic: {
    fontFamily: 'Inter-Regular',
    fontStyle: 'italic',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 14,
  },
  level300BottomStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    paddingTop: 12,
  },
  level300RegCol: {
    flex: 1.4,
    paddingRight: 12,
  },
  level300MicroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  level300MicroLabel: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 9.5,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
  },
  level300RegValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 14.5,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  level300StripDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginHorizontal: 14,
  },
  level300RankCol: {
    flex: 0.8,
  },
  level300RankValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  level300RankValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 14.5,
  },

  // ── Level 200 Card (The Asymmetric Split Credential — Concept 1) ───────────
  level200Card: {
    paddingVertical: 20,
    paddingHorizontal: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  level200SplitRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  level200LeftCol: {
    width: 104,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 6,
  },
  level200AvatarRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2.5,
    padding: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 8,
  },
  level200Handle: {
    fontFamily: 'Inter-Medium',
    fontSize: 12.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  level200BadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    width: '100%',
  },
  level200BadgeLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 9,
    letterSpacing: 1,
  },
  level200BadgeNum: {
    fontFamily: 'Inter-Bold',
    fontSize: 11.5,
    letterSpacing: 0.5,
  },
  level200PerforationCol: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  level200DashSegment: {
    width: 1.5,
    height: 6,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  level200RightCol: {
    flex: 1,
    paddingLeft: 8,
    justifyContent: 'space-between',
  },
  level200StatusUpper: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 14,
    marginBottom: 4,
  },
  level200FullName: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    color: '#FFFFFF',
    lineHeight: 25,
    marginBottom: 3,
  },
  level200DeptItalic: {
    fontFamily: 'Inter-Regular',
    fontStyle: 'italic',
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
  },
  level200RegBox: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  level200RegMicroLabel: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 9,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  level200RegValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 13.5,
    letterSpacing: 0.6,
  },
  level200FooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  level200PtsRankText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.9)',
  },

  // ── Level 100 Card (Classic Bento Pass — Variation 3A) ────────────────────
  level100Card: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  level100TopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  level100TopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  level100AvatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2.5,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  level100NameStack: {
    flex: 1,
    justifyContent: 'center',
  },
  level100FullName: {
    fontFamily: 'Inter-Bold',
    fontSize: 19,
    color: '#FFFFFF',
    lineHeight: 24,
    marginBottom: 2,
  },
  level100Handle: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
  },
  level100BadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  level100BadgeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  level100MidBentoBox: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  level100MidTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 4,
  },
  level100MidTitleText: {
    fontFamily: 'Inter-Bold',
    fontSize: 13.5,
  },
  level100DeptItalic: {
    fontFamily: 'Inter-Regular',
    fontStyle: 'italic',
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  level100BottomGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  level100BentoTile: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: 'space-between',
  },
  level100MicroLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 9.5,
    letterSpacing: 0.8,
    lineHeight: 13,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  level100TileValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.3,
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
  newsBadge: {
    position: 'absolute', top: -6, right: -6, backgroundColor: '#EF4444',
    borderRadius: 12, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF', paddingHorizontal: 4, zIndex: 10,
  },
  newsBadgeText: { color: '#FFF', fontSize: 9, fontFamily: 'Inter-Bold', lineHeight: 11 },
  emptyCard: {
    padding: 32, alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 16, borderWidth: 1, borderColor: '#F1F5F9', borderStyle: 'dashed',
  },
  emptyText: { fontFamily: 'Inter-Medium', fontSize: 14, color: '#94A3B8' },
  posterGrid: { gap: 14, paddingHorizontal: 4, paddingBottom: 4 },
  posterCard: {
    width: '100%', height: 200,
    borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFF',
    borderWidth: 1, borderColor: '#F1F5F9',
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
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1,
  },
  posterTagUnread: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderColor: 'rgba(52, 211, 153, 0.5)',
  },
  posterTagRead: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  posterTagText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#FFF' },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  posterTitle: {
    fontFamily: 'Inter-Bold', fontSize: 20, color: '#FFF', marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  posterDate: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  posterMeta: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(255,255,255,0.8)' },
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
