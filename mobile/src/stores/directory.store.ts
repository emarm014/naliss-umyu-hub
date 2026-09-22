import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Lecturer, Executive } from '../types';
import { Logger } from '../utils/logger';
import { sortHierarchically } from '../utils/hierarchy';
import { normalizeError } from '../utils/sentry';

interface DirectoryState {
    lecturers: Lecturer[];
    executives: (Executive & { user?: { full_name: string; avatar_url: string | null } })[];
    isLoading: boolean;
    error: string | null;
    lastFetchLecturers: number | null;
    lastFetchExecutives: number | null;

    fetchLecturers: (force?: boolean) => Promise<void>;
    fetchExecutives: (force?: boolean) => Promise<void>;
    clearError: () => void;
    clearCache: () => void;
    clearUserData: () => void;
    clearContentCache: () => void;
}

const CACHE_TTL = Infinity; // No TTL â€” directory available offline indefinitely

export const useDirectoryStore = create<DirectoryState>()(
    persist(
        (set, get) => ({
            lecturers: [],
            executives: [],
            isLoading: false,
            error: null,
            lastFetchLecturers: null,
            lastFetchExecutives: null,

            fetchLecturers: async (force = false) => {
                const { lastFetchLecturers, lecturers } = get();
                const isFresh = lastFetchLecturers && Date.now() - lastFetchLecturers < CACHE_TTL && lecturers.length > 0;
                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && lecturers.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('lecturers');
                        if (cached.length > 0) {
                            set({ lecturers: sortHierarchically(cached, 'lecturer') as any, isLoading: false });
                        }
                    } catch { /* fall through to server fetch */ }
                }

                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) { set({ isLoading: false }); return; }

                if (get().lecturers.length === 0) set({ isLoading: true });
                try {
                    const { data, error } = await (supabase as any).from('lecturers')
                        .select('*')
                        .eq('is_active', true)
                        .order('display_order', { ascending: true, nullsFirst: false });

                    if (error) throw normalizeError(error);
                    let sortedData = sortHierarchically(data || [], 'lecturer');
                    
                    const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
                    const { prefetchAsset } = require('../utils/prefetchAsset');
                    
                    sortedData = await Promise.all(sortedData.map(async (lecturer: any) => {
                        let localAvatar = lecturer.local_avatar_path;
                        if (lecturer.avatar_url) {
                            const urlHash = lecturer.avatar_url.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
                            const localUri = await UnifiedDownloadEngine.download(
                                lecturer.avatar_url,
                                `lecturer_avatar_${lecturer.id}_${urlHash}`,
                                undefined,
                                'user_avatar'
                            );
                            if (localUri) localAvatar = localUri;
                        }
                        return { ...lecturer, local_avatar_path: localAvatar || null };
                    }));

                    const lecturerIds = sortedData.map((l: any) => l.id);
                    if (lecturerIds.length > 0) {
                        try {
                            const { data: photos } = await (supabase as any).from('photos').select('*').eq('entity_type', 'lecturer').in('entity_id', lecturerIds);
                            if (photos && photos.length > 0) {
                                photos.forEach((photo: any) => {
                                    if (photo.url) {
                                        const posterEntityId = `photo_${photo.id}`;
                                        prefetchAsset(posterEntityId, photo.url, 'gallery');
                                    }
                                });
                            }
                        } catch(e) {}
                    }

                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('lecturers', sortedData, '').catch(() => {});
                    set({ lecturers: (sortedData as unknown) as Lecturer[], isLoading: false, lastFetchLecturers: Date.now() });
                } catch (err) {
                    Logger.error('directory-store', 'fetchLecturers failed', err);
                    set({ isLoading: false });
                }
            },

            fetchExecutives: async (force = false) => {
                const { lastFetchExecutives, executives } = get();
                const isFresh = lastFetchExecutives && Date.now() - lastFetchExecutives < CACHE_TTL && executives.length > 0;
                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && executives.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('executives');
                        if (cached.length > 0) {
                            set({ executives: sortHierarchically(cached, 'executive') as any, isLoading: false });
                        }
                    } catch { /* fall through to server fetch */ }
                }

                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) { set({ isLoading: false }); return; }

                if (get().executives.length === 0) set({ isLoading: true });
                try {
                    const { data, error } = await (supabase as any).from('executives')
                        .select(`*, user:users(full_name, avatar_url)`)
                        .eq('is_active', true)
                        .order('display_order', { ascending: true, nullsFirst: false });

                    if (error) throw normalizeError(error);
                    let sortedData = sortHierarchically(data || [], 'executive');
                    
                    const { UnifiedDownloadEngine } = require('../utils/unifiedDownload');
                    const { prefetchAsset } = require('../utils/prefetchAsset');
                    
                    sortedData = await Promise.all(sortedData.map(async (executive: any) => {
                        let localAvatar = executive.local_avatar_path;
                        const avatarUrl = executive.avatar_url || executive.user?.avatar_url;
                        if (avatarUrl) {
                            const urlHash = avatarUrl.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
                            const localUri = await UnifiedDownloadEngine.download(
                                avatarUrl,
                                `executive_avatar_${executive.id}_${urlHash}`,
                                undefined,
                                'user_avatar'
                            );
                            if (localUri) localAvatar = localUri;
                        }
                        return { ...executive, local_avatar_path: localAvatar || null };
                    }));

                    const execIds = sortedData.map((e: any) => e.id);
                    if (execIds.length > 0) {
                        try {
                            const { data: photos } = await (supabase as any).from('photos').select('*').eq('entity_type', 'executive').in('entity_id', execIds);
                            if (photos && photos.length > 0) {
                                photos.forEach((photo: any) => {
                                    if (photo.url) {
                                        const posterEntityId = `photo_${photo.id}`;
                                        prefetchAsset(posterEntityId, photo.url, 'gallery');
                                    }
                                });
                            }
                        } catch(e) {}
                    }

                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('executives', sortedData, '').catch(() => {});
                    set({ executives: sortedData as any, isLoading: false, lastFetchExecutives: Date.now() });
                } catch (err) {
                    Logger.error('directory-store', 'fetchExecutives failed', err);
                    set({ isLoading: false });
                }
            },

            clearError: () => set({ error: null }),
            clearCache: () => set({
                lecturers: [],
                executives: [],
                error: null,
                lastFetchLecturers: null,
                lastFetchExecutives: null,
            }),
            clearUserData: () => set({}),
            clearContentCache: () => set({
                lastFetchLecturers: null,
                lastFetchExecutives: null,
                error: null,
            }),
        }),
        {
            name: 'directory-storage',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                lecturers: state.lecturers,
                executives: state.executives,
                lastFetchLecturers: state.lastFetchLecturers,
                lastFetchExecutives: state.lastFetchExecutives,
            }),
        }
    )
);

