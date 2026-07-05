import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';
import { trackOfflineSync, captureStoreError } from '../utils/sentry';
import { useAuthStore } from '../stores/auth.store';
import { useGroupStore } from '../stores/group.store';
import { useMessageStore } from '../stores/message.store';
import { useAnnouncementStore } from '../stores/announcement.store';
import { useEventStore } from '../stores/event.store';
import { useResourceStore } from '../stores/resource.store';
import { useDirectoryStore } from '../stores/directory.store';
import { useOfflineSearchStore } from '../stores/offlineSearch.store';
import {
    initDB,
    updateSyncState,
    getSyncState,
    upsertContentManifest,
    getMaxTimestampByGroup,
    batchInsertMessages,
    getContentManifestsByType
} from '../lib/database';
import * as FileSystem from 'expo-file-system/legacy';

const SCHEMA_VERSION = 1;

export const OfflineSyncService = {
    /**
     * Performs a full, stage-by-stage bootstrap of all content and registers all assets into the unified manifest.
     */
    syncAll: async (force = false) => {
        const authUser = useAuthStore.getState().user;
        if (!authUser) return;

        Logger.info('offline-sync', 'Starting full bootstrap synchronization.');
        trackOfflineSync('bootstrap', 'started');

        try {
            await initDB();
            const userId = authUser.id;
            
            // Retrieve or initialize sync state
            let syncState = await getSyncState(userId);
            if (!syncState) {
                await updateSyncState(userId, {
                    last_sync: null,
                    last_asset_sync: null,
                    schema_version: SCHEMA_VERSION,
                    bootstrap_completed: 0
                });
                syncState = await getSyncState(userId);
            }

            const deviceId = 'unknown';

            const fs = FileSystem as any;
            const docDir = fs.Paths?.document?.uri || fs.documentDirectory || fs.cacheDirectory || '';
            const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
            const vaultBase = `${base}naliss_vault/`;

            // Helper to get extension
            const getExt = (url: string) => url.split('.').pop()?.split('?')[0] || 'dat';

            // ----------------------------------------------------
            // Stage 1: Sync Groups
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 1/14: Syncing group memberships');
            const { data: memberships, error: memError } = await ((supabase as any).from('group_members')
                .select('group_id')
                .eq('user_id', userId) as any);

            if (memError) throw memError;
            const groupIds = (memberships as any[]).map(m => m.group_id);

            if (groupIds.length > 0) {
                const { data: groupsResult, error: grpError } = await ((supabase as any).from('groups')
                    .select('*')
                    .in('id', groupIds)
                    .eq('is_active', true) as any);

                if (grpError) throw grpError;

                // Sync Zustand
                useGroupStore.setState({ groups: groupsResult });

                // Sync SQLite manifest
                for (const group of groupsResult) {
                    await upsertContentManifest({
                        content_type: 'group',
                        content_id: group.id,
                        user_id: userId,
                        raw_data: group,
                        sync_version: 1,
                        device_id: deviceId
                    });

                    // Register avatar asset if present
                    if (group.avatar_url && group.avatar_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 2: User profiles (Directory cache)
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 2/14: Syncing user profiles');
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

                    // Register profile avatar asset
                    if (user.avatar_url && user.avatar_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 3: Messages (Differential sync)
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 3/14: Syncing messages');
            const localGroups = await getContentManifestsByType('group');
            const activeGroupIds = localGroups.map(g => g.content_id);

            for (const gId of activeGroupIds) {
                const lastLocalTimestamp = await getMaxTimestampByGroup(gId);
                
                let query = (supabase as any).from('messages')
                    .select(`
                        *,
                        user:users!messages_sender_id_fkey(id, username, full_name, avatar_url, level, role),
                        reply_to_message:messages!reply_to_id(id, content, message_type, is_deleted, user:users!messages_sender_id_fkey(username, full_name))
                    `)
                    .eq('group_id', gId)
                    .eq('is_deleted', false);

                if (lastLocalTimestamp) {
                    query = query.gt('created_at', lastLocalTimestamp);
                }

                query = query.order('created_at', { ascending: true }).limit(300);
                const { data: serverMsgs, error: msgsError } = await (query as any);

                if (!msgsError && serverMsgs && serverMsgs.length > 0) {
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

                    await batchInsertMessages(formatted, gId);

                    // Update message store
                    const messageStore = useMessageStore.getState();
                    const existing = messageStore.getMessages(gId);
                    const existingIds = new Set(existing.map(m => m.id));
                    const newOnes = formatted.filter(m => !existingIds.has(m.id));
                    if (newOnes.length > 0) {
                        const merged = [...existing, ...newOnes]
                            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                            .slice(-300);
                        messageStore.setMessages(gId, merged);
                    }

                    // Register attachments into the manifest
                    for (const msg of formatted) {
                        const isMedia = msg.media_url || (msg.content && msg.content.startsWith('http') && ['image', 'video', 'document', 'audio'].includes(msg.message_type));
                        if (isMedia) {
                            const fileUrl = msg.media_url || msg.content;
                            const type = msg.message_type || 'image';
                            
                            let folderName = 'chat_media/';
                            if (type === 'audio') folderName = 'voice_notes/';
                            else if (type === 'video') folderName = 'videos/';
                            else if (type === 'document') folderName = 'documents/';

                            const localPath = `${vaultBase}${folderName}media_${msg.id}.${getExt(fileUrl)}`;
                            
                        }
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 4: Sync Announcements
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 4/14: Syncing announcements');
            const { data: serverAnnouncements, error: annError } = await ((supabase as any).from('announcements')
                .select('*')
                .eq('is_published', true) as any);

            if (!annError && serverAnnouncements) {
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

                    // Register cover image
                    if (ann.cover_image_url && ann.cover_image_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 5: Sync Events
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 5/14: Syncing events');
            const { data: serverEvents, error: evtError } = await ((supabase as any).from('events')
                .select('*, event_pools(id)')
                .in('status', ['published', 'ongoing']) as any);

            if (!evtError && serverEvents) {
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

                    // Register cover image
                    if (evt.cover_image_url && evt.cover_image_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 6: Sync Study Materials
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 6/14: Syncing study materials');
            const { data: serverMaterials, error: matError } = await ((supabase as any).from('materials')
                .select('*')
                .eq('is_active', true) as any);

            if (!matError && serverMaterials) {
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

                    // Register file asset
                    if (mat.file_url && mat.file_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 7: Sync Past Questions
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 7/14: Syncing past questions');
            const { data: serverQuestions, error: qError } = await ((supabase as any).from('past_questions')
                .select('*, course:course_id(*)')
                .eq('is_public', true) as any);

            if (!qError && serverQuestions) {
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

                    // Register past question PDF file
                    if (q.file_url && q.file_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 8: Sync Courses
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 8/14: Syncing courses');
            const { data: serverCourses, error: cError } = await ((supabase as any).from('courses')
                .select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)')
                .eq('is_active', true) as any);

            if (!cError && serverCourses) {
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

            // ----------------------------------------------------
            // Stage 9: Sync Lecturers directory
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 9/14: Syncing lecturers');
            const { data: serverLecturers, error: lecError } = await ((supabase as any).from('lecturers')
                .select('*')
                .eq('is_active', true) as any);

            if (!lecError && serverLecturers) {
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

                    // Register avatar
                    if (lec.avatar_url && lec.avatar_url.startsWith('http')) {
                    }
                }
            }

            // ----------------------------------------------------
            // Stage 10: Sync Executives directory
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 10/14: Syncing executives');
            const { data: serverExecutives, error: execError } = await ((supabase as any).from('executives')
                .select('*, user:users(full_name, avatar_url)')
                .eq('is_active', true) as any);

            if (!execError && serverExecutives) {
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

                    // Register avatar
                    if (exec.avatar_url && exec.avatar_url.startsWith('http')) {
                    }
                }
            }

            // Update Sync state metadata
            await updateSyncState(userId, {
                last_sync: new Date().toISOString(),
                last_asset_sync: new Date().toISOString(),
                schema_version: SCHEMA_VERSION,
                bootstrap_completed: 1
            });

            // Rebuild offline FTS5 search index
            await useOfflineSearchStore.getState().rebuildIndex();

            trackOfflineSync('bootstrap', 'completed');
            Logger.info('offline-sync', 'Bootstrap complete. Launching queue downloader.');

            // Trigger background queue downloader

        } catch (e: any) {
            Logger.error('offline-sync', 'Error running bootstrap synchronization', e);
            trackOfflineSync('bootstrap', 'failed', undefined, { error: e.message || String(e) });
            captureStoreError('OfflineSyncService', 'syncAll', e);
        }
    }
};
