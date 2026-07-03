import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { Logger } from '../utils/logger';
import { supabase } from '../api/supabase/client';
import { uploadLocalFileToCloudinary } from '../lib/cloudinary';
import { useNetworkStore } from './network.store';
import { 
    initDB, 
    insertOrReplaceMessage, 
    updateLocalMessage, 
    deleteLocalMessage, 
    clearAllMessages, 
    updateLocalMediaPath,
    batchInsertMessages
} from '../lib/database';
import * as FileSystem from 'expo-file-system/legacy';

interface MessageCache {
    [groupId: string]: any[];
}

interface MessageState {
    cache: MessageCache;
    lastSeenAt: Record<string, string>;
    isLoading: boolean;
    error: string | null;

    initSQLiteCache: () => Promise<void>;
    setMessages: (groupId: string, messages: any[]) => Promise<void>;
    addMessage: (groupId: string, message: any) => Promise<void>;
    updateMessage: (groupId: string, messageId: string, updates: any) => void;
    removeMessage: (groupId: string, messageId: string) => void;
    getMessages: (groupId: string) => any[];
    clearCache: () => void;
    patchSenderInfo: (userId: string, updates: { username?: string; avatar_url?: string; full_name?: string }) => void;
    mergeMissedMessages: (groupId: string, missedMessages: any[]) => Promise<void>;
    touchLastSeen: (groupId: string, timestamp: string) => void;
    getLastSeenAt: (groupId: string) => string | null;

    uploadProgress: Record<string, number>;
    isFlushing: boolean;
    sendGroupMessage: (groupId: string, msgPayload: any, fileUri?: string) => Promise<void>;
    processUnifiedQueueItem: (groupId: string, msg: any) => Promise<void>;
    flushUnsentMessageQueue: () => Promise<void>;
    setUploadProgress: (messageId: string, progress: number) => void;
    editMessage: (messageId: string, groupId: string, newContent: string) => Promise<void>;
    softDeleteMessage: (messageId: string, groupId: string) => Promise<void>;
}

export const interceptAndDownloadMedia = async (message: any) => {
    if (!message.media_url || message.local_media_path) return message;
    
    // Skip if it's already a local file
    if (message.media_url.startsWith('file://')) {
        message.local_media_path = message.media_url;
        return message;
    }

    try {
        const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
        const assetType = `chat_${message.media_type || 'image'}`;
        const localUri = await UnifiedDownloadEngine.download(
            message.media_url,
            message.id,
            `media_${message.id}`,
            undefined,
            {
                assetType,
                messageId: message.id,
                groupId: message.group_id || null,
                mimeType: message.mime_type || null
            }
        );
        if (localUri) {
            message.local_media_path = localUri;
            await updateLocalMediaPath(message.id, message.local_media_path);
        }
    } catch (e) {
        Logger.error('message.store', 'Failed to intercept media for offline caching:', e);
    }
    return message;
};

export const useMessageStore = create<MessageState>()(
    persist(
        (set, get) => ({
            cache: {},
            lastSeenAt: {},
            isLoading: false,
            error: null,
            uploadProgress: {},
            isFlushing: false,

            initSQLiteCache: async () => {
                await initDB();
            },

            setMessages: async (groupId, messages) => {
                const cappedMessages = messages.slice(-300);
                const latest = cappedMessages.length > 0
                    ? cappedMessages[cappedMessages.length - 1]?.created_at
                    : null;

                // Redesign: Transactional sequential insertion to guarantee SQLite owns the message before state update
                const enhancedMessages: any[] = [];
                for (const msg of cappedMessages) {
                    const enhancedMsg = await interceptAndDownloadMedia(msg);
                    enhancedMessages.push(enhancedMsg);
                }
                await batchInsertMessages(enhancedMessages, groupId);

                set((state) => ({
                    cache: { ...state.cache, [groupId]: enhancedMessages },
                    lastSeenAt: latest
                        ? { ...state.lastSeenAt, [groupId]: latest }
                        : state.lastSeenAt,
                }));
            },

            addMessage: async (groupId, message) => {
                Logger.info('message.store', 'addMessage called', { groupId, messageId: message.id, status: message.status });
                
                const enhancedMsg = await interceptAndDownloadMedia(message);
                await insertOrReplaceMessage(enhancedMsg, groupId);

                set((state) => {
                    const existing = state.cache[groupId] || [];
                    if (existing.some(m => m.id === message.id)) {
                        Logger.warn('message.store', 'Duplicate message rejected', { groupId, messageId: message.id });
                        return state;
                    }

                    const updated = [...existing, enhancedMsg]
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                        .slice(-300);

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
                updateLocalMessage(messageId, updates);

                set((state) => {
                    const existing = state.cache[groupId] || [];
                    const updated = existing.map(m => m.id === messageId ? { ...m, ...updates } : m);
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
                deleteLocalMessage(messageId);

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

            clearCache: () => {
                clearAllMessages();
                set({ cache: {}, lastSeenAt: {} });
            },

            patchSenderInfo: (userId, updates) => {
                set((state) => {
                    const newCache: MessageCache = {};
                    for (const groupId of Object.keys(state.cache)) {
                        newCache[groupId] = state.cache[groupId].map(m => {
                            if (m.sender_id === userId) {
                                const patched = {
                                    ...m,
                                    user: { ...m.user, ...updates }
                                };
                                updateLocalMessage(m.id, { user: patched.user });
                                return patched;
                            }
                            return m;
                        });
                    }
                    return { cache: newCache };
                });
            },

            editMessage: async (messageId: string, groupId: string, newContent: string) => {
                const originalMsg = get().cache[groupId]?.find(m => m.id === messageId);
                const prevContent = originalMsg?.content;
                const prevEditedAt = originalMsg?.edited_at;

                const editedAt = new Date().toISOString();
                get().updateMessage(groupId, messageId, { content: newContent, edited_at: editedAt });

                try {
                    const { error } = await (supabase as any)
                        .from('messages')
                        .update({ content: newContent, edited_at: editedAt })
                        .eq('id', messageId);

                    if (error) throw error;
                } catch (err) {
                    Logger.error('message.store', 'Failed to edit message, rolling back optimistic state', err);
                    get().updateMessage(groupId, messageId, { content: prevContent, edited_at: prevEditedAt });
                }
            },

            softDeleteMessage: async (messageId: string, groupId: string) => {
                const originalMsg = get().cache[groupId]?.find(m => m.id === messageId);
                const prevContent = originalMsg?.content;
                const prevIsDeleted = originalMsg?.is_deleted;

                get().updateMessage(groupId, messageId, { content: '', is_deleted: true });

                try {
                    const { error } = await (supabase as any)
                        .rpc('soft_delete_message', { p_message_id: messageId });

                    if (error) throw error;
                } catch (err) {
                    Logger.error('message.store', 'Failed to soft delete message, rolling back optimistic state', err);
                    get().updateMessage(groupId, messageId, { content: prevContent, is_deleted: prevIsDeleted });
                }
            },

            mergeMissedMessages: async (groupId, missedMessages) => {
                if (!missedMessages.length) return;

                // Redesign: Transactional sequential insertion to guarantee SQLite owns the message before state update
                const enhancedMessages: any[] = [];
                for (const msg of missedMessages) {
                    const enhancedMsg = await interceptAndDownloadMedia(msg);
                    enhancedMessages.push(enhancedMsg);
                }
                await batchInsertMessages(enhancedMessages, groupId);

                set((state) => {
                    const existing = state.cache[groupId] || [];
                    const existingIds = new Set(existing.map(m => m.id));
                    const newOnes = enhancedMessages.filter(m => !existingIds.has(m.id));
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
                
                const localMsg = { 
                    ...msgPayload, 
                    id: tempId, 
                    status: isOnline ? 'sending' : 'unsent',
                    fileUri: fileUri
                };
                
                get().addMessage(groupId, localMsg);

                if (!isOnline) {
                    Logger.warn('message.store', 'Offline mode: Message queued locally as unsent', { tempId });
                    return;
                }

                try {
                    await get().processUnifiedQueueItem(groupId, localMsg);
                } catch (error) {
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

                const { data, error } = await (supabase as any).from('messages')
                    .insert([payload])
                    .select()
                    .single();

                if (error) throw error;

                get().updateMessage(groupId, msg.id, { id: (data as any).id, content: finalContentUrl, status: 'sent', fileUri: undefined });
            },

            flushUnsentMessageQueue: async () => {
                if (get().isFlushing) return;
                set({ isFlushing: true });

                const sleepHelper = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

                try {
                    Logger.info('message.store', 'Starting background flush of unsent messages...');
                    const allGroups = get().cache;
                    let attempt = 0;
                    
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
                                // Throttle successive sends
                                await sleepHelper(500);
                                attempt = 0; // reset retry counter on success
                            } catch (err: any) {
                                const isNetwork = err?.status === 0 || 
                                                  err?.message?.toLowerCase().includes('network') || 
                                                  err?.message?.toLowerCase().includes('failed to fetch');
                                
                                get().updateMessage(groupId, msg.id, { status: isNetwork ? 'unsent' : 'error' });
                                
                                if (isNetwork) {
                                    attempt++;
                                    const backoffDelay = Math.min(1500 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
                                    Logger.warn('message.store', `Network error flushing message, backoff delay: ${Math.round(backoffDelay)}ms`, { id: msg.id });
                                    await sleepHelper(backoffDelay);
                                    set({ isFlushing: false });
                                    return;
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
            partialize: (state) => ({
                cache: state.cache,
                lastSeenAt: state.lastSeenAt,
                uploadProgress: state.uploadProgress
            }),
        }
    )
);
