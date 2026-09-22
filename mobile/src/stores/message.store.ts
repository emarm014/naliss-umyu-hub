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
import { AssetPathResolver } from '../utils/assetResolver';
import { normalizeError } from '../utils/sentry';

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
    resetStuckMessages: () => void;
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
            undefined,
            assetType
        );
        if (localUri) {
            message.local_media_path = localUri;
            await updateLocalMediaPath(message.id, message.local_media_path);
            // Track download for cross-device restore
            try {
                const { DownloadTracker } = require('../services/downloadTracker.service');
                DownloadTracker.recordDownload(message.id, assetType, message.media_url);
            } catch {}
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
                const latest = messages.length > 0
                    ? messages[messages.length - 1]?.created_at
                    : null;

                // Preserve existing local_media_path from memory cache so server refreshes never clear it
                const existingCache = get().cache[groupId] || [];
                const localMediaMap = new Map<string, string>();
                for (const m of existingCache) {
                    if (m?.id && m.local_media_path) {
                        localMediaMap.set(m.id, m.local_media_path);
                    }
                }

                const preservedMessages = messages.map(msg => {
                    if (msg?.id && !msg.local_media_path && localMediaMap.has(msg.id)) {
                        return { ...msg, local_media_path: localMediaMap.get(msg.id) };
                    }
                    return msg;
                });

                // 1. Update in-memory Zustand cache IMMEDIATELY so UI renders with zero latency
                set((state) => ({
                    cache: { ...state.cache, [groupId]: preservedMessages },
                    lastSeenAt: latest
                        ? { ...state.lastSeenAt, [groupId]: latest }
                        : state.lastSeenAt,
                }));

                // 2. Persist to SQLite in background
                await batchInsertMessages(preservedMessages, groupId);

                // 3. Process media downloads sequentially in the background without blocking the UI
                setTimeout(async () => {
                    for (const msg of messages) {
                        if (msg.media_url && !msg.local_media_path) {
                            await interceptAndDownloadMedia(msg);
                        }
                    }
                }, 500);
            },

            addMessage: async (groupId, message) => {
                Logger.info('message.store', 'addMessage called', { groupId, messageId: message.id, status: message.status });
                
                // 1. Update in-memory Zustand cache IMMEDIATELY so UI reflects optimistic message with 0ms delay
                set((state) => {
                    const existing = state.cache[groupId] || [];
                    if (existing.some(m => m.id === message.id)) {
                        Logger.warn('message.store', 'Duplicate message rejected', { groupId, messageId: message.id });
                        return state;
                    }

                    const updated = [...existing, message]
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

                    const isConfirmed = message.id && !String(message.id).startsWith('temp-');

                    return {
                        cache: { ...state.cache, [groupId]: updated },
                        lastSeenAt: isConfirmed && message.created_at
                            ? { ...state.lastSeenAt, [groupId]: message.created_at }
                            : state.lastSeenAt,
                    };
                });

                // 2. Persist to SQLite
                try {
                    await insertOrReplaceMessage(message, groupId);
                } catch (e) {
                    Logger.error('message.store', 'Failed to persist message to SQLite', { groupId, messageId: message.id, error: e });
                }

                // 3. Process media in background if it's already a remote URL
                if (message.media_url && !message.local_media_path) {
                    setTimeout(() => interceptAndDownloadMedia(message), 100);
                }

                // 4. Update group last message preview instantly (online, offline, or pending)
                try {
                    const { useGroupStore } = require('./group.store');
                    const { useAuthStore } = require('./auth.store');
                    const profile = useAuthStore.getState().profile;
                    
                    const senderId = message.sender_id || message.sender?.id;
                    const isSelf = (senderId && profile?.id && senderId === profile.id) || !senderId;
                    const senderName = isSelf ? 'You' : (message.sender?.username || message.sender?.full_name || 'Member');
                    
                    const msgType = message.content_type || message.message_type || 'text';
                    const content = message.content || '';
                    let previewText = `${senderName}: ${content}`;

                    if (msgType === 'image') previewText = `${senderName}: 📷 Photo`;
                    else if (msgType === 'document') previewText = `${senderName}: 📎 Document`;
                    else if (msgType === 'video') previewText = `${senderName}: 🎥 Video`;
                    else if (msgType === 'audio') previewText = `${senderName}: 🎵 Audio`;
                    else if (msgType === 'sticker') previewText = `${senderName}: 😊 Sticker`;
                    else if (content.includes('cloudinary.com') || content.includes('res.cloudinary')) {
                        const lower = content.toLowerCase();
                        if (lower.includes('/video/upload/') || lower.includes('chat-videos')) previewText = `${senderName}: 🎥 Video`;
                        else if (lower.includes('/image/upload/') || lower.includes('chat-images')) previewText = `${senderName}: 📷 Photo`;
                        else if (lower.includes('chat-docs')) previewText = `${senderName}: 📎 Document`;
                        else if (lower.includes('chat-audios')) previewText = `${senderName}: 🎵 Audio`;
                    }

                    useGroupStore.getState().updateGroupLastMessage(groupId, previewText, message.created_at, message);
                } catch {
                    // silent
                }
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
                get().updateMessage(groupId, messageId, { content: newContent, edited_at: editedAt, is_edited: true, isEdited: true });

                try {
                    const { error } = await (supabase as any)
                        .from('messages')
                        .update({ content: newContent, edited_at: editedAt, is_edited: true })
                        .eq('id', messageId);

                    if (error) throw normalizeError(error);
                } catch (err) {
                    Logger.error('message.store', 'Failed to edit message, rolling back optimistic state', err);
                    // Fix: Only rollback if we have the original values
                    if (prevContent !== undefined) {
                        get().updateMessage(groupId, messageId, { content: prevContent, edited_at: prevEditedAt, is_edited: originalMsg?.is_edited, isEdited: originalMsg?.isEdited });
                    }
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

                    if (error) throw normalizeError(error);
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
                let payload: any = {
                    content: msg.content,
                    sender_id: msg.sender_id,
                    group_id: groupId,
                    reply_to_id: msg.reply_to_id || msg.replyTo?.id || null,
                    reply_from_meta: msg.reply_from_meta || null,
                    message_type: msg.message_type || 'text',
                    metadata: { 
                        ...msg.metadata, 
                        caption: msg.caption || msg.metadata?.caption || null,
                        tempId: msg.id 
                    }
                };

                const isMediaMessage = msg.message_type !== 'text' && msg.message_type !== 'sticker';
                const localUri = msg.fileUri || (typeof msg.content === 'string' && (msg.content.startsWith('file://') || msg.content.startsWith('/')) ? msg.content : null);

                if (isMediaMessage && localUri) {
                    const type = msg.message_type;
                    const mimeType = type === 'image' ? 'image/jpeg'
                        : type === 'video' ? 'video/mp4'
                        : type === 'audio' ? 'audio/mpeg'
                        : 'application/octet-stream';
                    
                    const folder = type === 'image' ? 'chat-images'
                        : type === 'video' ? 'chat-videos'
                        : type === 'audio' ? 'chat-audios'
                        : 'chat-docs';

                    const originalName = msg.metadata?.name || `${type}-${Date.now()}`;
                    const uploadName = `${Date.now()}-${originalName}`;

                    finalContentUrl = await uploadLocalFileToCloudinary(
                        localUri,
                        uploadName,
                        folder,
                        mimeType,
                        (p) => get().setUploadProgress(msg.id, Math.min(Math.round(p), 99))
                    );

                    get().setUploadProgress(msg.id, 100);
                    msg.media_url = finalContentUrl;
                    payload.content = finalContentUrl;
                }

                const { data, error } = await (supabase as any).from('messages')
                    .insert([payload])
                    .select()
                    .single();

                if (error) throw normalizeError(error);

                const realId = (data as any).id;
                let localMediaPath = msg.local_media_path || null;

                // After successful upload + insert, save local copy to vault for offline access
                if (!localMediaPath && localUri && localUri.startsWith('file://')) {
                    try {
                        const assetType = `chat_${msg.message_type || 'image'}`;
                        const vaultPath = AssetPathResolver.resolveLocalPath(realId, assetType, finalContentUrl);
                        await FileSystem.makeDirectoryAsync(
                            vaultPath.substring(0, vaultPath.lastIndexOf('/')),
                            { intermediates: true }
                        );
                        await FileSystem.copyAsync({ from: localUri, to: vaultPath });
                        localMediaPath = vaultPath;
                        await updateLocalMediaPath(realId, localMediaPath);
                    } catch (e) {
                        Logger.warn('message.store', 'Failed to persist local media copy to vault', { id: realId, error: e });
                    }
                }

                const updates: any = { 
                    id: realId, 
                    content: finalContentUrl, 
                    status: 'sent', 
                    created_at: (data as any).created_at,
                    fileUri: undefined 
                };
                if (localMediaPath) {
                    updates.local_media_path = localMediaPath;
                }
                if (msg.caption) {
                    updates.caption = msg.caption;
                }
                get().updateMessage(groupId, msg.id, updates);
            },

            resetStuckMessages: () => {
                const allGroups = get().cache;
                let stuckCount = 0;
                for (const groupId of Object.keys(allGroups)) {
                    for (const msg of allGroups[groupId]) {
                        if (msg.status === 'sending') {
                            get().updateMessage(groupId, msg.id, { status: 'unsent' });
                            stuckCount++;
                        }
                    }
                }
                if (stuckCount > 0) {
                    Logger.info('message.store', `Reset ${stuckCount} stuck sending messages to unsent`);
                }
            },

            flushUnsentMessageQueue: async () => {
                if (get().isFlushing) return;
                set({ isFlushing: true });

                const sleepHelper = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                const MAX_RETRIES = 5;

                try {
                    Logger.info('message.store', 'Starting background flush of unsent messages...');
                    const allGroups = get().cache;
                    
                    for (const groupId of Object.keys(allGroups)) {
                        const unsentMessages = allGroups[groupId].filter(m => 
                            (m.status === 'unsent' || m.status === 'sending' || m.status === 'error' || m.status === 'failed') &&
                            (String(m.id).startsWith('temp-') || m.status === 'unsent')
                        );
                        if (unsentMessages.length === 0) continue;

                        Logger.info('message.store', `Flushing ${unsentMessages.length} unsent messages for group ${groupId}`);

                        for (const msg of unsentMessages) {
                            if (!useNetworkStore.getState().isOnline) {
                                Logger.warn('message.store', 'Network dropped mid-flush. Aborting queue.');
                                set({ isFlushing: false });
                                return;
                            }

                            let retries = 0;
                            let success = false;

                            while (!success && retries <= MAX_RETRIES) {
                                get().updateMessage(groupId, msg.id, { status: 'sending' });

                                try {
                                    await get().processUnifiedQueueItem(groupId, msg);
                                    await sleepHelper(500);
                                    success = true;
                                } catch (err: any) {
                                    const isNetwork = err?.status === 0 || 
                                                      err?.message?.toLowerCase().includes('network') || 
                                                      err?.message?.toLowerCase().includes('failed to fetch');
                                    
                                    if (isNetwork) {
                                        retries++;
                                        if (retries > MAX_RETRIES) {
                                            get().updateMessage(groupId, msg.id, { status: 'unsent' });
                                            Logger.warn('message.store', `Gave up flushing message after ${MAX_RETRIES} retries`, { id: msg.id });
                                            break;
                                        }
                                        const backoffDelay = Math.min(1500 * Math.pow(2, retries) + Math.random() * 1000, 30000);
                                        Logger.warn('message.store', `Network error flushing message, retry ${retries}/${MAX_RETRIES}, delay: ${Math.round(backoffDelay)}ms`, { id: msg.id });
                                        await sleepHelper(backoffDelay);
                                    } else {
                                        get().updateMessage(groupId, msg.id, { status: 'error' });
                                        Logger.error('message.store', 'Non-network error flushing message', { id: msg.id, error: err });
                                        break;
                                    }
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
