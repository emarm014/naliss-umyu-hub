import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../src/constants/Colors';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { useAuthStore, useAnnouncementStore, useEventStore, useResourceStore } from '../src/stores';
import { Announcement } from '../src/stores/announcement.store';
import { Event } from '../src/stores/event.store';
import { Material } from '../src/types';
export default function NotificationsScreen() {
  const { profile, fetchProfile } = useAuthStore();
  const { announcements, fetchAnnouncements } = useAnnouncementStore();
  const { events, fetchUpcomingEvents } = useEventStore();
  const { materials, fetchMaterials, fetchCourses } = useResourceStore();

  useEffect(() => {
    // Load initial data if missing
    if (!profile) fetchProfile();
    if (announcements.length === 0) fetchAnnouncements(profile?.level);
    if (events.length === 0) fetchUpcomingEvents(profile?.level);
    if (materials.length === 0) {
        fetchMaterials({ level: (profile?.level as any) || undefined });
        fetchCourses(profile?.level || undefined);
    }
  }, []);

  // Generate dynamic notifications from stores — memoized to avoid recreating on every render
  const readIds = useAnnouncementStore(s => s.readIds);
  const notifications = React.useMemo(() => {
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
          message: `New study material available`,
          date: m.created_at,
          isRead: true,
        });
      });
    }

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [announcements, events, materials, profile, readIds]);

  const getIconConfig = (type: string) => {
    switch (type) {
      case 'resource':
        return { name: 'folder', color: '#8B5CF6', bg: COLORS.actionPurple };
      case 'announcement':
        return { name: 'megaphone', color: COLORS.secondary, bg: COLORS.actionMint };
      case 'event':
        return { name: 'calendar', color: '#3B82F6', bg: COLORS.actionBlue };
      case 'chat':
        return { name: 'chatbubbles', color: COLORS.primary, bg: COLORS.actionMint };
      default:
        return { name: 'notifications', color: COLORS.textMuted, bg: '#F1F5F9' };
    }
  };

  const markAllAsRead = async () => {
    await useAnnouncementStore.getState().markAllAsRead(profile?.level);
    // Force re-render if needed or rely on store subscription
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
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
        </View>
        
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllAsRead}>
            <Text style={styles.markAllText}>Mark all as read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {notifications.length > 0 ? (
          notifications.map((notification) => {
            const iconConfig = getIconConfig(notification.type);
            return (
              <TouchableOpacity 
                key={notification.id} 
                style={[styles.notificationCard, !notification.isRead && styles.unreadCard]}
                onPress={() => handleNotificationPress(notification.id, notification.type)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBg, { backgroundColor: iconConfig.bg }]}>
                  <Ionicons name={iconConfig.name as any} size={22} color={iconConfig.color} />
                </View>

                <View style={styles.textContainer}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, !notification.isRead && styles.unreadText]}>
                      {notification.title}
                    </Text>
                    <Text style={styles.timeText}>
                      {notification.date ? format(new Date(notification.date), 'MMM d, h:mm a') : ''}
                    </Text>
                  </View>
                  <Text style={styles.message} numberOfLines={2}>
                    {notification.message}
                  </Text>
                </View>
                
                {!notification.isRead && <View style={styles.unreadDot} />}
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconBg}>
              <Ionicons name="notifications-off-outline" size={48} color={COLORS.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptySubtitle}>You have no new notifications right now.</Text>
          </View>
        )}
        <View style={styles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 12,
  },
  headerTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    color: '#0F172A',
  },
  markAllText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: '#059669',
  },
  content: {
    flex: 1,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  unreadCard: {
    backgroundColor: '#F0FDF4', // Very light institutional green tint
    borderLeftWidth: 4,
    borderLeftColor: '#064E3B', // Deep Institutional Green
  },
  iconBg: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  textContainer: {
    flex: 1,
    paddingVertical: 2,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  title: {
    flex: 1,
    fontFamily: 'Inter-SemiBold',
    fontSize: 16,
    color: '#334155',
    marginRight: 8,
    lineHeight: 20,
  },
  unreadText: {
    fontFamily: 'Inter-Bold',
    color: '#064E3B', // Deep Institutional Green for unread titles
  },
  timeText: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  message: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#059669',
    marginLeft: 12,
    alignSelf: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    paddingHorizontal: 40,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: '#1E293B',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    height: 40,
  },
});
