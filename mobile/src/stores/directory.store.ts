import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Lecturer, Executive } from '../types';
import { Logger } from '../utils/logger';

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
}

const CACHE_TTL = Infinity; // No TTL — directory available offline indefinitely

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
                            set({ lecturers: cached as any, isLoading: false });
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
                        .order('display_order');

                    if (error) throw error;
                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('lecturers', data, '').catch(() => {});
                    set({ lecturers: (data as unknown) as Lecturer[], isLoading: false, lastFetchLecturers: Date.now() });
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
                            set({ executives: cached as any, isLoading: false });
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
                        .order('display_order');

                    if (error) throw error;
                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('executives', data, '').catch(() => {});
                    set({ executives: data as any, isLoading: false, lastFetchExecutives: Date.now() });
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

