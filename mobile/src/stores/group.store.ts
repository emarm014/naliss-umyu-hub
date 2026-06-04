import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';
import { captureStoreError } from '../utils/sentry';

interface GroupState {
    groups: any[];
    membersCache: Record<string, any[]>;
    isLoading: boolean;
    error: string | null;
    lastFetched: string | null;

    fetchGroups: (force?: boolean) => Promise<void>;
    markGroupAsRead: (groupId: string) => Promise<void>;
    incrementUnread: (groupId: string, lastMessage?: string, lastMessageAt?: string) => void;
    clearGroups: () => void;
    setGroupMembers: (groupId: string, members: any[]) => void;
    getGroupMembers: (groupId: string) => any[];
}

const CACHE_TTL = Infinity; // No TTL — group list available offline indefinitely

export const useGroupStore = create<GroupState>()(
    persist(
        (set, get) => ({
            groups: [],
            membersCache: {},
            isLoading: false,
            error: null,
            lastFetched: null,

            fetchGroups: async (force = false) => {
                const { lastFetched, groups } = get();
                const isFresh = lastFetched && Date.now() - new Date(lastFetched).getTime() < CACHE_TTL && groups.length > 0;
                if (!force && isFresh) return;

                // OFFLINE GUARD: serve cached data immediately
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                // Silent refresh if we already have groups
                if (groups.length === 0) set({ isLoading: true });

                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session?.user) { set({ isLoading: false }); return; }

                    // 1. Get groups the user is a member of
                    const { data: memberships, error: memError } = await (supabase
                        .from('group_members')
                        .select('group_id')
                        .eq('user_id', session.user.id) as any);

                    if (memError) throw memError;
                    const groupIds = (memberships as any[]).map(m => m.group_id);

                    if (groupIds.length === 0) {
                        set({ groups: [], isLoading: false, lastFetched: new Date().toISOString() });
                        return;
                    }

                    // 2. Fetch group details and unread counts in parallel
                    const [groupsResult, unreadResult] = await Promise.all([
                        supabase
                            .from('groups')
                            .select('id, name, group_type, level, is_official, is_active, avatar_url, created_at')
                            .in('id', groupIds)
                            .eq('is_active', true)
                            .order('name') as any,
                        supabase.rpc('get_group_unread_counts', { p_user_id: session.user.id }) as any
                    ]);

                    if (groupsResult.error) throw groupsResult.error;

                    // Fetch last message per group using parallel safe .limit(1) queries
                    // This prevents downloading the entire database history
                    const lastMsgMap: Record<string, any> = {};
                    
                    if (groupIds.length > 0) {
                        const lastMsgPromises = groupIds.map(gId => 
                            supabase
                                .from('messages')
                                .select('id, group_id, content, content_type, message_type, created_at, sender:users!messages_sender_id_fkey(username, full_name)')
                                .eq('group_id', gId)
                                .eq('is_deleted', false)
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .maybeSingle()
                        );
                        
                        const lastMsgResults = await Promise.all(lastMsgPromises);
                        lastMsgResults.forEach((res) => {
                            if (res.data) {
                                lastMsgMap[(res.data as any).group_id] = res.data;
                            }
                        });
                    }

                    const unreadMap: Record<string, number> = {};
                    if (!unreadResult.error && unreadResult.data) {
                        (unreadResult.data as any[]).forEach((row: any) => {
                            unreadMap[row.group_id] = Number(row.unread_count) || 0;
                        });
                    }

                    const processed = ((groupsResult.data || []) as any[]).map(group => {
                        const lastMsg = lastMsgMap[group.id] || null;
                        let lastMessageText = 'No messages yet';
                        if (lastMsg) {
                            const senderName = lastMsg.sender?.username || lastMsg.sender?.full_name || 'user';
                            const msgType = lastMsg.content_type || lastMsg.message_type || 'text';
                            if (msgType === 'image') lastMessageText = `${senderName}: 📷 Photo`;
                            else if (msgType === 'document') lastMessageText = `${senderName}: 📎 Document`;
                            else if (msgType === 'video') lastMessageText = `${senderName}: 🎥 Video`;
                            else if (msgType === 'audio') lastMessageText = `${senderName}: 🎵 Audio`;
                            else if (msgType === 'sticker') lastMessageText = `${senderName}: 😊 Sticker`;
                            else lastMessageText = `${senderName}: ${lastMsg.content || ''}`;
                        }
                        return {
                            id: group.id,
                            name: group.name,
                            group_type: group.group_type,
                            level: group.level,
                            is_official: group.is_official,
                            is_direct: false,
                            avatar_url: group.avatar_url,
                            last_message: lastMsg ? lastMessageText : null,
                            last_message_at: lastMsg ? lastMsg.created_at : null,
                            unread_count: unreadMap[group.id] || 0,
                        };
                    });

                    set({ groups: processed, isLoading: false, lastFetched: new Date().toISOString() });
                } catch (err: unknown) {
                    captureStoreError('group', 'fetchGroups', err);
                    set({ isLoading: false, error: (err as Error)?.message || 'Failed to load groups.' });
                }
            },

            clearGroups: () => set({ groups: [], membersCache: {}, lastFetched: null }),

            setGroupMembers: (groupId: string, members: any[]) => {
                set((state) => ({
                    membersCache: {
                        ...state.membersCache,
                        [groupId]: members,
                    },
                }));
            },

            getGroupMembers: (groupId: string) => {
                return get().membersCache[groupId] || [];
            },

            markGroupAsRead: async (groupId: string) => {
                // Optimistic update — instant UI feedback
                set((state) => ({
                    groups: state.groups.map(g => 
                        g.id === groupId ? { ...g, unread_count: 0 } : g
                    )
                }));
                try {
                    await supabase.rpc('mark_group_as_read', { p_group_id: groupId });
                } catch {
                    // silent — read marking is non-critical
                }
            },

            // Increment unread count for a group when a new message arrives
            // Called by globalSync when a message INSERT is detected
            incrementUnread: (groupId: string, lastMessage?: string, lastMessageAt?: string) => {
                set((state) => ({
                    groups: state.groups.map(g =>
                        g.id === groupId
                            ? {
                                ...g,
                                unread_count: (g.unread_count || 0) + 1,
                                ...(lastMessage ? { last_message: lastMessage } : {}),
                                ...(lastMessageAt ? { last_message_at: lastMessageAt } : {}),
                              }
                            : g
                    )
                }));
            },
        }),
        {
            name: 'group-storage',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                groups: state.groups,
                membersCache: state.membersCache,
                lastFetched: state.lastFetched,
            }),
        }
    )
);
