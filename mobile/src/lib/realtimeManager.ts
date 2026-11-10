import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../../src/api/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useGroupStore } from '../../src/stores/group.store';
import { useMessageStore } from '../../src/stores/message.store';
import { useEventPoolStore } from '../../src/stores/event-pool.store';
import { useAnnouncementStore } from '../../src/stores/announcement.store';
import { useEventStore } from '../../src/stores/event.store';
import { useResourceStore } from '../../src/stores/resource.store';
import { useDirectoryStore } from '../../src/stores/directory.store';
import { useAuthStore } from '../../src/stores/auth.store';
import { useNotificationStore } from '../../src/stores/notification.store';
import { registerOnlineCallback } from '../../src/stores/network.store';

type ListenerUnsubscribe = () => void;

// Disconnect the WebSocket after 30s in the background to free up Supabase Free Tier
// concurrent connection slots (push notifications still arrive via FCM).
const BACKGROUND_DISCONNECT_DELAY_MS = 30 * 1000;

class RealtimeManager {
    private masterChannel: RealtimeChannel | null = null;
    private userId: string | null = null;
    private appStateSubscription: any = null;
    private unregisterOnline: (() => void) | null = null;
    private backgroundTimer: ReturnType<typeof setTimeout> | null = null;
    private groupFetchTimer: ReturnType<typeof setTimeout> | null = null;
    private poolFetchTimer: ReturnType<typeof setTimeout> | null = null;

    private chatListeners: Map<string, Set<(msg: any) => void>> = new Map();
    private groupMetadataListeners: Map<string, Set<(group: any) => void>> = new Map();
    private groupMembersListeners: Map<string, Set<(memberAction: any) => void>> = new Map();
    private presenceListeners: Map<string, Set<(onlineUserIds: Set<string>) => void>> = new Map();

    private poolListeners: Set<(pool: any) => void> = new Set();
    private featuredListeners: Set<(featured: any) => void> = new Set();

    public init(userId: string) {
        if (this.masterChannel && this.userId === userId) {
            return; // Already initialized for this user
        }

        // Clean up previous if user changed
        this.cleanup();

        this.userId = userId;
        this.setupMasterChannel();

        // Monitor AppState for background/foreground transitions
        this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);

        // Reconnect automatically when network is restored
        this.unregisterOnline = registerOnlineCallback(() => {
            if (this.userId && AppState.currentState === 'active') {
                this.reconnectMasterChannel();
            }
        });
    }

    private isReconnecting = false;

    private clearBackgroundTimer() {
        if (this.backgroundTimer) {
            clearTimeout(this.backgroundTimer);
            this.backgroundTimer = null;
        }
    }

    private debouncedFetchGroups() {
        if (this.groupFetchTimer) clearTimeout(this.groupFetchTimer);
        this.groupFetchTimer = setTimeout(() => {
            useGroupStore.getState().fetchGroups(true).catch(() => {});
        }, 400);
    }

    private debouncedFetchPools() {
        if (this.poolFetchTimer) clearTimeout(this.poolFetchTimer);
        this.poolFetchTimer = setTimeout(() => {
            useEventPoolStore.getState().fetchPools(true).catch(() => {});
        }, 400);
    }

    private async reconnectMasterChannel() {
        if (this.isReconnecting || !this.userId) return;
        this.isReconnecting = true;
        try {
            if (this.masterChannel) {
                await supabase.removeChannel(this.masterChannel);
                this.masterChannel = null;
            }
            if (this.userId) {
                this.setupMasterChannel();
            }
        } finally {
            this.isReconnecting = false;
        }
    }

    private handleAppStateChange = async (nextAppState: AppStateStatus) => {
        if (nextAppState === 'background') {
            // Schedule graceful disconnect after 30s in background to conserve
            // Supabase Free Tier concurrent connection quota (200 max).
            this.clearBackgroundTimer();
            this.backgroundTimer = setTimeout(async () => {
                if (AppState.currentState !== 'active' && this.masterChannel) {
                    try {
                        await supabase.removeChannel(this.masterChannel);
                    } catch {}
                    this.masterChannel = null;
                }
            }, BACKGROUND_DISCONNECT_DELAY_MS);
            return;
        }

        if (nextAppState === 'active') {
            this.clearBackgroundTimer();

            try {
                const { useNetworkStore } = require('../stores/network.store');
                if (!useNetworkStore.getState().isOnline) return;
            } catch {}

            if (!this.masterChannel || (this.masterChannel.state !== 'joined' && this.masterChannel.state !== 'joining')) {
                await this.reconnectMasterChannel();
            }
        }
    };

    private setupMasterChannel() {
        if (!this.userId) return;

        // ONE multiplexed channel per active device — 1 WebSocket total, regardless of table count.
        this.masterChannel = supabase.channel(`mobile_master_${this.userId}`, {
            config: { broadcast: { self: false } }
        });

        // 1) Messages listener (INSERT, UPDATE, DELETE)
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'messages' },
            (payload) => {
                this.dispatchIncomingMessage(payload);
            }
        );

        // 2) Groups listener (INSERT, UPDATE, DELETE)
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'groups' },
            (payload) => {
                this.dispatchGroupChange(payload);
            }
        );

        // 3) Group Members listener (joins/leaves/role changes)
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'group_members' },
            (payload) => {
                this.dispatchGroupMemberChange(payload);
            }
        );

        // 4) Event Pools & Pool Participants listener
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'event_pools' },
            (payload) => {
                this.dispatchPoolUpdate(payload);
            }
        );

        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'pool_participants' },
            (payload) => {
                const newWinnerPos = (payload.new as any)?.winner_position ?? null;
                const oldWinnerPos = (payload.old as any)?.winner_position ?? null;
                if (newWinnerPos !== null || oldWinnerPos !== null) {
                    this.debouncedFetchPools();
                }
                this.poolListeners.forEach(cb => cb(payload));
            }
        );

        // 5) Featured Students listener
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'featured_students' },
            (payload) => {
                this.dispatchFeaturedUpdate(payload);
            }
        );

        // 6) Announcements listener
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'announcements' },
            (payload) => {
                const level = useAuthStore.getState().profile?.level;
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useAnnouncementStore.setState(s => ({
                        announcements: s.announcements.filter(a => a.id !== payload.old.id)
                    }));
                } else {
                    useAnnouncementStore.getState().fetchAnnouncements(level, true).catch(() => {});
                }
            }
        );

        // 7) Events listener
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'events' },
            (payload) => {
                const level = useAuthStore.getState().profile?.level;
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useEventStore.setState(s => ({
                        events: s.events.filter(e => e.id !== payload.old.id)
                    }));
                } else {
                    useEventStore.getState().fetchUpcomingEvents(level, true).catch(() => {});
                }
            }
        );

        // 8) Materials, Past Questions & Courses listeners
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'materials' },
            (payload) => {
                const level = useAuthStore.getState().profile?.level;
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useResourceStore.setState(s => ({
                        materials: s.materials.filter(m => m.id !== payload.old.id)
                    }));
                } else {
                    useResourceStore.getState().fetchMaterials({ level: level as any }, true).catch(() => {});
                }
            }
        );

        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'past_questions' },
            (payload) => {
                const level = useAuthStore.getState().profile?.level;
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useResourceStore.setState(s => ({
                        pastQuestions: s.pastQuestions.filter(p => p.id !== payload.old.id)
                    }));
                } else {
                    useResourceStore.getState().fetchPastQuestions({ level: level as any }, true).catch(() => {});
                }
            }
        );

        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'courses' },
            (payload) => {
                const level = useAuthStore.getState().profile?.level;
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useResourceStore.setState(s => ({
                        courses: s.courses.filter(c => c.id !== payload.old.id)
                    }));
                } else {
                    useResourceStore.getState().fetchCourses(level as any, true).catch(() => {});
                }
            }
        );

        // 9) Directory (Lecturers & Executives) listeners
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'lecturers' },
            (payload) => {
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useDirectoryStore.setState(s => ({
                        lecturers: s.lecturers.filter(l => l.id !== payload.old.id)
                    }));
                } else {
                    useDirectoryStore.getState().fetchLecturers(true).catch(() => {});
                }
            }
        );

        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'executives' },
            (payload) => {
                if (payload.eventType === 'DELETE' && payload.old?.id) {
                    useDirectoryStore.setState(s => ({
                        executives: s.executives.filter(e => e.id !== payload.old.id)
                    }));
                } else {
                    useDirectoryStore.getState().fetchExecutives(true).catch(() => {});
                }
            }
        );

        // 10) News & Archives listeners
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'news' },
            () => {
                try {
                    const { useNewsStore } = require('../stores/news.store');
                    useNewsStore.getState().fetchNews(true).catch(() => {});
                    useNewsStore.getState().fetchUnreadCount().catch(() => {});
                } catch {}
            }
        );

        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'archives' },
            () => {
                try {
                    const { useArchiveStore } = require('../stores/archive.store');
                    useArchiveStore.getState().fetchArchives(0, true).catch(() => {});
                    useArchiveStore.getState().fetchUnreadCount().catch(() => {});
                } catch {}
            }
        );

        // 11) In-App Notification History listener (scoped to current user)
        this.masterChannel.on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'notification_history',
                filter: `user_id=eq.${this.userId}`
            },
            (payload) => {
                const h = payload.new as any;
                if (payload.eventType === 'INSERT' && h && h.notification_id) {
                    useNotificationStore.getState().addNotification({
                        id: String(h.notification_id),
                        type: h.type || 'general',
                        title: h.title || 'New Notification',
                        message: h.body || '',
                        date: h.created_at || new Date().toISOString(),
                        isRead: Boolean(h.is_read),
                        data: h.data || {},
                    });
                } else if (payload.eventType === 'UPDATE' && h && h.notification_id && h.is_read) {
                    useNotificationStore.getState().markAsRead(String(h.notification_id));
                }
            }
        );

        // 12) Presence listener
        this.masterChannel.on(
            'presence',
            { event: 'sync' },
            () => {
                if (!this.masterChannel) return;
                const presenceState = this.masterChannel.presenceState();
                const onlineUserIds = new Set<string>();

                Object.values(presenceState).forEach((presences: any) => {
                    presences.forEach((p: any) => {
                        if (p.user_id) {
                            onlineUserIds.add(p.user_id);
                        }
                    });
                });

                this.presenceListeners.forEach(listeners => {
                    listeners.forEach(cb => cb(onlineUserIds));
                });
            }
        );

        this.masterChannel.subscribe(async (status) => {
            console.log(`[RealtimeManager] masterChannel status:`, status);
            if (status === 'SUBSCRIBED' && this.userId && this.masterChannel) {
                await this.masterChannel.track({
                    user_id: this.userId,
                    online_at: new Date().toISOString()
                });
            }
        });
    }

    // --- REGISTRATION APIS ---

    public registerChatListener(groupId: string, callback: (msg: any) => void): ListenerUnsubscribe {
        if (!this.chatListeners.has(groupId)) this.chatListeners.set(groupId, new Set());
        this.chatListeners.get(groupId)!.add(callback);

        return () => {
            const groupSet = this.chatListeners.get(groupId);
            if (groupSet) {
                groupSet.delete(callback);
                if (groupSet.size === 0) this.chatListeners.delete(groupId);
            }
        };
    }

    public registerGroupMetadataListener(groupId: string, callback: (group: any) => void): ListenerUnsubscribe {
        if (!this.groupMetadataListeners.has(groupId)) this.groupMetadataListeners.set(groupId, new Set());
        this.groupMetadataListeners.get(groupId)!.add(callback);

        return () => {
            const groupSet = this.groupMetadataListeners.get(groupId);
            if (groupSet) {
                groupSet.delete(callback);
                if (groupSet.size === 0) this.groupMetadataListeners.delete(groupId);
            }
        };
    }

    public registerGroupMembersListener(groupId: string, callback: (memberAction: any) => void): ListenerUnsubscribe {
        if (!this.groupMembersListeners.has(groupId)) this.groupMembersListeners.set(groupId, new Set());
        this.groupMembersListeners.get(groupId)!.add(callback);

        return () => {
            const groupSet = this.groupMembersListeners.get(groupId);
            if (groupSet) {
                groupSet.delete(callback);
                if (groupSet.size === 0) this.groupMembersListeners.delete(groupId);
            }
        };
    }

    public registerPresenceListener(groupId: string, callback: (onlineUserIds: Set<string>) => void): ListenerUnsubscribe {
        if (!this.presenceListeners.has(groupId)) this.presenceListeners.set(groupId, new Set());
        this.presenceListeners.get(groupId)!.add(callback);

        return () => {
            const groupSet = this.presenceListeners.get(groupId);
            if (groupSet) {
                groupSet.delete(callback);
                if (groupSet.size === 0) this.presenceListeners.delete(groupId);
            }
        };
    }

    public registerPoolListener(callback: (pool: any) => void): ListenerUnsubscribe {
        this.poolListeners.add(callback);
        return () => {
            this.poolListeners.delete(callback);
        };
    }

    public registerFeaturedListener(callback: (featured: any) => void): ListenerUnsubscribe {
        this.featuredListeners.add(callback);
        return () => {
            this.featuredListeners.delete(callback);
        };
    }

    // --- DISPATCHERS ---

    private dispatchIncomingMessage(payload: any) {
        const groupId = payload.new?.group_id || payload.old?.group_id;
        if (!groupId) return;

        const hasActiveListener = this.chatListeners.has(groupId) && this.chatListeners.get(groupId)!.size > 0;

        if (hasActiveListener) {
            this.chatListeners.get(groupId)!.forEach(cb => cb(payload));
        }

        if (payload.eventType === 'INSERT' && payload.new) {
            const { NotificationRouter } = require('../services/notificationRouter');
            const isFocusedGroup = NotificationRouter.getActiveChatGroupId() === groupId;
            const isOwnMessage = Boolean(this.userId && payload.new.sender_id === this.userId);

            if (!isFocusedGroup && !isOwnMessage) {
                useGroupStore.getState().incrementUnread(groupId, payload.new.content, payload.new.created_at, payload.new);
                this.triggerForegroundChatHeadsUp(groupId, payload.new);
            } else {
                useGroupStore.getState().updateGroupLastMessage(groupId, payload.new.content || '', payload.new.created_at, payload.new);
            }
            if (!hasActiveListener) {
                useMessageStore.getState().addMessage(groupId, { ...payload.new, status: 'sent' }).catch(console.error);
            }
        } else if (payload.eventType === 'UPDATE' && payload.new?.id) {
            if (payload.new.is_deleted) {
                useMessageStore.getState().removeMessage(groupId, payload.new.id);
                this.debouncedFetchGroups();
            } else {
                useMessageStore.getState().updateMessage(groupId, payload.new.id, {
                    content: payload.new.content,
                    is_edited: payload.new.is_edited,
                    isEdited: payload.new.is_edited,
                });
            }
        } else if (payload.eventType === 'DELETE' && payload.old?.id) {
            useMessageStore.getState().removeMessage(groupId, payload.old.id);
            this.debouncedFetchGroups();
        }
    }

    private triggerForegroundChatHeadsUp(groupId: string, msg: any) {
        try {
            if (!msg || !msg.sender_id || msg.sender_id === this.userId) return;
            if (AppState.currentState !== 'active') return;

            const { NotificationRouter } = require('../services/notificationRouter');
            if (NotificationRouter.getActiveChatGroupId() === groupId) return;
            if (msg.id && NotificationRouter.hasShownMessageNotification(msg.id)) return;

            const profile = useAuthStore.getState().profile;
            if (profile?.notif_enabled === false || profile?.notif_messages === false) return;
            const mutedGroups: string[] = profile?.muted_groups || [];
            if (mutedGroups.includes(groupId)) return;

            if (msg.id) {
                NotificationRouter.markMessageNotificationShown(msg.id);
            }

            const group = useGroupStore.getState().groups.find(g => g.id === groupId);
            const groupName = group?.name || 'Chat';

            const caption = msg.caption || msg.metadata?.caption || '';
            const docName = msg.metadata?.name || 'Document';
            let bodyText = msg.content || 'New message';
            if (msg.message_type === 'image') bodyText = `📷 ${caption || 'Photo'}`;
            else if (msg.message_type === 'video') bodyText = `🎥 ${caption || 'Video'}`;
            else if (msg.message_type === 'audio') bodyText = '🎵 Voice Message';
            else if (msg.message_type === 'file' || msg.message_type === 'document') bodyText = `📎 ${caption || docName}`;
            else if (msg.message_type === 'sticker') bodyText = '😊 Sticker';

            const isRemoteImage =
                msg.message_type === 'image' &&
                typeof msg.content === 'string' &&
                msg.content.startsWith('http');

            const Notifications = require('expo-notifications');
            Notifications.scheduleNotificationAsync({
                content: {
                    title: groupName,
                    body: bodyText.length > 100 ? bodyText.substring(0, 97) + '...' : bodyText,
                    sound: 'default',
                    priority: Notifications.AndroidNotificationPriority.MAX,
                    ...(isRemoteImage ? { attachments: [{ identifier: String(msg.id || 'img'), url: msg.content, type: 'image' }] } : {}),
                    data: {
                        type: 'message',
                        group_id: groupId,
                        id: msg.id,
                        ...(isRemoteImage ? { image_url: msg.content } : {}),
                        _localRealtime: true
                    }
                },
                trigger: { channelId: 'messages_v2' } as any
            }).catch(() => {});
        } catch (err) {
            console.warn('[RealtimeManager] Failed to trigger foreground chat heads-up:', err);
        }
    }

    private dispatchGroupChange(payload: any) {
        const groupRecord = payload.new || payload.old;
        if (!groupRecord?.id) return;

        if (payload.eventType === 'UPDATE' && payload.new) {
            const listeners = this.groupMetadataListeners.get(payload.new.id);
            if (listeners) {
                listeners.forEach(cb => cb(payload.new));
            }
            if (payload.new.is_active === false) {
                useGroupStore.setState(s => ({
                    groups: s.groups.filter(g => g.id !== payload.new.id)
                }));
            } else {
                useGroupStore.setState(s => ({
                    groups: s.groups.map(g =>
                        g.id === payload.new.id
                            ? {
                                ...g,
                                name: payload.new.name ?? g.name,
                                avatar_url: payload.new.avatar_url ?? g.avatar_url,
                                is_official: payload.new.is_official ?? g.is_official,
                                is_active: payload.new.is_active ?? g.is_active,
                                chat_enabled: payload.new.chat_enabled ?? g.chat_enabled,
                                allow_media: payload.new.allow_media ?? g.allow_media,
                              }
                            : g
                    )
                }));
            }
        } else if (payload.eventType === 'DELETE' && payload.old?.id) {
            useGroupStore.setState(s => ({
                groups: s.groups.filter(g => g.id !== payload.old.id)
            }));
        } else {
            this.debouncedFetchGroups();
        }
    }

    private dispatchGroupMemberChange(payload: any) {
        const groupId = payload.new?.group_id || payload.old?.group_id;
        if (!groupId) return;

        const listeners = this.groupMembersListeners.get(groupId);
        if (listeners) {
            listeners.forEach(cb => cb(payload));
        }

        if (payload.eventType === 'DELETE' && payload.old?.user_id === this.userId) {
            useGroupStore.setState(s => ({
                groups: s.groups.filter(g => g.id !== groupId)
            }));
        } else {
            this.debouncedFetchGroups();
        }
    }

    private dispatchPoolUpdate(payload: any) {
        if (payload.eventType === 'INSERT' && payload.new) {
            useEventPoolStore.setState(state => ({
                pools: [payload.new, ...state.pools.filter(p => p.id !== payload.new.id)]
            }));
            this.debouncedFetchPools();
        } else if (payload.eventType === 'UPDATE' && payload.new) {
            useEventPoolStore.setState(state => ({
                pools: state.pools.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
            }));
            const status = payload.new.status;
            const oldStatus = payload.old?.status;
            const resultsChanged = payload.new.result_published_at !== payload.old?.result_published_at;
            if (status === 'completed' || status === 'archived' || (oldStatus && status !== oldStatus) || resultsChanged) {
                this.debouncedFetchPools();
            }
        } else if (payload.eventType === 'DELETE' && payload.old) {
            useEventPoolStore.setState(state => ({
                pools: state.pools.filter(p => p.id !== payload.old.id)
            }));
        }

        this.poolListeners.forEach(cb => cb(payload));
    }

    private dispatchFeaturedUpdate(payload: any) {
        try {
            const { useFYBStore } = require('../stores/fyb.store');
            useFYBStore.getState().fetchFeatured(true).catch(() => {});
            useFYBStore.getState().fetchUnreadCount().catch(() => {});
        } catch {}
        this.featuredListeners.forEach(cb => cb(payload));
    }

    public cleanup() {
        this.clearBackgroundTimer();
        if (this.groupFetchTimer) {
            clearTimeout(this.groupFetchTimer);
            this.groupFetchTimer = null;
        }
        if (this.poolFetchTimer) {
            clearTimeout(this.poolFetchTimer);
            this.poolFetchTimer = null;
        }
        if (this.appStateSubscription) {
            this.appStateSubscription.remove();
            this.appStateSubscription = null;
        }
        if (this.unregisterOnline) {
            this.unregisterOnline();
            this.unregisterOnline = null;
        }
        if (this.masterChannel) {
            supabase.removeChannel(this.masterChannel);
            this.masterChannel = null;
        }
        this.userId = null;
    }
}

export const realtimeManager = new RealtimeManager();
