import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { mmkvStorage } from './mmkv.storage';
import { Logger } from '../utils/logger';
import { useNetworkStore } from './network.store';
import { useAuthStore } from './auth.store';
import { 
    getDB, 
    upsertOfflineAsset, 
    getOfflineAsset, 
    getAllPendingOfflineAssets,
    upsertDownloadJob,
    updateDownloadJobStatus
} from '../lib/database';
import { calculateSHA256 } from './crossDeviceSync.store';

// Helper to decode Base64 to binary string
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

export interface StorageStats {
    totalUsed: number;
    chatMedia: number;
    studyMaterials: number;
    announcements: number;
    documents: number;
    videos: number;
    voiceNotes: number;
    avatars: number;
    temporary: number;
}

interface TelemetryEvent {
    event: string;
    timestamp: string;
    details?: any;
}

interface ActiveJobState {
    total: number;
    completed: number;
    failed: number;
    remaining: number;
    progress: number;
    speedBytesPerSec: number;
    etaSeconds: number;
    currentAsset: string;
    status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
}

interface OfflineAssetStoreState {
    deviceId: string | null;
    downloadPolicy: 'everything' | 'wifi' | 'charging' | 'recent' | 'manual';
    activeJob: ActiveJobState | null;
    storageStats: StorageStats | null;
    telemetry: TelemetryEvent[];
    isInitialized: boolean;
    isDownloading: boolean;

    initialize: () => void;
    setDownloadPolicy: (policy: 'everything' | 'wifi' | 'charging' | 'recent' | 'manual') => void;
    registerAsset: (asset: {
        asset_id: string;
        asset_type: string;
        remote_url: string;
        local_path: string;
        sha256?: string | null;
        mime_type?: string | null;
        size?: number | null;
        priority?: number;
    }) => Promise<void>;
    startDownloader: () => Promise<void>;
    calculateStorageUsage: () => Promise<void>;
    clearStorageCategory: (category: string) => Promise<void>;
    logTelemetry: (event: string, details?: any) => void;
}

const BACKOFF_DELAY_MAP = [30000, 60000, 120000, 240000, 480000];

export const useOfflineAssetStore = create<OfflineAssetStoreState>()(
    persist(
        (set, get) => ({
            deviceId: null,
            downloadPolicy: 'everything',
            activeJob: null,
            storageStats: null,
            telemetry: [],
            isInitialized: false,
            isDownloading: false,

            initialize: () => {
                if (get().isInitialized) return;

                if (!get().deviceId) {
                    set({ deviceId: 'device_' + Math.random().toString(36).substring(2, 15) });
                }

                // AppState listeners
                AppState.addEventListener('change', (nextState: AppStateStatus) => {
                    if (nextState === 'active' && useNetworkStore.getState().isOnline) {
                        get().startDownloader().catch(() => {});
                    }
                });

                // Network changes listener
                const { registerOnlineCallback } = require('./network.store');
                registerOnlineCallback(() => {
                    Logger.info('offline-asset-store', 'Network available. Resuming pending asset downloads.');
                    get().startDownloader().catch(() => {});
                });

                set({ isInitialized: true });
                get().startDownloader().catch(() => {});
                get().calculateStorageUsage().catch(() => {});
            },

            setDownloadPolicy: (policy) => {
                set({ downloadPolicy: policy });
                get().logTelemetry('policy_changed', { policy });
            },

            logTelemetry: (event, details) => {
                const newEvent: TelemetryEvent = {
                    event,
                    timestamp: new Date().toISOString(),
                    details
                };
                set(state => ({
                    telemetry: [newEvent, ...state.telemetry].slice(0, 200) // keep last 200 events
                }));
                Logger.info('offline-telemetry', `${event}: ${JSON.stringify(details || {})}`);
            },

            registerAsset: async (asset) => {
                const authUser = useAuthStore.getState().user;
                const userId = authUser?.id || 'anonymous';
                const deviceId = get().deviceId || 'unknown';

                const db = getDB();
                if (!db) return;

                // 1. Add to manifest
                await upsertOfflineAsset({
                    asset_id: asset.asset_id,
                    asset_type: asset.asset_type,
                    user_id: userId,
                    remote_url: asset.remote_url,
                    local_path: asset.local_path,
                    sha256: asset.sha256 || null,
                    mime_type: asset.mime_type || null,
                    size: asset.size || null,
                    download_status: 'pending',
                    verified: 0,
                    device_origin: deviceId
                });

                // 2. Add to download jobs queue
                const jobId = 'job_' + asset.asset_id;
                await upsertDownloadJob({
                    job_id: jobId,
                    asset_id: asset.asset_id,
                    priority: asset.priority || 50,
                    retry_count: 0,
                    status: 'pending'
                });

                get().logTelemetry('asset_registered', { asset_id: asset.asset_id, type: asset.asset_type });
            },

            startDownloader: async () => {
                if (Platform.OS === 'web') return;
                if (get().isDownloading) return;

                const db = getDB();
                if (!db) return;

                const pendingAssets = await getAllPendingOfflineAssets();
                if (pendingAssets.length === 0) {
                    set({ isDownloading: false });
                    return;
                }

                // Sort by priority ASC
                const sortedJobs = await db.getAllAsync<any>(
                    `SELECT j.*, a.remote_url, a.local_path, a.sha256, a.size, a.asset_type 
                     FROM offline_download_jobs j
                     JOIN offline_asset_manifest a ON j.asset_id = a.asset_id
                     WHERE j.status = 'pending' OR j.status = 'failed'
                     ORDER BY j.priority ASC`
                );

                if (sortedJobs.length === 0) return;

                set({ isDownloading: true });
                get().logTelemetry('downloader_started', { pending_count: sortedJobs.length });

                const jobState: ActiveJobState = {
                    total: sortedJobs.length,
                    completed: 0,
                    failed: 0,
                    remaining: sortedJobs.length,
                    progress: 0,
                    speedBytesPerSec: 0,
                    etaSeconds: 0,
                    currentAsset: '',
                    status: 'running'
                };

                set({ activeJob: jobState });

                const CONCURRENCY_LIMIT = 3;
                let activeCount = 0;
                let currentIndex = 0;
                let startTime = Date.now();
                let totalBytesDownloaded = 0;

                const downloadNext = async () => {
                    if (currentIndex >= sortedJobs.length) return;

                    // Enforce policy checks
                    const policy = get().downloadPolicy;
                    if (policy === 'manual') {
                        set({ isDownloading: false, activeJob: { ...jobState, status: 'paused' } });
                        return;
                    }
                    if (policy === 'wifi') {
                        const Network = require('expo-network');
                        const netState = useNetworkStore.getState();
                        if (netState.networkType !== Network.NetworkStateType.WIFI) {
                            set({ isDownloading: false, activeJob: { ...jobState, status: 'paused' } });
                            get().logTelemetry('downloader_paused', { reason: 'wifi_policy' });
                            return;
                        }
                    }

                    if (!useNetworkStore.getState().isOnline) {
                        set({ isDownloading: false, activeJob: { ...jobState, status: 'paused' } });
                        get().logTelemetry('downloader_paused', { reason: 'offline' });
                        return;
                    }

                    const job = sortedJobs[currentIndex++];
                    activeCount++;

                    set(state => ({
                        activeJob: state.activeJob ? {
                            ...state.activeJob,
                            currentAsset: job.local_path.split('/').pop() || 'file'
                        } : null
                    }));

                    await updateDownloadJobStatus(job.job_id, 'in_progress');
                    await db.runAsync(
                        "UPDATE offline_asset_manifest SET download_status = 'downloading' WHERE asset_id = ?",
                        [job.asset_id]
                    );

                    let downloadSuccess = false;
                    let lastError = '';

                    try {
                        const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
                        const res = await UnifiedDownloadEngine.download(
                            job.remote_url,
                            job.asset_id,
                            job.local_path.split('/').pop() || 'file',
                            undefined,
                            {
                                assetType: job.asset_type,
                                priority: job.priority,
                                expectedHash: job.sha256,
                                expectedSize: job.size
                            }
                        );

                        if (res) {
                            downloadSuccess = true;
                            jobState.completed++;
                            totalBytesDownloaded += job.size || 0;
                            get().logTelemetry('asset_downloaded', { asset_id: job.asset_id });
                        } else {
                            throw new Error('Download failed via Unified Engine');
                        }
                    } catch (e: any) {
                        jobState.failed++;
                        lastError = e.message || String(e);
                        get().logTelemetry('asset_failed', { asset_id: job.asset_id, error: lastError });
                    } finally {
                        activeCount--;
                        const elapsedSecs = (Date.now() - startTime) / 1000;
                        const speed = elapsedSecs > 0 ? Math.round(totalBytesDownloaded / elapsedSecs) : 0;
                        const processed = jobState.completed + jobState.failed;
                        const progress = Math.round((processed / jobState.total) * 100);
                        const remaining = jobState.total - processed;
                        
                        let eta = 0;
                        if (speed > 0 && remaining > 0) {
                            const avgSize = totalBytesDownloaded / processed;
                            eta = Math.round((remaining * avgSize) / speed);
                        }

                        jobState.remaining = remaining;
                        jobState.progress = progress;
                        jobState.speedBytesPerSec = speed;
                        jobState.etaSeconds = eta;

                        set({ activeJob: { ...jobState } });
                        await get().calculateStorageUsage();
                        await downloadNext();
                    }
                };

                const workers = [];
                for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, sortedJobs.length); i++) {
                    workers.push(downloadNext());
                }
                await Promise.all(workers);

                set({ isDownloading: false, activeJob: { ...jobState, status: 'completed', progress: 100 } });
                get().logTelemetry('downloader_completed', { completed: jobState.completed, failed: jobState.failed });
            },

            calculateStorageUsage: async () => {
                const db = getDB();
                if (!db) return;

                try {
                    const rows = await db.getAllAsync<{ asset_type: string, total: number }>(
                        'SELECT asset_type, SUM(size) as total FROM offline_asset_manifest WHERE download_status = "completed" GROUP BY asset_type'
                    );

                    const stats: StorageStats = {
                        totalUsed: 0,
                        chatMedia: 0,
                        studyMaterials: 0,
                        announcements: 0,
                        documents: 0,
                        videos: 0,
                        voiceNotes: 0,
                        avatars: 0,
                        temporary: 0
                    };

                    for (const row of rows) {
                        const total = row.total || 0;
                        stats.totalUsed += total;

                        if (row.asset_type.startsWith('chat_')) {
                            stats.chatMedia += total;
                        }
                        if (row.asset_type === 'study_material' || row.asset_type === 'lecture_note') {
                            stats.studyMaterials += total;
                        }
                        if (row.asset_type === 'announcement_cover' || row.asset_type === 'announcement_attachment') {
                            stats.announcements += total;
                        }
                        if (row.asset_type === 'document' || row.asset_type === 'pdf') {
                            stats.documents += total;
                        }
                        if (row.asset_type === 'video') {
                            stats.videos += total;
                        }
                        if (row.asset_type === 'audio' || row.asset_type === 'voice_note') {
                            stats.voiceNotes += total;
                        }
                        if (row.asset_type === 'user_avatar' || row.asset_type === 'group_avatar') {
                            stats.avatars += total;
                        }
                    }

                    // Add cache sizes to temporary stats
                    const cacheFolder = FileSystem.cacheDirectory;
                    if (cacheFolder) {
                        try {
                            const cacheInfo = await FileSystem.getInfoAsync(cacheFolder);
                            stats.temporary = (cacheInfo as any).size || 0;
                        } catch (_) {}
                    }

                    set({ storageStats: stats });
                } catch (e) {
                    Logger.error('offline-asset-store', 'Failed to calculate storage usage', e);
                }
            },

            clearStorageCategory: async (category) => {
                const db = getDB();
                if (!db) return;

                get().logTelemetry('clear_category_started', { category });
                try {
                    let types: string[] = [];
                    if (category === 'videos') types = ['video', 'chat_video'];
                    else if (category === 'documents') types = ['document', 'pdf', 'chat_document', 'study_material', 'lecture_note'];
                    else if (category === 'chatMedia') types = ['chat_image', 'chat_media'];
                    else if (category === 'announcements') types = ['announcement_cover', 'announcement_attachment'];
                    else if (category === 'voiceNotes') types = ['audio', 'voice_note', 'chat_audio'];

                    if (types.length === 0) return;

                    const placeholders = types.map(() => '?').join(',');
                    const assets = await db.getAllAsync<any>(
                        `SELECT * FROM offline_asset_manifest WHERE download_status = 'completed' AND asset_type IN (${placeholders})`,
                        types
                    );

                    for (const asset of assets) {
                        try {
                            const info = await FileSystem.getInfoAsync(asset.local_path);
                            if (info.exists) {
                                await FileSystem.deleteAsync(asset.local_path, { idempotent: true });
                            }
                            await db.runAsync(
                                'UPDATE offline_asset_manifest SET download_status = "pending", verified = 0 WHERE asset_id = ?',
                                [asset.asset_id]
                            );
                            await updateDownloadJobStatus('job_' + asset.asset_id, 'pending');
                        } catch (err) {
                            Logger.error('offline-asset-store', `Failed to clear file: ${asset.local_path}`, err);
                        }
                    }

                    get().logTelemetry('clear_category_completed', { category });
                    await get().calculateStorageUsage();
                    get().startDownloader().catch(() => {});
                } catch (e) {
                    Logger.error('offline-asset-store', `Failed to clear category ${category}`, e);
                }
            }
        }),
        {
            name: 'offline-asset-storage-manifest-v2',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                deviceId: state.deviceId,
                downloadPolicy: state.downloadPolicy
            })
        }
    )
);
