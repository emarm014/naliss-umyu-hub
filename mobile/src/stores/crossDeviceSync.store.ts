import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { supabase } from '../api/supabase/client';
import { mmkvStorage } from './mmkv.storage';
import { Logger } from '../utils/logger';
import { useAuthStore } from './auth.store';
import { useNetworkStore } from './network.store';
import { useMessageStore } from './message.store';
import * as FileSystem from 'expo-file-system/legacy';
import {
    initDB,
    upsertMediaManifest,
    getMediaManifest,
    getAllPendingMediaManifests,
    updateMediaSyncJob,
    getMaxTimestampByGroup,
    batchInsertMessages,
    getSyncCheckpoint,
    updateSyncCheckpoint,
    upsertContentManifest,
    getContentManifestsByType,
    upsertSyncJournal,
    getLastJournalEntry,
    getMediaByContentHash,
    incrementReferenceCount,
    decrementReferenceCount,
    indexEntity
} from '../lib/database';

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function base64ToBinary(base64: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
    }
    
    let bufferLength = base64.length * 0.75;
    if (base64[base64.length - 1] === '=') {
        bufferLength--;
        if (base64[base64.length - 2] === '=') {
            bufferLength--;
        }
    }
    
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < base64.length; i += 4) {
        const encoded1 = lookup[base64.charCodeAt(i)];
        const encoded2 = lookup[base64.charCodeAt(i + 1)];
        const encoded3 = lookup[base64.charCodeAt(i + 2)];
        const encoded4 = lookup[base64.charCodeAt(i + 3)];
        
        const bytes1 = (encoded1 << 2) | (encoded2 >> 4);
        const bytes2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        const bytes3 = ((encoded3 & 3) << 6) | encoded4;
        
        bytes[p++] = bytes1;
        if (p < bufferLength) bytes[p++] = bytes2;
        if (p < bufferLength) bytes[p++] = bytes3;
    }
    
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
}

export function calculateSHA256(str: string): string {
    const chrsz = 8;
    
    function safe_add(x: number, y: number): number {
        const lsw = (x & 0xFFFF) + (y & 0xFFFF);
        const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    }
    
    function S(X: number, n: number): number { return (X >>> n) | (X << (32 - n)); }
    function R(X: number, n: number): number { return (X >>> n); }
    function Ch(x: number, y: number, z: number): number { return ((x & y) ^ ((~x) & z)); }
    function Maj(x: number, y: number, z: number): number { return ((x & y) ^ (x & z) ^ (y & z)); }
    function Sigma0256(x: number): number { return (S(x, 2) ^ S(x, 13) ^ S(x, 22)); }
    function Sigma1256(x: number): number { return (S(x, 6) ^ S(x, 11) ^ S(x, 25)); }
    function Gamma0256(x: number): number { return (S(x, 7) ^ S(x, 18) ^ R(x, 3)); }
    function Gamma1256(x: number): number { return (S(x, 17) ^ S(x, 19) ^ R(x, 10)); }
    
    const K = [
        0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
        0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
        0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
        0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
        0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
        0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
        0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
        0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
    ];
    
    const blocks: number[] = [];
    for (let i = 0; i < str.length * chrsz; i += chrsz) {
        blocks[i >> 5] |= (str.charCodeAt(i / chrsz) & 0xFF) << (24 - i % 32);
    }
    
    const N = str.length * chrsz;
    blocks[N >> 5] |= 0x80 << (24 - N % 32);
    blocks[(((N + 64) >> 9) << 4) + 15] = N;
    
    let H0 = 0x6A09E667;
    let H1 = 0xBB67AE85;
    let H2 = 0x3C6EF372;
    let H3 = 0xA54FF53A;
    let H4 = 0x510E527F;
    let H5 = 0x9B05688C;
    let H6 = 0x1F83D9AB;
    let H7 = 0x5BE0CD19;
    
    const W = new Array(64);
    for (let i = 0; i < blocks.length; i += 16) {
        let a = H0;
        let b = H1;
        let c = H2;
        let d = H3;
        let e = H4;
        let f = H5;
        let g = H6;
        let h = H7;
        
        for (let t = 0; t < 64; t++) {
            if (t < 16) {
                W[t] = blocks[i + t] || 0;
            } else {
                W[t] = safe_add(
                    safe_add(Gamma1256(W[t - 2]), W[t - 7]),
                    safe_add(Gamma0256(W[t - 15]), W[t - 16])
                );
            }
            
            const T1 = safe_add(
                safe_add(h, Sigma1256(e)),
                safe_add(Ch(e, f, g), safe_add(K[t], W[t]))
            );
            const T2 = safe_add(Sigma0256(a), Maj(a, b, c));
            
            h = g;
            g = f;
            f = e;
            e = safe_add(d, T1);
            d = c;
            c = b;
            b = a;
            a = safe_add(T1, T2);
        }
        
        H0 = safe_add(a, H0);
        H1 = safe_add(b, H1);
        H2 = safe_add(c, H2);
        H3 = safe_add(d, H3);
        H4 = safe_add(e, H4);
        H5 = safe_add(f, H5);
        H6 = safe_add(g, H6);
        H7 = safe_add(h, H7);
    }
    
    const shaVal = [H0, H1, H2, H3, H4, H5, H6, H7];
    let hexStr = '';
    for (let i = 0; i < shaVal.length; i++) {
        const val = shaVal[i];
        for (let j = 3; j >= 0; j--) {
            const b = (val >> (j * 8)) & 0xFF;
            hexStr += (b < 16 ? '0' : '') + b.toString(16);
        }
    }
    return hexStr;
}

const PRIORITY_MAP: Record<string, number> = {
    'user_avatar': 10,
    'group_avatar': 20,
    'image': 30,
    'pdf': 40,
    'voice_note': 50,
    'document': 60,
    'video': 70,
    'archive': 80
};

interface SyncJobState {
    job_id: string;
    total_files: number;
    completed: number;
    failed: number;
    progress: number;
    status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
}

interface CrossDeviceSyncState {
    deviceId: string | null;
    downloadPolicy: 'everything' | 'wifi' | 'charging' | 'recent' | 'manual';
    syncJob: SyncJobState | null;
    isInitialized: boolean;
    isSyncing: boolean;

    initialize: () => void;
    setDownloadPolicy: (policy: 'everything' | 'wifi' | 'charging' | 'recent' | 'manual') => void;
    startSync: (force?: boolean) => Promise<void>;
    _downloadQueue: () => Promise<void>;
}

export const useCrossDeviceSyncStore = create<CrossDeviceSyncState>()(
    persist(
        (set, get) => ({
            deviceId: null,
            downloadPolicy: 'everything',
            syncJob: null,
            isInitialized: false,
            isSyncing: false,

            initialize: () => {
                if (get().isInitialized) return;
                
                if (!get().deviceId) {
                    set({ deviceId: generateUUID() });
                }

                // Register network status callback to trigger sync resumes
                const { registerOnlineCallback } = require('./network.store');
                registerOnlineCallback(() => {
                    Logger.info('cross-device-sync', 'Network connected. Resuming bootstrap synchronization.');
                    get().startSync(true).catch((err) => console.error('[CrossDeviceSync] online resume failed:', err));
                });

                // AppState foreground transitions
                AppState.addEventListener('change', (nextState: AppStateStatus) => {
                    if (nextState === 'active' && useNetworkStore.getState().isOnline) {
                        get().startSync(false).catch((err) => console.error('[CrossDeviceSync] foreground sync failed:', err));
                    }
                });

                // Trigger startup synchronization in the background
                get().startSync(false).catch((err) => console.error('[CrossDeviceSync] startup sync failed:', err));
                set({ isInitialized: true });
            },

            setDownloadPolicy: (policy) => {
                set({ downloadPolicy: policy });
            },

            startSync: async (force = false) => {
                if (Platform.OS === 'web') return;
                if (get().isSyncing && !force) return;

                const authStore = useAuthStore.getState();
                if (!authStore.user) return;

                if (!useNetworkStore.getState().isOnline) {
                    Logger.info('cross-device-sync', 'Offline â€” sync deferred');
                    set({ isSyncing: false });
                    return;
                }

                set({ isSyncing: true });
                Logger.info('cross-device-sync', 'Bootstrap Sync Started. Initializing checkpoint runner.');

                try {
                    await initDB();
                    const userId = authStore.user.id;
                    const deviceId = get().deviceId || 'unknown';
                    const checkpointId = `${deviceId}_${userId}`;

                    // Fetch or create checkpoint
                    let checkpoint = await getSyncCheckpoint(deviceId, userId);
                    if (!checkpoint) {
                        await updateSyncCheckpoint(checkpointId, {
                            stage_groups: 0,
                            stage_messages: 0,
                            stage_announcements: 0,
                            stage_events: 0,
                            stage_materials: 0,
                            stage_past_questions: 0,
                            stage_courses: 0,
                            stage_lecturers: 0,
                            stage_executives: 0,
                            stage_avatars: 0,
                            stage_media: 0,
                            bootstrap_completed: 0
                        });
                        checkpoint = await getSyncCheckpoint(deviceId, userId);
                    }

                    // ----------------------------------------------------
                    // Stage 1: Groups + memberships
                    // ----------------------------------------------------
                    if (checkpoint.stage_groups === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 1/12: Syncing groups');
                        const { data: memberships, error: memError } = await ((supabase as any).from('group_members')
                            .select('group_id')
                            .eq('user_id', userId) as any);

                        if (memError) throw memError;
                        const groupIds = (memberships || []).map((m: any) => m.group_id);

                        if (groupIds.length > 0) {
                            const { data: groupsResult, error: grpError } = await ((supabase as any).from('groups')
                                .select('id, name, group_type, level, is_official, is_active, avatar_url, created_at, updated_at')
                                .in('id', groupIds)
                                .eq('is_active', true) as any);

                            if (grpError) throw grpError;

                            const { useGroupStore } = require('./group.store');
                            useGroupStore.setState({ groups: groupsResult });

                            // Save groups to content manifest
                            for (const group of groupsResult) {
                                await upsertContentManifest({
                                    content_type: 'group',
                                    content_id: group.id,
                                    user_id: userId,
                                    raw_data: group,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_groups: 1, last_completed_stage: 'groups' });
                        checkpoint.stage_groups = 1;
                    }

                    // Get group ids for subsequent stages
                    const localGroups = await getContentManifestsByType('group');
                    const groupIds = localGroups.map(g => g.content_id);

                    // ----------------------------------------------------
                    // Stage 2: User profiles (Sender metadata cache)
                    // ----------------------------------------------------
                    if (checkpoint.stage_avatars === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 2/12: Syncing users');
                        const { data: usersResult, error: usrError } = await ((supabase as any).from('users')
                            .select('id, username, full_name, avatar_url, level, role') as any);

                        if (!usrError && usersResult) {
                            for (const user of usersResult) {
                                await upsertContentManifest({
                                    content_type: 'user_profile',
                                    content_id: user.id,
                                    user_id: userId,
                                    raw_data: user,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_avatars: 1, last_completed_stage: 'users' });
                        checkpoint.stage_avatars = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 3: Messages (Differential sync)
                    // ----------------------------------------------------
                    if (checkpoint.stage_messages === 0 && groupIds.length > 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 3/12: Syncing messages');
                        for (const groupId of groupIds) {
                            const lastLocalTimestamp = await getMaxTimestampByGroup(groupId);
                            
                            let query = (supabase as any).from('messages')
                                .select(`
                                    *,
                                    user:users!messages_sender_id_fkey(id, username, full_name, avatar_url, level, role),
                                    reply_to_message:messages!reply_to_id(id, content, message_type, is_deleted, user:users!messages_sender_id_fkey(username, full_name))
                                `)
                                .eq('group_id', groupId)
                                .eq('is_deleted', false);

                            if (lastLocalTimestamp) {
                                query = query.gt('created_at', lastLocalTimestamp);
                            }

                            query = query.order('created_at', { ascending: true }).limit(500);
                            const { data: serverMsgs, error: msgsError } = await (query as any);

                            if (msgsError) {
                                Logger.error('cross-device-sync', `Failed to sync group ${groupId}`, msgsError);
                                continue;
                            }

                            if (serverMsgs && serverMsgs.length > 0) {
                                const formatted = (serverMsgs as any[]).map(msg => ({
                                    ...msg,
                                    isEdited: msg.is_edited || false,
                                    replyTo: msg.reply_to_message ? {
                                        id: msg.reply_to_message.id,
                                        username: msg.reply_to_message.user?.username,
                                        full_name: msg.reply_to_message.user?.full_name,
                                        content_type: msg.reply_to_message.message_type,
                                        content: msg.reply_to_message.content?.substring(0, 50),
                                        is_deleted: msg.reply_to_message.is_deleted
                                    } : null,
                                    status: 'sent',
                                    isOnline: false
                                }));

                                await batchInsertMessages(formatted, groupId);

                                // Update Zustand store messages cache
                                const messageStore = useMessageStore.getState();
                                const existing = messageStore.getMessages(groupId);
                                const existingIds = new Set(existing.map(m => m.id));
                                const newOnes = formatted.filter(m => !existingIds.has(m.id));
                                if (newOnes.length > 0) {
                                    const merged = [...existing, ...newOnes]
                                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                                    messageStore.setMessages(groupId, merged);
                                }

                                 // Queue attachment manifests and index messages
                                 for (const msg of formatted) {
                                     // Index for FTS5 offline search
                                     const senderName = msg.user?.username || msg.user?.full_name || 'Member';
                                     await indexEntity(msg.id, 'message', {
                                         group_id: groupId,
                                         sender_name: senderName,
                                         content: msg.content,
                                         created_at: msg.created_at
                                     });

                                     const isMedia = msg.media_url || (msg.content && msg.content.startsWith('http') && ['image', 'video', 'document', 'audio'].includes(msg.message_type));
                                    if (isMedia) {
                                        const fileUrl = msg.media_url || msg.content;
                                        const ext = fileUrl.split('.').pop()?.split('?')[0] || 'tmp';
                                        const type = msg.message_type || 'image';
                                        
                                        const fs = FileSystem as any;
                                        const docDir = fs.Paths?.document?.uri || fs.documentDirectory || fs.cacheDirectory || '';
                                        const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
                                        
                                        let subFolder = 'chat_media/';
                                        if (type === 'audio') subFolder = 'voice_notes/';
                                        else if (type === 'video') subFolder = 'videos/';
                                        else if (type === 'document') subFolder = 'documents/';
                                        
                                        const localFolder = `${base}naliss_vault/${subFolder}`;
                                        const localPath = `${localFolder}media_${msg.id}.${ext}`;
                                        
                                        const priority = PRIORITY_MAP[type] || 50;

                                        await upsertMediaManifest({
                                            id: msg.id,
                                            message_id: msg.id,
                                            user_id: userId,
                                            group_id: groupId,
                                            file_url: fileUrl,
                                            local_path: localPath,
                                            media_type: type,
                                            mime_type: msg.metadata?.mime_type || null,
                                            file_size: msg.metadata?.size || 0,
                                            sha256: msg.metadata?.sha256 || null,
                                            downloaded: 0,
                                            verified: 0,
                                            sync_version: 1,
                                            device_id: deviceId,
                                            priority: priority,
                                            reference_count: 1
                                        });
                                    }
                                }
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_messages: 1, last_completed_stage: 'messages' });
                        checkpoint.stage_messages = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 4: Announcements
                    // ----------------------------------------------------
                    if (checkpoint.stage_announcements === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 4/12: Syncing announcements');
                        const { data: serverAnnouncements, error: annError } = await ((supabase as any).from('announcements')
                            .select('*')
                            .eq('is_published', true) as any);

                        if (!annError && serverAnnouncements) {
                            const { useAnnouncementStore } = require('./announcement.store');
                            useAnnouncementStore.setState({ announcements: serverAnnouncements });
                            for (const ann of serverAnnouncements) {
                                await upsertContentManifest({
                                    content_type: 'announcement',
                                    content_id: ann.id,
                                    user_id: userId,
                                    raw_data: ann,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                                await indexEntity(ann.id, 'announcement', {
                                    content: ann.content,
                                    caption: ann.title,
                                    created_at: ann.created_at
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_announcements: 1, last_completed_stage: 'announcements' });
                        checkpoint.stage_announcements = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 5: Events
                    // ----------------------------------------------------
                    if (checkpoint.stage_events === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 5/12: Syncing events');
                        const { data: serverEvents, error: evtError } = await ((supabase as any).from('events')
                            .select('*, event_pools(id)')
                            .in('status', ['published', 'ongoing']) as any);

                        if (!evtError && serverEvents) {
                            const { useEventStore } = require('./event.store');
                            useEventStore.setState({ events: serverEvents });
                            for (const evt of serverEvents) {
                                await upsertContentManifest({
                                    content_type: 'event',
                                    content_id: evt.id,
                                    user_id: userId,
                                    raw_data: evt,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                                await indexEntity(evt.id, 'event', {
                                    content: evt.description,
                                    caption: evt.title,
                                    created_at: evt.created_at
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_events: 1, last_completed_stage: 'events' });
                        checkpoint.stage_events = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 6: Materials (Study resources)
                    // ----------------------------------------------------
                    if (checkpoint.stage_materials === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 6/12: Syncing study materials');
                        const { data: serverMaterials, error: matError } = await ((supabase as any).from('materials')
                            .select('*')
                            .eq('is_active', true) as any);

                        if (!matError && serverMaterials) {
                            const { useResourceStore } = require('./resource.store');
                            useResourceStore.setState({ materials: serverMaterials });
                            for (const mat of serverMaterials) {
                                await upsertContentManifest({
                                    content_type: 'material',
                                    content_id: mat.id,
                                    user_id: userId,
                                    raw_data: mat,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                                await indexEntity(mat.id, 'material', {
                                    content: mat.description,
                                    caption: mat.title,
                                    file_name: mat.file_name,
                                    created_at: mat.created_at
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_materials: 1, last_completed_stage: 'materials' });
                        checkpoint.stage_materials = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 7: Past Questions
                    // ----------------------------------------------------
                    if (checkpoint.stage_past_questions === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 7/12: Syncing past questions');
                        const { data: serverQuestions, error: qError } = await ((supabase as any).from('past_questions')
                            .select('*, course:course_id(*)')
                            .eq('is_public', true) as any);

                        if (!qError && serverQuestions) {
                            const { useResourceStore } = require('./resource.store');
                            useResourceStore.setState({ pastQuestions: serverQuestions });
                            for (const q of serverQuestions) {
                                await upsertContentManifest({
                                    content_type: 'past_question',
                                    content_id: q.id,
                                    user_id: userId,
                                    raw_data: q,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_past_questions: 1, last_completed_stage: 'past_questions' });
                        checkpoint.stage_past_questions = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 8: Courses
                    // ----------------------------------------------------
                    if (checkpoint.stage_courses === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 8/12: Syncing courses');
                        const { data: serverCourses, error: cError } = await ((supabase as any).from('courses')
                            .select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)')
                            .eq('is_active', true) as any);

                        if (!cError && serverCourses) {
                            const { useResourceStore } = require('./resource.store');
                            useResourceStore.setState({ courses: serverCourses });
                            for (const c of serverCourses) {
                                await upsertContentManifest({
                                    content_type: 'course',
                                    content_id: c.id,
                                    user_id: userId,
                                    raw_data: c,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_courses: 1, last_completed_stage: 'courses' });
                        checkpoint.stage_courses = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 9: Lecturers
                    // ----------------------------------------------------
                    if (checkpoint.stage_lecturers === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 9/12: Syncing lecturers directory');
                        const { data: serverLecturers, error: lecError } = await ((supabase as any).from('lecturers')
                            .select('*')
                            .eq('is_active', true) as any);

                        if (!lecError && serverLecturers) {
                            const { useDirectoryStore } = require('./directory.store');
                            useDirectoryStore.setState({ lecturers: serverLecturers });
                            for (const lec of serverLecturers) {
                                await upsertContentManifest({
                                    content_type: 'lecturer',
                                    content_id: lec.id,
                                    user_id: userId,
                                    raw_data: lec,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_lecturers: 1, last_completed_stage: 'lecturers' });
                        checkpoint.stage_lecturers = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 10: Executives
                    // ----------------------------------------------------
                    if (checkpoint.stage_executives === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 10/12: Syncing executives directory');
                        const { data: serverExecutives, error: execError } = await ((supabase as any).from('executives')
                            .select('*, user:users(full_name, avatar_url)')
                            .eq('is_active', true) as any);

                        if (!execError && serverExecutives) {
                            const { useDirectoryStore } = require('./directory.store');
                            useDirectoryStore.setState({ executives: serverExecutives });
                            for (const exec of serverExecutives) {
                                await upsertContentManifest({
                                    content_type: 'executive',
                                    content_id: exec.id,
                                    user_id: userId,
                                    raw_data: exec,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }
                        await updateSyncCheckpoint(checkpointId, { stage_executives: 1, last_completed_stage: 'executives' });
                        checkpoint.stage_executives = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 11: Build avatar & attachment downloads manifest
                    // ----------------------------------------------------
                    if (checkpoint.stage_avatars === 1 && checkpoint.stage_media === 0) {
                        Logger.info('cross-device-sync', 'Bootstrap Stage 11/12: Gathering system assets and avatars');
                        
                        const fs = FileSystem as any;
                        const docDir = fs.Paths?.document?.uri || fs.documentDirectory || fs.cacheDirectory || '';
                        const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
                        const localFolder = `${base}naliss_vault/avatars/`;

                        // Add group avatars
                        const dbGroups = await getContentManifestsByType('group');
                        for (const g of dbGroups) {
                            const url = g.raw_data?.avatar_url;
                            if (url && url.startsWith('http')) {
                                const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
                                await upsertMediaManifest({
                                    id: `group_avatar_${g.content_id}`,
                                    message_id: null,
                                    user_id: userId,
                                    group_id: g.content_id,
                                    file_url: url,
                                    local_path: `${localFolder}avatar_group_${g.content_id}.${ext}`,
                                    media_type: 'group_avatar',
                                    priority: PRIORITY_MAP['group_avatar'],
                                    downloaded: 0,
                                    verified: 0,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }

                        // Add user profile avatars
                        const dbUsers = await getContentManifestsByType('user_profile');
                        for (const u of dbUsers) {
                            const url = u.raw_data?.avatar_url;
                            if (url && url.startsWith('http')) {
                                const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
                                await upsertMediaManifest({
                                    id: `user_avatar_${u.content_id}`,
                                    message_id: null,
                                    user_id: userId,
                                    group_id: null,
                                    file_url: url,
                                    local_path: `${localFolder}avatar_user_${u.content_id}.${ext}`,
                                    media_type: 'user_avatar',
                                    priority: PRIORITY_MAP['user_avatar'],
                                    downloaded: 0,
                                    verified: 0,
                                    sync_version: 1,
                                    device_id: deviceId
                                });
                            }
                        }

                        await updateSyncCheckpoint(checkpointId, { stage_media: 1, last_completed_stage: 'media_manifest_done' });
                        checkpoint.stage_media = 1;
                    }

                    // ----------------------------------------------------
                    // Stage 12: Media Sync Job queue start
                    // ----------------------------------------------------
                    Logger.info('cross-device-sync', 'Bootstrap Stage 12/12: Commencing download queue processing');
                    await updateSyncCheckpoint(checkpointId, { bootstrap_completed: 1, last_completed_stage: 'completed' });
                    
                    // Trigger download queue
                    await get()._downloadQueue();

                } catch (e) {
                    Logger.error('cross-device-sync', 'SQLite Transaction Failed during checkpoint sync', e);
                } finally {
                    set({ isSyncing: false });
                }
            },

            _downloadQueue: async () => {
                const pending = await getAllPendingMediaManifests();
                if (pending.length === 0) {
                    Logger.info('cross-device-sync', 'All media attachments are synchronized and fully offline.');
                    return;
                }

                // Sort pending items by priority (lower priority number first, e.g. avatars)
                pending.sort((a, b) => (a.priority || 50) - (b.priority || 50));

                const authStore = useAuthStore.getState();
                const userId = authStore.user?.id || 'unknown';
                const deviceId = get().deviceId || 'unknown';
                const jobId = generateUUID();

                const jobState: SyncJobState = {
                    job_id: jobId,
                    total_files: pending.length,
                    completed: 0,
                    failed: 0,
                    progress: 0,
                    status: 'running'
                };

                set({ syncJob: jobState });
                await updateMediaSyncJob({
                    job_id: jobId,
                    user_id: userId,
                    device_id: deviceId,
                    total_files: pending.length,
                    completed: 0,
                    failed: 0,
                    pending: pending.length,
                    progress: 0,
                    status: 'running'
                });

                const CONCURRENCY_LIMIT = 3;
                let activeCount = 0;
                let currentIndex = 0;

                const next = async () => {
                    if (currentIndex >= pending.length) return;
                    
                    // Check network status before starting new download
                    if (!useNetworkStore.getState().isOnline) {
                        Logger.warn('cross-device-sync', 'Network connection offline. Pausing synchronization.');
                        return;
                    }

                    // Enforce policy constraints
                    const policy = get().downloadPolicy;
                    if (policy === 'wifi') {
                        const Network = require('expo-network');
                        if (useNetworkStore.getState().networkType !== Network.NetworkStateType.WIFI) {
                            Logger.warn('cross-device-sync', 'Wi-Fi Only policy active. Pausing downloads.');
                            return;
                        }
                    }

                    const item = pending[currentIndex++];
                    activeCount++;

                    try {
                        const localFolder = item.local_path.substring(0, item.local_path.lastIndexOf('/') + 1);
                        const dirInfo = await FileSystem.getInfoAsync(localFolder);
                        if (!dirInfo.exists) {
                            await FileSystem.makeDirectoryAsync(localFolder, { intermediates: true });
                        }

                        // Write to crash recovery journal
                        await upsertSyncJournal({
                            device_id: deviceId,
                            user_id: userId,
                            stage: 'downloading',
                            entity_id: item.id,
                            status: 'in_progress',
                            total_bytes: item.file_size || 0
                        });

                        // Enhancement #11: Deduplication Check
                        if (item.sha256) {
                            const duplicate = await getMediaByContentHash(item.sha256);
                            if (duplicate && duplicate.downloaded) {
                                // Re-use already downloaded physical file
                                await upsertMediaManifest({
                                    ...item,
                                    local_path: duplicate.local_path,
                                    downloaded: 1,
                                    verified: 1,
                                    last_verified_at: new Date().toISOString(),
                                    content_hash: item.sha256
                                });
                                await incrementReferenceCount(duplicate.id);
                                Logger.info('cross-device-sync', `Deduplication match: Reusing local file for ${item.id}`);
                                
                                jobState.completed++;
                                activeCount--;
                                const totalProcessed = jobState.completed + jobState.failed;
                                jobState.progress = Math.round((totalProcessed / jobState.total_files) * 100);
                                set({ syncJob: { ...jobState } });
                                
                                await upsertSyncJournal({
                                    device_id: deviceId,
                                    user_id: userId,
                                    stage: 'downloading',
                                    entity_id: item.id,
                                    status: 'completed'
                                });
                                await next();
                                return;
                            }
                        }

                        // Consolidated download through UnifiedDownloadEngine
                        const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
                        const localUri = await UnifiedDownloadEngine.download(
                            item.file_url,
                            item.id,
                            undefined,
                            `chat_${item.media_type || 'file'}`
                        );

                        if (!localUri) {
                            throw new Error(`UnifiedDownloadEngine failed for file ${item.id}`);
                        }

                        jobState.completed++;
                        Logger.info('cross-device-sync', `Media Downloaded & Verified: ${item.id}`);

                        await upsertSyncJournal({
                            device_id: deviceId,
                            user_id: userId,
                            stage: 'downloading',
                            entity_id: item.id,
                            status: 'completed'
                        });

                    } catch (e) {
                        jobState.failed++;
                        Logger.error('cross-device-sync', `Failed to download attachment ${item.id}`, e);
                        
                        await upsertSyncJournal({
                            device_id: deviceId,
                            user_id: userId,
                            stage: 'downloading',
                            entity_id: item.id,
                            status: 'failed',
                            error_message: String(e)
                        });
                    } finally {
                        activeCount--;
                        const totalProcessed = jobState.completed + jobState.failed;
                        jobState.progress = Math.round((totalProcessed / jobState.total_files) * 100);
                        
                        set({ syncJob: { ...jobState } });
                        await updateMediaSyncJob({
                            job_id: jobId,
                            user_id: userId,
                            device_id: deviceId,
                            total_files: jobState.total_files,
                            completed: jobState.completed,
                            failed: jobState.failed,
                            pending: jobState.total_files - totalProcessed,
                            progress: jobState.progress,
                            status: totalProcessed === jobState.total_files ? 'completed' : 'running'
                        });

                        await next();
                    }
                };

                const workers = [];
                for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, pending.length); i++) {
                    workers.push(next());
                }
                await Promise.all(workers);

                set({ syncJob: { ...jobState, status: 'completed', progress: 100 } });
                Logger.info('cross-device-sync', `All queue operations finalized.`);
            }
        }),
        {
            name: 'cross-device-sync-storage',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                deviceId: state.deviceId,
                downloadPolicy: state.downloadPolicy
            }),
        }
    )
);
