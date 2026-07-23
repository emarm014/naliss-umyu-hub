import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { captureStoreError } from '../utils/sentry';

interface GroupState {
    groups: any[];
    membersCache: Record<string, any[]>;
    isLoading: boolean;
    error: string | null;
    lastFetched: string | null;
    currentTab: string | null;
    isBadgeCleared: boolean;

    fetchGroups: (force?: boolean) => Promise<void>;
    markGroupAsRead: (groupId: string) => Promise<void>;
    incrementUnread: (groupId: string, lastMessage?: string, lastMessageAt?: string, lastMessageObj?: any) => void;
    clearGroups: () => void;
    setGroupMembers: (groupId: string, members: any[]) => void;
    getGroupMembers: (groupId: string) => any[];
    setCurrentTab: (tab: string) => void;
    clearBadge: () => void;
}

const CACHE_TTL = Infinity; // No TTL â€” group list available offline indefinitely

export const useGroupStore = create<GroupState>()(
    persist(
        (set, get) => ({
            groups: [],
            membersCache: {},
            isLoading: false,
            error: null,
            lastFetched: null,
            currentTab: null,
            isBadgeCleared: true,

            fetchGroups: async (force = false) => {
                const { lastFetched, groups } = get();
                const isFresh = lastFetched && Date.now() - new Date(lastFetched).getTime() < CACHE_TTL && groups.length > 0;
                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && groups.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('groups');
                        if (cached.length > 0) {
                            set({ groups: cached as any, isLoading: false });
                            // Prevent background sync if we have local data, as requested by user
                            return;
                        }
                    } catch { /* fall through to server fetch */ }
                }

                // Silent refresh if we still have no data
                if (get().groups.length === 0) set({ isLoading: true });

                // OFFLINE GUARD: if offline, data from SQLite is already displayed
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session?.user) { set({ isLoading: false }); return; }

                    const { useAuthStore } = require('./auth.store');
                    const profile = useAuthStore.getState().profile;
                    const isStaff = profile?.role === 'super_admin' || profile?.role === 'moderator';

                    let groupIds: string[] = [];

                    if (isStaff) {
                        // Staff can see all active groups
                        const { data: allGroups } = await (supabase as any).from('groups')
                            .select('id')
                            .eq('is_active', true);
                        if (allGroups) groupIds = allGroups.map((g: any) => g.id);
                    } else {
                        // 1. Get groups the student is a member of
                        const { data: memberships, error: memError } = await ((supabase as any).from('group_members')
                            .select('group_id')
                            .eq('user_id', session.user.id) as any);

                        if (memError) throw memError;
                        groupIds = (memberships || []).map((m: any) => m.group_id);

                        // Auto-repair missing default groups for students (Department and Level groups)
                        let orQuery = 'group_type.eq.department';
                        if (profile?.level) {
                            orQuery += `,and(group_type.eq.level,level.eq.${profile.level})`;
                        }

                        const { data: defaultGroups } = await (supabase as any).from('groups')
                            .select('id')
                            .eq('is_active', true)
                            .or(orQuery);
                        
                        if (defaultGroups) {
                            const missingToJoin = defaultGroups.filter((g: any) => !groupIds.includes(g.id));
                            if (missingToJoin.length > 0) {
                                try {
                                    // Silently try to insert them into the missing groups
                                    await (supabase as any).from('group_members').insert(
                                        missingToJoin.map((g: any) => ({ group_id: g.id, user_id: session.user.id, role: 'member' }))
                                    );
                                    missingToJoin.forEach((g: any) => groupIds.push(g.id));
                                } catch (e) {
                                    // Ignore RLS errors if any, just push the IDs so they can at least try to load them
                                    missingToJoin.forEach((g: any) => groupIds.push(g.id));
                                }
                            }
                        }
                    }

                    if (groupIds.length === 0) {
                        set({ groups: [], isLoading: false, lastFetched: new Date().toISOString() });
                        return;
                    }

                    // 2. Fetch group details and unread counts in parallel
                    const [groupsResult, unreadResult] = await Promise.all([
                        (supabase as any).from('groups')
                            .select('id, name, group_type, level, is_official, is_active, avatar_url, created_at')
                            .in('id', groupIds)
                            .eq('is_active', true)
                            .order('name') as any,
                        (supabase as any).rpc('get_group_unread_counts', { p_user_id: session.user.id }) as any
                    ]);

                    if (groupsResult.error) throw groupsResult.error;

                    // Fetch last message per group using parallel safe .limit(1) queries
                    // This prevents downloading the entire database history
                    const lastMsgMap: Record<string, any> = {};
                    
                    if (groupIds.length > 0) {
                        const lastMsgPromises = groupIds.map(async (gId: string) => {
                            try {
                                const res = await (supabase as any).from('messages')
                                    .select('id, group_id, content, content_type, message_type, created_at, sender:users!messages_sender_id_fkey(username, full_name)')
                                    .eq('group_id', gId)
                                    .eq('is_deleted', false)
                                    .order('created_at', { ascending: false })
                                    .limit(1)
                                    .maybeSingle();
                                return res;
                            } catch (err: any) {
                                return { data: null, error: err };
                            }
                        });
                        
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
                            if (msgType === 'image') lastMessageText = `${senderName}: ðŸ“· Photo`;
                            else if (msgType === 'document') lastMessageText = `${senderName}: ðŸ“Ž Document`;
                            else if (msgType === 'video') lastMessageText = `${senderName}: ðŸŽ¥ Video`;
                            else if (msgType === 'audio') lastMessageText = `${senderName}: ðŸŽµ Audio`;
                            else if (msgType === 'sticker') lastMessageText = `${senderName}: ðŸ˜Š Sticker`;
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
                            last_message_obj: lastMsg,
                            last_message_at: lastMsg ? lastMsg.created_at : null,
                            unread_count: unreadMap[group.id] || 0,
                        };
                    });

                    // Cache to SQLite for local-first reads
                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('groups', processed, session.user.id).catch(() => {});
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
                // Optimistic update â€” instant UI feedback
                set((state) => ({
                    groups: state.groups.map(g => 
                        g.id === groupId ? { ...g, unread_count: 0 } : g
                    )
                }));
                try {
                    await (supabase as any).rpc('mark_group_as_read', { p_group_id: groupId });
                } catch {
                    // silent â€” read marking is non-critical
                }
            },

            // Increment unread count for a group when a new message arrives
            // Called by globalSync when a message INSERT is detected
            incrementUnread: (groupId: string, lastMessage?: string, lastMessageAt?: string, lastMessageObj?: any) => {
                set((state) => {
                    const isMessagesTab = state.currentTab === 'messages' || state.currentTab?.includes('messages') || state.currentTab?.includes('chat') || state.currentTab === 'CHAT';
                    return {
                        isBadgeCleared: isMessagesTab ? true : false,
                        groups: state.groups.map(g =>
                            g.id === groupId
                                ? {
                                    ...g,
                                    unread_count: (g.unread_count || 0) + 1,
                                    ...(lastMessage ? { last_message: lastMessage } : {}),
                                    ...(lastMessageAt ? { last_message_at: lastMessageAt } : {}),
                                    ...(lastMessageObj ? { last_message_obj: lastMessageObj } : {}),
                                  }
                                : g
                        )
                    };
                });
            },

            setCurrentTab: (tab: string) => {
                const isMessagesTab = tab === 'messages' || tab.includes('messages') || tab.includes('chat') || tab === 'CHAT';
                set({
                    currentTab: tab,
                    ...(isMessagesTab ? { isBadgeCleared: true } : {})
                });
            },

            clearBadge: () => set({ isBadgeCleared: true }),
        }),
        {
            name: 'group-store',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                // Persist groups so they load instantly on boot without waiting for SQLite
                groups: state.groups,
                lastFetched: state.lastFetched,
                isBadgeCleared: state.isBadgeCleared
            }),
        }
    )
);
