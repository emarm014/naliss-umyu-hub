import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface MessageCache {
    [groupId: string]: any[];
}

interface MessageState {
    cache: MessageCache;
    // Tracks the timestamp of the last message seen per group
    // Used for miss-recovery: fetch messages that arrived while offline
    lastSeenAt: Record<string, string>;
    isLoading: boolean;
    error: string | null;

    setMessages: (groupId: string, messages: any[]) => void;
    addMessage: (groupId: string, message: any) => void;
    updateMessage: (groupId: string, messageId: string, updates: any) => void;
    removeMessage: (groupId: string, messageId: string) => void;
    getMessages: (groupId: string) => any[];
    // WARNING: clearCache wipes ALL messages for ALL groups from AsyncStorage.
    // Only call this on explicit user sign-out. Never call during signup cleanup,
    // navigation, or any other lifecycle event.
    clearCache: () => void;
    patchSenderInfo: (userId: string, updates: { username?: string; avatar_url?: string; full_name?: string }) => void;
    // Merge missed messages (arrived while offline) into existing cache
    mergeMissedMessages: (groupId: string, missedMessages: any[]) => void;
    // Update the last-seen timestamp for a group
    touchLastSeen: (groupId: string, timestamp: string) => void;
    getLastSeenAt: (groupId: string) => string | null;
}

export const useMessageStore = create<MessageState>()(
    persist(
        (set, get) => ({
            cache: {},
            lastSeenAt: {},
            isLoading: false,
            error: null,

            // Store ALL messages — no cap, no limit.
            // Every message ever sent stays in the cache indefinitely.
            setMessages: (groupId, messages) => {
                // Update lastSeenAt to the most recent message timestamp
                const latest = messages.length > 0
                    ? messages[messages.length - 1]?.created_at
                    : null;
                set((state) => ({
                    cache: { ...state.cache, [groupId]: messages },
                    lastSeenAt: latest
                        ? { ...state.lastSeenAt, [groupId]: latest }
                        : state.lastSeenAt,
                }));
            },

            addMessage: (groupId, message) => {
                set((state) => {
                    const existing = state.cache[groupId] || [];
                    if (existing.some(m => m.id === message.id)) return state;

                    const updated = [...existing, message].sort((a, b) =>
                        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    );

                    // Only update lastSeenAt from confirmed server messages (real UUIDs).
                    // Temp messages use device-clock timestamps which may be ahead of the
                    // server — storing them as lastSeenAt would cause miss-recovery to skip
                    // real messages that arrived in that window.
                    const isConfirmed = message.id && !String(message.id).startsWith('temp-');

                    return {
                        cache: { ...state.cache, [groupId]: updated },
                        lastSeenAt: isConfirmed && message.created_at
                            ? { ...state.lastSeenAt, [groupId]: message.created_at }
                            : state.lastSeenAt,
                    };
                });
            },

            updateMessage: (groupId, messageId, updates) => {
                set((state) => {
                    const existing = state.cache[groupId] || [];
                    const updated = existing.map(m => m.id === messageId ? { ...m, ...updates } : m);
                    // If the id changed (temp → real), re-sort to keep chronological order
                    const needsSort = updates.id && updates.id !== messageId;
                    return {
                        cache: {
                            ...state.cache,
                            [groupId]: needsSort
                                ? updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                                : updated,
                        }
                    };
                });
            },

            removeMessage: (groupId, messageId) => {
                set((state) => {
                    const existing = state.cache[groupId] || [];
                    return {
                        cache: {
                            ...state.cache,
                            [groupId]: existing.filter(m => m.id !== messageId),
                        }
                    };
                });
            },

            getMessages: (groupId) => {
                return get().cache[groupId] || [];
            },

            // WARNING: Only call on explicit user sign-out.
            // Calling this during signup cleanup, navigation, or any other
            // lifecycle event will permanently delete all offline messages.
            clearCache: () => set({ cache: {}, lastSeenAt: {} }),

            patchSenderInfo: (userId, updates) => {
                set((state) => {
                    const newCache: MessageCache = {};
                    for (const groupId of Object.keys(state.cache)) {
                        newCache[groupId] = state.cache[groupId].map(m => {
                            if (m.sender_id !== userId) return m;
                            return {
                                ...m,
                                user: m.user ? { ...m.user, ...updates } : m.user,
                            };
                        });
                    }
                    return { cache: newCache };
                });
            },

            // Merge messages that arrived while the user was offline.
            // Deduplicates by ID, preserves chronological order.
            mergeMissedMessages: (groupId, missedMessages) => {
                if (!missedMessages.length) return;
                set((state) => {
                    const existing = state.cache[groupId] || [];
                    const existingIds = new Set(existing.map(m => m.id));
                    const newOnes = missedMessages.filter(m => !existingIds.has(m.id));
                    if (!newOnes.length) return state;

                    const merged = [...existing, ...newOnes].sort((a, b) =>
                        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    );

                    const latest = merged[merged.length - 1]?.created_at;
                    return {
                        cache: { ...state.cache, [groupId]: merged },
                        lastSeenAt: latest
                            ? { ...state.lastSeenAt, [groupId]: latest }
                            : state.lastSeenAt,
                    };
                });
            },

            touchLastSeen: (groupId, timestamp) => {
                set((state) => ({
                    lastSeenAt: { ...state.lastSeenAt, [groupId]: timestamp },
                }));
            },

            getLastSeenAt: (groupId) => {
                return get().lastSeenAt[groupId] || null;
            },
        }),
        {
            name: 'message-cache-storage',
            storage: createJSONStorage(() => AsyncStorage),
            // Persist ALL messages — no cap, no limit.
            // Every message ever received stays in AsyncStorage indefinitely,
            // accessible offline forever, exactly like WhatsApp.
            partialize: (state) => ({
                cache: state.cache,
                lastSeenAt: state.lastSeenAt,
            }),
        }
    )
);
