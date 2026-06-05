import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/Colors';
import { NalissLogo } from '../../src/components/NalissLogo';
import { format } from 'date-fns';
import { supabase } from '../../src/api/supabase/client';
import { useSettingsStore, useAuthStore, useGroupStore } from '../../src/stores';
import { useTheme } from '../../src/stores/theme.store';
import { useSentryScreen } from '../../src/hooks/useSentryScreen';
import { getCleanAvatarUrl } from '../../src/utils';

export default function MessagesScreen() {
  useSentryScreen('MessagesScreen');
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const profile = useAuthStore(s => s.profile);
  const readOnlyMode = useSettingsStore(s => s.readOnlyMode);
  const groups = useGroupStore(s => s.groups);
  const isLoading = useGroupStore(s => s.isLoading);
  const fetchGroups = useGroupStore(s => s.fetchGroups);
  const { colors, isDark } = useTheme();

  const isStudent = !['super_admin', 'moderator'].includes(profile?.role || '');
  const showReadOnlyBanner = readOnlyMode && isStudent;

  const conversations = groups.map(group => {
    const isLevelGroup = group.group_type === 'level' || group.name.includes('Level');
    return {
      ...group,
      category: isLevelGroup ? 'Level Groups' : 'General Groups',
    };
  });

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchGroups();
    } finally {
      setRefreshing(false);
    }
  };

  const levelGroups = conversations.filter(c => c.category === 'Level Groups');
  const generalGroups = conversations.filter(c => c.category === 'General Groups');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>NALISS HUB</Text>
        </View>
      </View>

      {showReadOnlyBanner && (
        <View style={[styles.readOnlyBanner, { backgroundColor: isDark ? '#0c2a3a' : '#e0f2fe' }]}>
          <Ionicons name="information-circle" size={18} color="#0369a1" />
          <Text style={styles.readOnlyBannerText}>
             The application is in read-only mode.
          </Text>
        </View>
      )}

      <ScrollView
        style={[styles.content, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollPadding}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        {isLoading && conversations.length === 0 ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <>
            {levelGroups.length > 0 && (
              <View style={styles.sectionHeader}>
                <Ionicons name="school-outline" size={18} color={COLORS.primary} />
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>LEVEL GROUPS</Text>
              </View>
            )}
            {levelGroups.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                colors={colors}
                onPress={() => router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: conversation.id,
                    type: 'group',
                    name: conversation.name || 'Group Chat',
                    avatar: getCleanAvatarUrl(conversation.avatar_url) || ''
                  }
                })}
              />
            ))}

            {generalGroups.length > 0 && (
              <View style={[styles.sectionHeader, { marginTop: 12 }]}>
                <Ionicons name="people-outline" size={18} color={COLORS.primary} />
                <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>GENERAL GROUPS</Text>
              </View>
            )}
            {generalGroups.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                colors={colors}
                onPress={() => router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: conversation.id,
                    type: 'group',
                    name: conversation.name || 'Group Chat',
                    avatar: getCleanAvatarUrl(conversation.avatar_url) || ''
                  }
                })}
              />
            ))}

            {conversations.length === 0 && !isLoading && (
              <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
                <View style={[styles.emptyIconBg, { backgroundColor: colors.surface }]}>
                  <Ionicons name="chatbubbles" size={32} color={colors.textMuted} />
                </View>
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>No messages yet</Text>
                <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>
                  Your conversations will appear here. Start chatting!
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Convert raw Cloudinary URLs in last_message to friendly labels.
 * Handles legacy cached data where the URL was stored instead of the label.
 */
function sanitizeLastMessage(msg: string | null | undefined): string {
  if (!msg) return 'No messages yet';
  // If it's a Cloudinary URL, convert to friendly label
  if (msg.includes('cloudinary.com') || msg.includes('res.cloudinary')) {
    const lower = msg.toLowerCase();
    if (lower.includes('/video/upload/') || lower.includes('chat-videos') || lower.match(/\.(mp4|mov|avi|webm|mkv)$/)) {
      return '🎥 Video';
    }
    if (lower.includes('/image/upload/') || lower.includes('chat-images') || lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
      return '📷 Photo';
    }
    if (lower.includes('chat-docs') || lower.match(/\.(pdf|doc|docx|ppt|pptx)$/)) {
      return '📎 Document';
    }
    if (lower.includes('chat-audios') || lower.match(/\.(mp3|wav|ogg|aac|m4a)$/)) {
      return '🎵 Audio';
    }
    return '📎 Media';
  }
  return msg;
}

function ConversationItem({
  conversation,
  onPress,
  colors,
}: {
  conversation: any;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.conversationItem,
        { backgroundColor: colors.card, borderBottomColor: colors.divider },
        (conversation.unread_count || 0) > 0 && { backgroundColor: colors.isDark ? '#0f2a1a' : '#f0fdf4' },
      ]}
      onPress={onPress}
    >
      <View style={styles.avatarContainer}>
        {(() => {
          const cleanUrl = getCleanAvatarUrl(conversation.avatar_url);
          return cleanUrl ? (
            <Image source={{ uri: cleanUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.logoAvatarContainer}>
              <NalissLogo size={46} />
            </View>
          );
        })()}
        {conversation.is_verified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
          </View>
        )}
      </View>

      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <View style={styles.nameRow}>
            <Text style={[styles.conversationName, { color: colors.text }]} numberOfLines={1}>
              {conversation.name}
            </Text>
            {conversation.is_pinned && (
              <Ionicons name="pin" size={12} color={COLORS.primary} style={{ marginLeft: 6, transform: [{ rotate: '45deg' }] }} />
            )}
          </View>
          {conversation.last_message_at && conversation.last_message ? (
            <Text style={[styles.conversationTime, { color: colors.textMuted }]}>
              {format(new Date(conversation.last_message_at), 'p')}
            </Text>
          ) : null}
        </View>

        <View style={styles.lastMessageRow}>
          <Text style={[styles.lastMessage, { color: colors.textSecondary }]} numberOfLines={1}>
            {sanitizeLastMessage(conversation.last_message)}
          </Text>
          {(conversation.unread_count || 0) > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{conversation.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  header: {
    paddingTop: 60,
    backgroundColor: '#FFF',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  headerTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    color: '#064e3b',
    letterSpacing: 1,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 46,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    color: COLORS.text,
    padding: 0,
    height: '100%',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#064e3b',
  },
  tabText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabBadge: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  activeTabText: {
    fontFamily: 'Inter-Bold',
    color: '#064e3b',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 12,
    color: '#64748b',
    letterSpacing: 0.5,
  },
  content: {
    flex: 1,
  },
  scrollPadding: {
    paddingBottom: 32,
  },
  centerContainer: {
    padding: 60,
    alignItems: 'center',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  conversationItemUnread: {
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 3,
    borderLeftColor: '#1B5E20',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatarImage: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  logoAvatarContainer: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 1,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  conversationName: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#0f172a',
  },
  conversationTime: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: '#94a3b8',
  },
  lastMessageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: '#64748b',
    flex: 1,
    paddingRight: 12,
  },
  unreadBadge: {
    backgroundColor: '#064e3b',
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    marginLeft: 8,
  },
  unreadText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: '#FFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 32,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderStyle: 'dashed',
    borderRadius: 32,
  },
  emptyIconBg: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  emptyStateTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyStateText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  readOnlyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f9ff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#bae6fd',
    gap: 8,
  },
  readOnlyBannerText: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: '#0369a1',
  },
});
