import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { Logger } from '../utils/logger';
import { supabase } from '../api/supabase/client';
import { uploadLocalFileToCloudinary } from '../lib/cloudinary';
import { useNetworkStore } from './network.store';
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

    // Offline Queue Architecture
    uploadProgress: Record<string, number>;
    isFlushing: boolean;
    sendGroupMessage: (groupId: string, msgPayload: any, fileUri?: string) => Promise<void>;
    processUnifiedQueueItem: (groupId: string, msg: any) => Promise<void>;
    flushUnsentMessageQueue: () => Promise<void>;
    setUploadProgress: (messageId: string, progress: number) => void;
}

export const useMessageStore = create<MessageState>()(
    persist(
        (set, get) => ({
            cache: {},
            lastSeenAt: {},
            isLoading: false,
            error: null,
            uploadProgress: {},
            isFlushing: false,

            // Store up to 300 messages per group to prevent AsyncStorage stringify crashes
            // and memory leaks on large, active groups.
            setMessages: (groupId, messages) => {
                const cappedMessages = messages.slice(-300);
                // Update lastSeenAt to the most recent message timestamp
                const latest = cappedMessages.length > 0
                    ? cappedMessages[cappedMessages.length - 1]?.created_at
                    : null;
                set((state) => ({
                    cache: { ...state.cache, [groupId]: cappedMessages },
                    lastSeenAt: latest
                        ? { ...state.lastSeenAt, [groupId]: latest }
                        : state.lastSeenAt,
                }));
            },

            addMessage: (groupId, message) => {
                Logger.info('message.store', 'addMessage called', { groupId, messageId: message.id, status: message.status });
                set((state) => {
                    const existing = state.cache[groupId] || [];
                    if (existing.some(m => m.id === message.id)) {
                        Logger.warn('message.store', 'Duplicate message rejected', { groupId, messageId: message.id });
                        return state;
                    }

                    const updated = [...existing, message]
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                        .slice(-300);

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

                    const merged = [...existing, ...newOnes]
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                        .slice(-300);

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

            setUploadProgress: (messageId, progress) => {
                set((state) => {
                    const next = { ...state.uploadProgress };
                    if (progress === 100 || progress < 0) {
                        delete next[messageId];
                    } else {
                        next[messageId] = progress;
                    }
                    return { uploadProgress: next };
                });
            },

            sendGroupMessage: async (groupId, msgPayload, fileUri) => {
                const { isOnline } = useNetworkStore.getState();
                const tempId = msgPayload.id || `temp-${Date.now()}`;
                
                // Construct the local message state with status
                const localMsg = { 
                    ...msgPayload, 
                    id: tempId, 
                    status: isOnline ? 'sending' : 'unsent',
                    fileUri: fileUri // Keep a reference to the local file for offline recovery
                };
                
                // Append instantly for zero-latency UX
                get().addMessage(groupId, localMsg);

                if (!isOnline) {
                    Logger.warn('message.store', 'Offline mode: Message queued locally as unsent', { tempId });
                    return;
                }

                try {
                    await get().processUnifiedQueueItem(groupId, localMsg);
                } catch (error) {
                    // Revert to unsent on true network failures, error otherwise
                    const isNetwork = (error as any)?.status === 0 || (error as any)?.message?.toLowerCase().includes('network');
                    get().updateMessage(groupId, tempId, { status: isNetwork ? 'unsent' : 'error' });
                }
            },

            processUnifiedQueueItem: async (groupId: string, msg: any) => {
                let finalContentUrl = msg.content;
                let payload = {
                    content: msg.content,
                    sender_id: msg.sender_id,
                    group_id: groupId,
                    reply_to_id: msg.reply_to_id || msg.replyTo?.id || null,
                    reply_from_meta: msg.reply_from_meta || null,
                    message_type: msg.message_type || 'text',
                    metadata: { ...msg.metadata, tempId: msg.id }
                };

                const isMediaMessage = msg.media_url || msg.fileUri;

                // Handle Cloudinary Media Upload first
                if (msg.message_type !== 'text' && msg.message_type !== 'sticker' && isMediaMessage) {
                    const type = msg.message_type;
                    const mimeType = type === 'image' ? 'image/jpeg'
                        : type === 'video' ? 'video/mp4'
                        : type === 'audio' ? 'audio/mpeg'
                        : 'application/octet-stream';
                    
                    const folder = type === 'image' ? 'chat-images'
                        : type === 'video' ? 'chat-videos'
                        : type === 'audio' ? 'chat-audios'
                        : 'chat-docs';

                    const uploadName = `${Date.now()}-${msg.metadata?.name || 'file'}`;
                    const localUri = msg.fileUri || msg.media_url;

                    finalContentUrl = await uploadLocalFileToCloudinary(
                        localUri,
                        uploadName,
                        folder,
                        mimeType,
                        (p) => get().setUploadProgress(msg.id, Math.min(Math.round(p), 99))
                    );

                    get().setUploadProgress(msg.id, 100);
                    msg.media_url = finalContentUrl;
                    msg.fileUri = undefined;
                    payload.content = finalContentUrl;
                }

                // Insert to Supabase DB
                const { data, error } = await (supabase as any).from('messages')
                    .insert([payload])
                    .select()
                    .single();

                if (error) throw error;

                // Confirm and map tempId to real DB id
                get().updateMessage(groupId, msg.id, { id: (data as any).id, content: finalContentUrl, status: 'sent', fileUri: undefined });
            },

            flushUnsentMessageQueue: async () => {
                if (get().isFlushing) return;
                set({ isFlushing: true });

                try {
                    Logger.info('message.store', 'Starting background flush of unsent messages...');
                    const allGroups = get().cache;
                    
                    for (const groupId of Object.keys(allGroups)) {
                        const unsentMessages = allGroups[groupId].filter(m => m.status === 'unsent');
                        if (unsentMessages.length === 0) continue;

                        Logger.info('message.store', `Flushing ${unsentMessages.length} unsent messages for group ${groupId}`);

                        for (const msg of unsentMessages) {
                            if (!useNetworkStore.getState().isOnline) {
                                Logger.warn('message.store', 'Network dropped mid-flush. Aborting queue.');
                                set({ isFlushing: false });
                                return;
                            }

                            get().updateMessage(groupId, msg.id, { status: 'sending' });

                            try {
                                await get().processUnifiedQueueItem(groupId, msg);
                            } catch (err: any) {
                                const isNetwork = err?.status === 0 || err?.message?.toLowerCase().includes('network');
                                get().updateMessage(groupId, msg.id, { status: isNetwork ? 'unsent' : 'error' });
                                if (isNetwork) {
                                    set({ isFlushing: false });
                                    return; // Halt entire loop
                                }
                            }
                        }
                    }
                } finally {
                    set({ isFlushing: false });
                }
            },
        }),
        {
            name: 'message-cache-storage',
            storage: createJSONStorage(() => mmkvStorage),
            // Persist ALL messages — no cap, no limit.
            // Every message ever received stays in MMKV indefinitely,
            // accessible offline forever, exactly like WhatsApp.
            partialize: (state) => ({
                cache: state.cache,
                lastSeenAt: state.lastSeenAt,
            }),
        }
    )
);
