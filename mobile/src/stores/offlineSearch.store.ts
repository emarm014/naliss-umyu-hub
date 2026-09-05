import { create } from 'zustand';
import { Logger } from '../utils/logger';
import { indexEntity, searchOffline, getDB } from '../lib/database';

export interface SearchResult {
    entity_id: string;
    entity_type: 'message' | 'announcement' | 'event' | 'material';
    group_id: string | null;
    sender_name: string | null;
    content: string | null;
    file_name: string | null;
    caption: string | null;
    created_at: string;
}

interface OfflineSearchState {
    results: SearchResult[];
    isSearching: boolean;
    search: (query: string, filters?: { type?: string; groupId?: string }) => Promise<SearchResult[]>;
    rebuildIndex: () => Promise<void>;
}

export const useOfflineSearchStore = create<OfflineSearchState>((set) => ({
    results: [],
    isSearching: false,

    search: async (query, filters) => {
        if (!query.trim()) {
            set({ results: [] });
            return [];
        }

        set({ isSearching: true });
        try {
            const dbResults = await searchOffline(query, filters);
            set({ results: dbResults, isSearching: false });
            return dbResults;
        } catch (e) {
            Logger.error('offline-search', 'Search failed', e);
            set({ isSearching: false, results: [] });
            return [];
        }
    },

    rebuildIndex: async () => {
        const db = getDB();
        if (!db) return;

        Logger.info('offline-search', 'Rebuilding full-text search index from local databases.');
        try {
            // Clear FTS index
            const { enqueueTransaction } = require('../lib/database');
            await enqueueTransaction(async () => {
                await db.runAsync('DELETE FROM offline_search_index');
            });

            // 1. Index messages
            let msgOffset = 0;
            let msgHasMore = true;
            while (msgHasMore) {
                const messages = await db.getAllAsync<any>('SELECT * FROM local_messages LIMIT 500 OFFSET ?', [msgOffset]);
                if (messages.length === 0) {
                    msgHasMore = false;
                } else {
                    for (const msg of messages) {
                        try {
                            const parsed = JSON.parse(msg.raw_data);
                            const senderName = parsed.user?.username || parsed.user?.full_name || 'Member';
                            await indexEntity(parsed.id, 'message', {
                                group_id: parsed.group_id,
                                sender_name: senderName,
                                content: parsed.content,
                                created_at: parsed.created_at
                            });
                        } catch (_) {}
                    }
                    msgOffset += 500;
                    if (messages.length < 500) msgHasMore = false;
                }
            }

            // 2. Index content manifests (Announcements, Events, Materials)
            let contentOffset = 0;
            let contentHasMore = true;
            while (contentHasMore) {
                const contentItems = await db.getAllAsync<any>('SELECT * FROM content_manifest LIMIT 500 OFFSET ?', [contentOffset]);
                if (contentItems.length === 0) {
                    contentHasMore = false;
                } else {
                    for (const item of contentItems) {
                        try {
                            const parsed = JSON.parse(item.raw_data);
                            if (item.content_type === 'announcement') {
                                await indexEntity(parsed.id, 'announcement', {
                                    caption: parsed.title,
                                    content: parsed.content,
                                    created_at: parsed.created_at
                                });
                            } else if (item.content_type === 'event') {
                                await indexEntity(parsed.id, 'event', {
                                    caption: parsed.title,
                                    content: parsed.description,
                                    created_at: parsed.created_at
                                });
                            } else if (item.content_type === 'materials' || item.content_type === 'past_questions') {
                                await indexEntity(parsed.id, 'material', {
                                    caption: parsed.title,
                                    content: parsed.description,
                                    created_at: parsed.created_at
                                });
                            }
                        } catch (_) {}
                    }
                    contentOffset += 500;
                    if (contentItems.length < 500) contentHasMore = false;
                }
            }

            Logger.info('offline-search', 'Full-text search index rebuild completed successfully.');
        } catch (e) {
            Logger.error('offline-search', 'Failed to rebuild search index', e);
        }
    }
}));
