import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';
import { UnifiedDownloadEngine } from '../utils/unifiedDownload';
import { Logger } from '../utils/logger';
import { updateLocalMediaPath } from '../lib/database';

const RESTORE_FLAG_PREFIX = 'download_restore_';
const RESTORE_PROGRESS_PREFIX = 'download_restore_progress_';
const CHAT_MEDIA_TYPES = new Set(['chat_image', 'chat_video', 'chat_audio', 'chat_document']);
const BATCH_SIZE = 3;
const FILE_TIMEOUT_MS = 30000;

const downloadWithTimeout = (url: string, fileId: string, assetType: string): Promise<string | null> => {
    return Promise.race([
        UnifiedDownloadEngine.download(url, fileId, undefined, assetType),
        new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Download timed out')), FILE_TIMEOUT_MS)
        ),
    ]);
};

export const DownloadTracker = {

    _restoreKey: (userId: string) => `${RESTORE_FLAG_PREFIX}${userId}`,
    _progressKey: (userId: string) => `${RESTORE_PROGRESS_PREFIX}${userId}`,

    recordDownload: async (assetId: string, assetType: string, remoteUrl: string, metadata?: Record<string, any>) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            await (supabase as any).from('user_downloads').upsert({
                user_id: user.id,
                asset_id: assetId,
                asset_type: assetType,
                remote_url: remoteUrl,
                metadata: metadata || {},
                downloaded_at: new Date().toISOString(),
            }, { onConflict: 'user_id,asset_id', ignoreDuplicates: false });
        } catch {
            // Fire-and-forget — never block the caller
        }
    },

    restoreUserDownloads: async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const flag = await AsyncStorage.getItem(DownloadTracker._restoreKey(user.id));
            if (flag === 'true') return;

            const { data: downloads, error } = await (supabase as any)
                .from('user_downloads')
                .select('asset_id, asset_type, remote_url')
                .eq('user_id', user.id);

            if (error) throw error;
            if (!downloads || downloads.length === 0) {
                await AsyncStorage.setItem(DownloadTracker._restoreKey(user.id), 'true');
                return;
            }

            Logger.info('DownloadTracker', `Restoring ${downloads.length} previously downloaded files...`);

            // Notify user via toast
            try {
                const { showToast } = require('../components/common/overlays');
                showToast(`Restoring ${downloads.length} files...`);
            } catch {}

            // Resume from last progress if interrupted
            const savedProgress = await AsyncStorage.getItem(DownloadTracker._progressKey(user.id));
            const startIndex = savedProgress ? parseInt(savedProgress, 10) : 0;

            for (let i = startIndex; i < downloads.length; i += BATCH_SIZE) {
                const batch = downloads.slice(i, i + BATCH_SIZE);

                await Promise.allSettled(batch.map(async (dl: any) => {
                    try {
                        const localPath = await downloadWithTimeout(dl.remote_url, dl.asset_id, dl.asset_type);

                        if (localPath && CHAT_MEDIA_TYPES.has(dl.asset_type)) {
                            await updateLocalMediaPath(dl.asset_id, localPath);
                        }
                    } catch {
                        // Skip failed items — will retry on next login
                    }
                }));

                // Persist progress so we resume on interrupt
                await AsyncStorage.setItem(DownloadTracker._progressKey(user.id), String(i + BATCH_SIZE));
            }

            await AsyncStorage.setItem(DownloadTracker._restoreKey(user.id), 'true');
            await AsyncStorage.removeItem(DownloadTracker._progressKey(user.id));
            Logger.info('DownloadTracker', 'Download restore completed');

            // Notify user
            try {
                const { showToast } = require('../components/common/overlays');
                showToast('Restore complete');
            } catch {}

            // Refresh resource download state to pick up any restored materials
            try {
                const { useResourceStore } = require('../stores/resource.store');
                await useResourceStore.getState().refreshDownloadedStatus();
            } catch {
                // silent
            }
        } catch (err) {
            Logger.warn('DownloadTracker', 'Restore failed, will retry next login', { error: String(err) });
        }
    },
};
