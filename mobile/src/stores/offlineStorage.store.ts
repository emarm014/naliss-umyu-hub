import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import { Logger } from '../utils/logger';
import { getDB, upsertMediaManifest } from '../lib/database';

interface StorageBreakdown {
    totalUsed: number;          // bytes
    chatMedia: number;          // images
    documents: number;          // pdfs, docs
    videos: number;
    voiceNotes: number;         // audio
    avatars: number;
    other: number;
}

interface OfflineStorageState {
    breakdown: StorageBreakdown | null;
    isCalculating: boolean;

    calculateUsage: () => Promise<void>;
    clearCategory: (category: string) => Promise<void>;
    getPerChatStatus: (groupId: string) => Promise<{ status: 'ready' | 'syncing' | 'waiting' | 'partial', progress: number }>;
}

export const useOfflineStorageStore = create<OfflineStorageState>((set, get) => ({
    breakdown: null,
    isCalculating: false,

    calculateUsage: async () => {
        const db = getDB();
        if (!db) return;

        set({ isCalculating: true });
        try {
            const rows = await db.getAllAsync<{ media_type: string, total: number }>(
                'SELECT media_type, SUM(file_size) as total FROM local_media_manifest WHERE downloaded = 1 GROUP BY media_type'
            );

            const breakdown: StorageBreakdown = {
                totalUsed: 0,
                chatMedia: 0,
                documents: 0,
                videos: 0,
                voiceNotes: 0,
                avatars: 0,
                other: 0
            };

            for (const row of rows) {
                const total = row.total || 0;
                breakdown.totalUsed += total;
                
                if (row.media_type === 'image') {
                    breakdown.chatMedia += total;
                } else if (row.media_type === 'video') {
                    breakdown.videos += total;
                } else if (row.media_type === 'audio') {
                    breakdown.voiceNotes += total;
                } else if (row.media_type === 'document' || row.media_type === 'pdf') {
                    breakdown.documents += total;
                } else if (row.media_type === 'user_avatar' || row.media_type === 'group_avatar') {
                    breakdown.avatars += total;
                } else {
                    breakdown.other += total;
                }
            }

            set({ breakdown, isCalculating: false });
        } catch (e) {
            Logger.error('offline-storage', 'Failed to calculate storage breakdown', e);
            set({ isCalculating: false });
        }
    },

    clearCategory: async (category: string) => {
        const db = getDB();
        if (!db) return;

        Logger.info('offline-storage', `Selective clearing initiated for category: ${category}`);
        try {
            let mediaTypes: string[] = [];
            if (category === 'videos') mediaTypes = ['video'];
            else if (category === 'voiceNotes') mediaTypes = ['audio'];
            else if (category === 'documents') mediaTypes = ['document', 'pdf'];
            else if (category === 'chatMedia') mediaTypes = ['image'];

            if (mediaTypes.length === 0) return;

            const placeholders = mediaTypes.map(() => '?').join(',');
            const files = await db.getAllAsync<any>(
                `SELECT * FROM local_media_manifest WHERE downloaded = 1 AND media_type IN (${placeholders})`,
                mediaTypes
            );

            for (const file of files) {
                try {
                    const info = await FileSystem.getInfoAsync(file.local_path);
                    if (info.exists) {
                        await FileSystem.deleteAsync(file.local_path, { idempotent: true });
                    }
                    await upsertMediaManifest({
                        ...file,
                        downloaded: 0,
                        verified: 0
                    });
                } catch (err) {
                    Logger.error('offline-storage', `Failed to delete file: ${file.local_path}`, err);
                }
            }

            Logger.info('offline-storage', `Selective clearing completed for ${category}.`);
            await get().calculateUsage();
        } catch (e) {
            Logger.error('offline-storage', `Failed selective clearing for ${category}`, e);
        }
    },

    getPerChatStatus: async (groupId: string) => {
        const db = getDB();
        if (!db) return { status: 'ready', progress: 100 };

        try {
            const row = await db.getFirstAsync<{ total: number, downloaded: number }>(
                'SELECT COUNT(*) as total, SUM(downloaded) as downloaded FROM local_media_manifest WHERE group_id = ?',
                [groupId]
            );

            if (!row || row.total === 0) {
                return { status: 'ready', progress: 100 };
            }

            const total = row.total;
            const downloaded = row.downloaded || 0;
            const progress = Math.round((downloaded / total) * 100);

            if (downloaded === total) {
                return { status: 'ready', progress: 100 };
            }

            const { useCrossDeviceSyncStore } = require('./crossDeviceSync.store');
            const syncJob = useCrossDeviceSyncStore.getState().syncJob;
            const isSyncing = syncJob && syncJob.status === 'running';

            if (isSyncing) {
                return { status: 'syncing', progress };
            } else if (downloaded > 0) {
                return { status: 'partial', progress };
            } else {
                return { status: 'waiting', progress: 0 };
            }
        } catch (e) {
            return { status: 'ready', progress: 100 };
        }
    }
}));
