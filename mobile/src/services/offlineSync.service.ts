import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';
import { trackOfflineSync, captureStoreError, normalizeError } from '../utils/sentry';
import * as Sentry from '@sentry/react-native';
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
    batchUpsertContentManifest,
    getMaxTimestampByGroup,
    batchInsertMessages,
    getContentManifestsByType
} from '../lib/database';

const SCHEMA_VERSION = 1;

/**
 * Per-stage timeout: if any single sync stage takes longer than 15s
 * (e.g., slow network, large payload), it times out and the sync moves
 * to the next stage. This prevents a stalled query from blocking the
 * entire sync chain and the SQLite transaction queue.
 */
const STAGE_TIMEOUT_MS = 15000;
async function withStageTimeout<T>(stage: string, task: () => Promise<T>): Promise<T | null> {
    try {
        return await Promise.race([
            task(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Stage timed out after ${STAGE_TIMEOUT_MS}ms`)), STAGE_TIMEOUT_MS)
            ),
        ]);
    } catch (e: any) {
        Logger.warn('offline-sync', `${stage}: ${e.message || String(e)} — skipping stage`);
        Sentry.captureException(normalizeError(e), { tags: { source: 'background_sync' } });
        return null;
    }
}

/** Yield to the JS event loop so UI renders and media reads can execute between stages */
const yieldToUI = () => new Promise<void>(r => setTimeout(r, 20));

/** Concurrency guard — prevents duplicate syncs from running in parallel */
let _syncInProgress = false;

export const OfflineSyncService = {
    /**
     * Performs a full, stage-by-stage bootstrap of all content and registers all assets into the unified manifest.
     */
    syncAll: async (force = false) => {
        const authUser = useAuthStore.getState().user;
        if (!authUser) return;

        // Concurrency guard — prevents duplicate syncs from running in parallel.
        // The Sentry logs showed every breadcrumb duplicated at the same millisecond,
        // indicating two full 14-stage syncs executing concurrently.
        if (_syncInProgress) {
            Logger.warn('offline-sync', 'Sync already in progress — skipping duplicate invocation.');
            return;
        }
        _syncInProgress = true;

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

            // ----------------------------------------------------
            // Stage 1: Sync Groups
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 1/14: Syncing group memberships');
            await withStageTimeout('Stage 1: Groups', async () => {
                const { data: memberships, error: memError } = await ((supabase as any).from('group_members')
                    .select('group_id')
                    .eq('user_id', userId) as any);

                if (memError) throw normalizeError(memError);
                const groupIds = (memberships || []).map((m: any) => m.group_id);

                if (groupIds.length > 0) {
                    const { data: groupsResult, error: grpError } = await ((supabase as any).from('groups')
                        .select('*')
                        .in('id', groupIds)
                        .eq('is_active', true) as any);

                    if (grpError) throw normalizeError(grpError);

                    await useGroupStore.getState().fetchGroups(true);

                    // Batch-upsert all groups in a single transaction (was N transactions before)
                    await batchUpsertContentManifest(groupsResult.map((group: any) => ({
                        content_type: 'group',
                        content_id: group.id,
                        user_id: userId,
                        raw_data: group,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 2: User profiles (Directory cache)
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 2/14: Syncing user profiles');
            await withStageTimeout('Stage 2: User profiles', async () => {
                const { data: usersResult, error: usrError } = await ((supabase as any).from('users')
                    .select('id, username, full_name, avatar_url, level, role') as any);

                if (!usrError && usersResult) {
                    await batchUpsertContentManifest(usersResult.map((user: any) => ({
                        content_type: 'user_profile',
                        content_id: user.id,
                        user_id: userId,
                        raw_data: user,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 3: Messages (Differential sync)
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 3/14: Syncing messages');
            await withStageTimeout('Stage 3: Messages', async () => {
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

                    query = query.order('created_at', { ascending: true }).limit(1000);
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

                        const messageStore = useMessageStore.getState();
                        const existing = messageStore.getMessages(gId);
                        const existingIds = new Set(existing.map(m => m.id));
                        const newOnes = formatted.filter(m => !existingIds.has(m.id));
                        if (newOnes.length > 0) {
                            const merged = [...existing, ...newOnes]
                                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                            messageStore.setMessages(gId, merged);
                        }
                    }
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 4: Sync Announcements
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 4/14: Syncing announcements');
            await withStageTimeout('Stage 4: Announcements', async () => {
                const { data: serverAnnouncements, error: annError } = await ((supabase as any).from('announcements')
                    .select('*')
                    .eq('is_published', true) as any);

                if (!annError && serverAnnouncements) {
                    useAnnouncementStore.setState({ announcements: serverAnnouncements });
                    await batchUpsertContentManifest(serverAnnouncements.map((ann: any) => ({
                        content_type: 'announcement',
                        content_id: ann.id,
                        user_id: userId,
                        raw_data: ann,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 5: Sync Events
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 5/14: Syncing events');
            await withStageTimeout('Stage 5: Events', async () => {
                const { data: serverEvents, error: evtError } = await ((supabase as any).from('events')
                    .select('*, event_pools(id)')
                    .in('status', ['published', 'ongoing']) as any);

                if (!evtError && serverEvents) {
                    useEventStore.setState({ events: serverEvents });
                    await batchUpsertContentManifest(serverEvents.map((evt: any) => ({
                        content_type: 'event',
                        content_id: evt.id,
                        user_id: userId,
                        raw_data: evt,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 6: Sync Study Materials
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 6/14: Syncing study materials');
            await withStageTimeout('Stage 6: Materials', async () => {
                const { data: serverMaterials, error: matError } = await ((supabase as any).from('materials')
                    .select('*')
                    .eq('is_active', true) as any);

                if (!matError && serverMaterials) {
                    useResourceStore.setState({ materials: serverMaterials });
                    await batchUpsertContentManifest(serverMaterials.map((mat: any) => ({
                        content_type: 'material',
                        content_id: mat.id,
                        user_id: userId,
                        raw_data: mat,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 7: Sync Past Questions
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 7/14: Syncing past questions');
            await withStageTimeout('Stage 7: Past questions', async () => {
                const { data: serverQuestions, error: qError } = await ((supabase as any).from('past_questions')
                    .select('*, course:course_id(*)')
                    .eq('is_public', true) as any);

                if (!qError && serverQuestions) {
                    useResourceStore.setState({ pastQuestions: serverQuestions });
                    await batchUpsertContentManifest(serverQuestions.map((q: any) => ({
                        content_type: 'past_question',
                        content_id: q.id,
                        user_id: userId,
                        raw_data: q,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 8: Sync Courses
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 8/14: Syncing courses');
            await withStageTimeout('Stage 8: Courses', async () => {
                const { data: serverCourses, error: cError } = await ((supabase as any).from('courses')
                    .select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)')
                    .eq('is_active', true) as any);

                if (!cError && serverCourses) {
                    useResourceStore.setState({ courses: serverCourses });
                    await batchUpsertContentManifest(serverCourses.map((c: any) => ({
                        content_type: 'course',
                        content_id: c.id,
                        user_id: userId,
                        raw_data: c,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 9: Sync Lecturers directory
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 9/14: Syncing lecturers');
            await withStageTimeout('Stage 9: Lecturers', async () => {
                const { data: serverLecturers, error: lecError } = await ((supabase as any).from('lecturers')
                    .select('*')
                    .eq('is_active', true) as any);

                if (!lecError && serverLecturers) {
                    useDirectoryStore.setState({ lecturers: serverLecturers });
                    await batchUpsertContentManifest(serverLecturers.map((lec: any) => ({
                        content_type: 'lecturer',
                        content_id: lec.id,
                        user_id: userId,
                        raw_data: lec,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            await yieldToUI();

            // ----------------------------------------------------
            // Stage 10: Sync Executives directory
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 10/14: Syncing executives');
            await withStageTimeout('Stage 10: Executives', async () => {
                const { data: serverExecutives, error: execError } = await ((supabase as any).from('executives')
                    .select('*, user:users(full_name, avatar_url)')
                    .eq('is_active', true) as any);

                if (!execError && serverExecutives) {
                    useDirectoryStore.setState({ executives: serverExecutives });
                    await batchUpsertContentManifest(serverExecutives.map((exec: any) => ({
                        content_type: 'executive',
                        content_id: exec.id,
                        user_id: userId,
                        raw_data: exec,
                        sync_version: 1,
                        device_id: deviceId
                    })));
                }
            });

            // ----------------------------------------------------
            // Stage 11: Sync news
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 11/14: Syncing news');
            await yieldToUI();
            try {
                const { data: newsData } = await (supabase as any).from('news')
                    .select('*').order('created_at', { ascending: false });
                if (newsData?.length) await batchUpsertContentManifest(newsData.map((n: any) => ({
                    content_type: 'news',
                    content_id: n.id,
                    user_id: userId,
                    raw_data: n,
                    sync_version: 1,
                    device_id: deviceId
                })));
            } catch (e) { Sentry.captureException(normalizeError(e), { tags: { source: 'background_sync' } }); }

            // ----------------------------------------------------
            // Stage 12: Sync archive
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 12/14: Syncing archive');
            await yieldToUI();
            try {
                const { data: archiveData } = await (supabase as any).from('archives')
                    .select('*').order('created_at', { ascending: false });
                if (archiveData?.length) await batchUpsertContentManifest(archiveData.map((a: any) => ({
                    content_type: 'archives',
                    content_id: a.id,
                    user_id: userId,
                    raw_data: a,
                    sync_version: 1,
                    device_id: deviceId
                })));
            } catch (e) { Sentry.captureException(normalizeError(e), { tags: { source: 'background_sync' } }); }

            // ----------------------------------------------------
            // Stage 13: Sync FYB (featured students)
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 13/14: Syncing featured students');
            await yieldToUI();
            try {
                const { data: fybData } = await (supabase as any).from('featured_students')
                    .select(`id, user_id, type, title, subtitle, description, custom_image_url,
                             is_active, published_at, expires_at, total_congratulations, created_at,
                             users!featured_students_user_id_fkey(full_name, username, avatar_url)`)
                    .neq('type', 'event_winner').order('published_at', { ascending: false });
                if (fybData?.length) await batchUpsertContentManifest(fybData.map((f: any) => ({
                    content_type: 'featured_students',
                    content_id: f.id,
                    user_id: userId,
                    raw_data: f,
                    sync_version: 1,
                    device_id: deviceId
                })));
            } catch (e) { Sentry.captureException(normalizeError(e), { tags: { source: 'background_sync' } }); }

            // ----------------------------------------------------
            // Stage 14: Sync gallery
            // ----------------------------------------------------
            Logger.info('offline-sync', 'Stage 14/14: Syncing gallery topics');
            await yieldToUI();
            try {
                const { data: galleryData } = await (supabase as any).from('gallery_topics')
                    .select('*').order('created_at', { ascending: false }).limit(100);
                if (galleryData?.length) await batchUpsertContentManifest(galleryData.map((g: any) => ({
                    content_type: 'gallery_topics',
                    content_id: g.id,
                    user_id: userId,
                    raw_data: g,
                    sync_version: 1,
                    device_id: deviceId
                })));
            } catch (e) { Sentry.captureException(normalizeError(e), { tags: { source: 'background_sync' } }); }

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
            Logger.info('offline-sync', 'Bootstrap complete. Media attachments will load on-demand.');

            // Chat media attachments are downloaded on-demand when viewed to save bandwidth and storage.
            // Explicitly tracked downloads are restored via DownloadTracker.
        } catch (e: any) {
            Logger.error('offline-sync', 'Error running bootstrap synchronization', e);
            trackOfflineSync('bootstrap', 'failed', undefined, { error: e.message || String(e) });
            Sentry.captureException(normalizeError(e), { tags: { source: 'background_sync' } });
        } finally {
            _syncInProgress = false;
        }
    }
};
