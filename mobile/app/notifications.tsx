import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../src/constants/Colors';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { useAuthStore, useAnnouncementStore, useEventStore, useResourceStore } from '../src/stores';
import { useNetworkStore } from '../src/stores/network.store';
import { Announcement } from '../src/stores/announcement.store';
import { Event } from '../src/stores/event.store';
import { Material } from '../src/types';
import { useTheme } from '../src/stores/theme.store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Notifications are persisted to AsyncStorage so they survive offline + app restarts
const NOTIF_CACHE_KEY = 'naliss_notifications_cache';

export default function NotificationsScreen() {
  const { profile, fetchProfile } = useAuthStore();
  const { announcements, fetchAnnouncements } = useAnnouncementStore();
  const { events, fetchUpcomingEvents } = useEventStore();
  const { materials, fetchMaterials, fetchCourses } = useResourceStore();
  const isOnline = useNetworkStore(s => s.isOnline);
  const { colors, isDark } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // Persisted notification list — survives offline and app restarts
  const [cachedNotifications, setCachedNotifications] = useState<any[]>([]);

  // Load persisted notifications on mount (instant, no network needed)
  useEffect(() => {
    AsyncStorage.getItem(NOTIF_CACHE_KEY).then(raw => {
      if (raw) {
        try { setCachedNotifications(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, []);

  useEffect(() => {
    if (!profile) fetchProfile();
    if (announcements.length === 0 && isOnline) fetchAnnouncements(profile?.level);
    if (events.length === 0 && isOnline) fetchUpcomingEvents(profile?.level);
    if (materials.length === 0 && isOnline) {
      fetchMaterials({ level: (profile?.level as any) || undefined });
      fetchCourses(profile?.level || undefined);
    }
  }, []);

  const readIds = useAnnouncementStore(s => s.readIds);

  // Build notifications from live store data
  const liveNotifications = React.useMemo(() => {
    const list: any[] = [];

    if (profile?.notif_announcements) {
      announcements.forEach((a: Announcement) => {
        list.push({
          id: a.id,
          type: 'announcement',
          title: a.title,
          message: a.content.substring(0, 100) + (a.content.length > 100 ? '...' : ''),
          date: a.created_at,
          isRead: readIds.includes(a.id),
        });
      });
    }

    if (profile?.notif_events) {
      events.forEach((e: Event) => {
        list.push({
          id: e.id,
          type: 'event',
          title: e.title,
          message: `${e.venue || 'No venue'} • ${e.start_date ? format(new Date(e.start_date), 'MMM d, h:mm a') : ''}`,
          date: e.created_at,
          isRead: true,
        });
      });
    }

    if (profile?.notif_materials) {
      materials.forEach((m: Material) => {
        list.push({
          id: m.id,
          type: 'resource',
          title: m.title,
          message: 'New study material available',
          date: m.created_at,
          isRead: true,
        });
      });
    }

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [announcements, events, materials, profile, readIds]);

  // Merge live + cached — live always wins for same ID, cached fills in offline gaps
  const notifications = React.useMemo(() => {
    if (liveNotifications.length > 0) {
      // Persist the latest live list for offline use
      AsyncStorage.setItem(NOTIF_CACHE_KEY, JSON.stringify(liveNotifications)).catch(() => {});
      return liveNotifications;
    }
    // Offline or stores empty — serve from persisted cache
    return cachedNotifications;
  }, [liveNotifications, cachedNotifications]);

  const onRefresh = useCallback(async () => {
    if (!isOnline) return;
    setRefreshing(true);
    try {
      await Promise.all([
        fetchAnnouncements(profile?.level, true),
        fetchUpcomingEvents(profile?.level),
        fetchMaterials({ level: (profile?.level as any) || undefined }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [isOnline, profile?.level]);

  const getIconConfig = (type: string) => {
    switch (type) {
      case 'resource':   return { name: 'folder',       color: '#8B5CF6', bg: COLORS.actionPurple };
      case 'announcement': return { name: 'megaphone',  color: COLORS.secondary, bg: COLORS.actionMint };
      case 'event':      return { name: 'calendar',     color: '#3B82F6', bg: COLORS.actionBlue };
      case 'chat':       return { name: 'chatbubbles',  color: COLORS.primary, bg: COLORS.actionMint };
      default:           return { name: 'notifications', color: COLORS.textMuted, bg: '#F1F5F9' };
    }
  };

  const markAllAsRead = async () => {
    await useAnnouncementStore.getState().markAllAsRead(profile?.level);
  };

  const handleNotificationPress = async (id: string, type: string) => {
    if (type === 'announcement') {
      await useAnnouncementStore.getState().markAsRead(id);
      router.push({ pathname: '/announcement/[id]', params: { id } } as any);
    } else if (type === 'resource') {
      router.push('/(tabs)/resources');
    } else {
      router.push('/(tabs)');
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {!isOnline && (
            <View style={styles.offlineBadge}>
              <Ionicons name="cloud-offline-outline" size={12} color="#f59e0b" />
              <Text style={styles.offlineBadgeText}>Offline</Text>
            </View>
          )}
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllAsRead}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            enabled={isOnline}
          />
        }
      >
        {notifications.length > 0 ? (
          notifications.map((notification) => {
            const iconConfig = getIconConfig(notification.type);
            return (
              <TouchableOpacity
                key={notification.id}
                style={[
                  styles.notificationCard,
                  { backgroundColor: colors.card, borderBottomColor: colors.border },
                  !notification.isRead && [styles.unreadCard, { backgroundColor: isDark ? '#0f2a1e' : '#F0FDF4' }],
                ]}
                onPress={() => handleNotificationPress(notification.id, notification.type)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBg, { backgroundColor: iconConfig.bg }]}>
                  <Ionicons name={iconConfig.name as any} size={22} color={iconConfig.color} />
                </View>

                <View style={styles.textContainer}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: colors.text }, !notification.isRead && styles.unreadText]} numberOfLines={2}>
                      {notification.title}
                    </Text>
                    <Text style={[styles.timeText, { color: colors.textMuted }]}>
                      {notification.date ? (() => { try { return format(new Date(notification.date), 'MMM d, h:mm a'); } catch { return ''; } })() : ''}
                    </Text>
                  </View>
                  <Text style={[styles.message, { color: colors.textSecondary }]} numberOfLines={2}>
                    {notification.message}
                  </Text>
                </View>

                {!notification.isRead && <View style={styles.unreadDot} />}
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconBg, { backgroundColor: colors.surface }]}>
              <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {isOnline ? 'All caught up!' : 'No cached notifications'}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              {isOnline
                ? 'You have no new notifications right now.'
                : 'Connect to the internet to load notifications. They will be saved for offline use.'}
            </Text>
          </View>
        )}
        <View style={styles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 10, paddingBottom: 15, paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backButton: { marginRight: 12 },
  headerTitle: { fontFamily: 'Inter-Bold', fontSize: 20 },
  markAllText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: '#059669' },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  offlineBadgeText: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: '#f59e0b' },
  content: { flex: 1 },
  notificationCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 16, borderBottomWidth: 1,
  },
  unreadCard: { borderLeftWidth: 4, borderLeftColor: '#064E3B' },
  iconBg: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginRight: 16,
    elevation: 3, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4,
  },
  textContainer: { flex: 1, paddingVertical: 2 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  title: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 16, marginRight: 8, lineHeight: 20 },
  unreadText: { fontFamily: 'Inter-Bold', color: '#064E3B' },
  timeText: { fontFamily: 'Inter-Medium', fontSize: 12, marginTop: 2 },
  message: { fontFamily: 'Inter-Regular', fontSize: 14, lineHeight: 20 },
  unreadDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#059669', marginLeft: 12, alignSelf: 'center',
  },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100, paddingHorizontal: 40 },
  emptyIconBg: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { fontFamily: 'Inter-Bold', fontSize: 18, marginBottom: 8 },
  emptySubtitle: { fontFamily: 'Inter-Regular', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  footer: { height: 40 },
});
