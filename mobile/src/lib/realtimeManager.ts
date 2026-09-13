import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../../src/api/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useGroupStore } from '../../src/stores/group.store';
import { useMessageStore } from '../../src/stores/message.store';
import { useEventPoolStore } from '../../src/stores/event-pool.store';

type ListenerUnsubscribe = () => void;

class RealtimeManager {
    private masterChannel: RealtimeChannel | null = null;
    private userId: string | null = null;
    private appStateSubscription: any = null;

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
    }

    private handleAppStateChange = (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            if (this.masterChannel && this.masterChannel.state !== 'joined') {
                console.log('[RealtimeManager] Reconnecting channel due to AppState active');
                this.masterChannel.unsubscribe();
                this.masterChannel.subscribe(async (status) => {
                    if (status === 'SUBSCRIBED' && this.userId) {
                        await this.masterChannel!.track({
                            user_id: this.userId,
                            online_at: new Date().toISOString()
                        });
                    }
                });
            }
        }
    };

    private setupMasterChannel() {
        if (!this.userId) return;

        this.masterChannel = supabase.channel(`mobile_master_${this.userId}`, {
            config: { broadcast: { self: false } }
        });

        // 1) Messages listener
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'messages' },
            (payload) => {
                this.dispatchIncomingMessage(payload);
            }
        );

        // 2) Groups listener (metadata changes)
        this.masterChannel.on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'groups' },
            (payload) => {
                this.dispatchGroupMetadata(payload.new);
            }
        );

        // 3) Group Members listener (joins/leaves)
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'group_members' },
            (payload) => {
                this.dispatchGroupMemberChange(payload);
            }
        );

        // 4) Admin Activities & Event Pools listener
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'event_pools' },
            (payload) => {
                this.dispatchPoolUpdate(payload);
            }
        );

        // 5) Featured Students listener (Home Screen)
        this.masterChannel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'featured_students' },
            (payload) => {
                this.dispatchFeaturedUpdate(payload);
            }
        );

        // 6) Presence listener
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
                
                // Dispatch to all presence listeners
                this.presenceListeners.forEach(listeners => {
                    listeners.forEach(cb => cb(onlineUserIds));
                });
            }
        );

        this.masterChannel.subscribe(async (status) => {
            console.log(`[RealtimeManager] masterChannel status:`, status);
            if (status === 'SUBSCRIBED' && this.userId) {
                await this.masterChannel!.track({
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
            // Forward message payload to active screen
            this.chatListeners.get(groupId)!.forEach(cb => cb(payload));
        } 
        
        // Background sync: If INSERT, cache and update badges globally
        if (payload.eventType === 'INSERT' && payload.new) {
            if (!hasActiveListener) {
                useGroupStore.getState().incrementUnread(groupId, payload.new.content, payload.new.created_at, payload.new);
            }
            // Pre-append to local MMKV cache to avoid zero network delay later
            useMessageStore.getState().addMessage(groupId, payload.new).catch(console.error);
        }
    }

    private dispatchGroupMetadata(groupPayload: any) {
        if (!groupPayload?.id) return;
        const listeners = this.groupMetadataListeners.get(groupPayload.id);
        if (listeners) {
            listeners.forEach(cb => cb(groupPayload));
        }
    }

    private dispatchGroupMemberChange(payload: any) {
        const groupId = payload.new?.group_id || payload.old?.group_id;
        if (!groupId) return;
        const listeners = this.groupMembersListeners.get(groupId);
        if (listeners) {
            listeners.forEach(cb => cb(payload));
        }
    }

    private dispatchPoolUpdate(payload: any) {
        // Auto-update event pool store
        if (payload.eventType === 'INSERT' && payload.new) {
            useEventPoolStore.setState(state => ({
                pools: [payload.new, ...state.pools]
            }));
        } else if (payload.eventType === 'UPDATE' && payload.new) {
            useEventPoolStore.setState(state => ({
                pools: state.pools.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
            }));
        } else if (payload.eventType === 'DELETE' && payload.old) {
            useEventPoolStore.setState(state => ({
                pools: state.pools.filter(p => p.id !== payload.old.id)
            }));
        }

        // Notify UI hooks
        this.poolListeners.forEach(cb => cb(payload));
    }

    private dispatchFeaturedUpdate(payload: any) {
        this.featuredListeners.forEach(cb => cb(payload));
    }

    public cleanup() {
        if (this.appStateSubscription) {
            this.appStateSubscription.remove();
            this.appStateSubscription = null;
        }
        if (this.masterChannel) {
            supabase.removeChannel(this.masterChannel);
            this.masterChannel = null;
        }
        this.userId = null;
    }
}

export const realtimeManager = new RealtimeManager();
