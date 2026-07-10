import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Material, Course, MaterialType, AcademicLevel, SemesterType, PastQuestion } from '../types';
import { checkFileExists, extractFileNameFromUrl } from '../utils/download';
import { captureStoreError } from '../utils/sentry';
import * as FileSystem from 'expo-file-system/legacy';

interface ResourceState {
    materials: Material[];
    pastQuestions: PastQuestion[];
    courses: Course[];
    downloadedIds: string[]; // Changed from Set to Array for JSON persistence
    isLoading: boolean;
    lastFetchMaterials: number | null;
    lastFetchPastQuestions: number | null;
    lastFetchCourses: number | null;
    error: string | null;

    fetchMaterials: (filters?: { type?: MaterialType; level?: AcademicLevel; semester?: SemesterType; courseId?: string }, force?: boolean) => Promise<void>;
    fetchPastQuestions: (filters?: { level?: AcademicLevel; semester?: SemesterType; courseId?: string }, force?: boolean) => Promise<void>;
    fetchCourses: (level?: AcademicLevel, force?: boolean) => Promise<void>;
    incrementDownloadCount: (id: string, type: 'material' | 'past_question') => Promise<void>;
    incrementViewCount: (id: string, type: 'material' | 'past_question') => Promise<void>;
    deleteResource: (id: string, type: 'materials' | 'past_questions') => Promise<void>;
    refreshDownloadedStatus: () => Promise<void>;
    clearError: () => void;
    clearCache: () => void;
}

const CACHE_TTL = Infinity; // No TTL — materials/courses/past questions available offline indefinitely

export const useResourceStore = create<ResourceState>()(
    persist(
        (set, get) => ({
            materials: [],
            pastQuestions: [],
            courses: [],
            downloadedIds: [],
            isLoading: false,
            lastFetchMaterials: null,
            lastFetchPastQuestions: null,
            lastFetchCourses: null,
            error: null,

            fetchMaterials: async (filters, force = false) => {
                const { lastFetchMaterials, materials } = get();
                const isFresh = lastFetchMaterials && Date.now() - lastFetchMaterials < CACHE_TTL && materials.length > 0;
                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && materials.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('materials');
                        if (cached.length > 0) {
                            set({ materials: cached as any, isLoading: false });
                        }
                    } catch { /* fall through to server fetch */ }
                }

                // OFFLINE GUARD: if offline, data from SQLite is already displayed
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                if (get().materials.length === 0) set({ isLoading: true });
                set({ error: null });

                try {
                    let query: any = (supabase as any).from('materials')
                        .select('*')
                        .eq('is_active', true);

                    if (filters?.type && filters.type !== 'all' as any) {
                        query = query.eq('material_type', filters.type);
                    }
                    if (filters?.courseId) query = query.eq('course_id', filters.courseId);
                    if (filters?.semester) query = query.eq('semester', filters.semester);

                    const { data, error } = await query.order('created_at', { ascending: false });

                    if (error) throw error;
                    
                    const materials = (data as unknown) as Material[];
                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('materials', materials, '').catch(() => {});
                    set({ materials, isLoading: false, lastFetchMaterials: Date.now() });
                    get().refreshDownloadedStatus();
                } catch (err) {
                    captureStoreError('resource', 'fetchMaterials', err, { filters });
                    set({ isLoading: false });
                }
            },

            fetchPastQuestions: async (filters, force = false) => {
                const { lastFetchPastQuestions, pastQuestions } = get();
                const isFresh = lastFetchPastQuestions && Date.now() - lastFetchPastQuestions < CACHE_TTL && pastQuestions.length > 0;
                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && pastQuestions.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('past_questions');
                        if (cached.length > 0) {
                            set({ pastQuestions: cached as any, isLoading: false });
                        }
                    } catch { /* fall through to server fetch */ }
                }

                // OFFLINE GUARD: if offline, data from SQLite is already displayed
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                if (get().pastQuestions.length === 0) set({ isLoading: true });
                set({ error: null });

                try {
                    let query: any = (supabase as any).from('past_questions' as any)
                        .select('*, course:course_id(*)')
                        .eq('is_public', true);

                    if (filters?.courseId) query = query.eq('course_id', filters.courseId);
                    if (filters?.semester) query = query.eq('semester', filters.semester);

                    const { data, error } = await query.order('created_at', { ascending: false });

                    if (error) throw error;
                    
                    const pastQuestions = (data as unknown) as PastQuestion[];
                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('past_questions', pastQuestions, '').catch(() => {});
                    set({ pastQuestions, isLoading: false, lastFetchPastQuestions: Date.now() });
                    get().refreshDownloadedStatus();
                } catch (err) {
                    captureStoreError('resource', 'fetchPastQuestions', err, { filters });
                    set({ isLoading: false });
                }
            },

            fetchCourses: async (level, force = false) => {
                const { lastFetchCourses, courses } = get();
                const isFresh = lastFetchCourses && Date.now() - lastFetchCourses < CACHE_TTL && courses.length > 0;
                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && courses.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('courses');
                        if (cached.length > 0) {
                            set({ courses: cached as any, isLoading: false });
                        }
                    } catch { /* fall through to server fetch */ }
                }

                // OFFLINE GUARD: if offline, data from SQLite is already displayed
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                if (get().courses.length === 0) set({ isLoading: true });

                try {
                    let query: any = (supabase as any).from('courses')
                        .select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)')
                        .eq('is_active', true);
                    const { data, error } = await query.order('code');
                    if (error) throw error;
                    const { cacheEntityList } = require('../lib/database');
                    cacheEntityList('courses', data, '').catch(() => {});
                    set({ courses: (data as unknown) as Course[], isLoading: false, lastFetchCourses: Date.now() });
                } catch (err) {
                    captureStoreError('resource', 'fetchCourses', err, { level });
                    set({ isLoading: false });
                }
            },


            refreshDownloadedStatus: async () => {
                const { materials, pastQuestions } = get();
                const { AssetPathResolver } = require('../utils/assetResolver');
                
                // Parallel file existence checks — 10x faster than sequential for loop
                const checks = await Promise.all(
                    [...materials, ...pastQuestions].map(async (item) => {
                        // Check primary file
                        if (item.file_url) {
                            const localPath = AssetPathResolver.resolveLocalPath(item.id, 'document', item.file_url);
                            const info = await FileSystem.getInfoAsync(localPath);
                            if (info.exists && (info as any).size > 0) return item.id;
                        }
                        // Check files array for multiple attachments
                        if (item.files && Array.isArray(item.files)) {
                            for (const f of item.files) {
                                if (f.url) {
                                    const localPath = AssetPathResolver.resolveLocalPath(item.id, 'document', f.url);
                                    const info = await FileSystem.getInfoAsync(localPath);
                                    if (info.exists && (info as any).size > 0) return item.id;
                                }
                            }
                        }
                        return null;
                    })
                );
                
                const downloaded = checks.filter(Boolean) as string[];
                set({ downloadedIds: [...new Set(downloaded)] });
            },

            incrementDownloadCount: async (id, type) => {
                try {
                    const rpcName = type === 'material' ? 'increment_material_download_count' : 'increment_pq_download_count';
                    const paramName = type === 'material' ? 'material_id' : 'pq_id';
                    
                    const { error } = await (supabase as any).rpc(rpcName as any, {
                        [paramName]: id
                    });
                    if (error) throw error;

                    // Update local state
                    if (type === 'material') {
                        set((state) => ({
                            materials: state.materials.map((m) =>
                                m.id === id ? { ...m, download_count: m.download_count + 1 } : m
                            ),
                        }));
                    } else {
                        set((state) => ({
                            pastQuestions: state.pastQuestions.map((pq) =>
                                pq.id === id ? { ...pq, download_count: pq.download_count + 1 } : pq
                            ),
                        }));
                    }
                    
                    await get().refreshDownloadedStatus();
                } catch {
                    // silent — download count is telemetry, not critical
                }
            },

            incrementViewCount: async (id, type) => {
                try {
                    const rpcName = type === 'material' ? 'increment_material_view_count' : 'increment_pq_view_count';
                    const paramName = type === 'material' ? 'material_id' : 'pq_id';
                    
                    const { error } = await (supabase as any).rpc(rpcName as any, {
                        [paramName]: id
                    });
                    if (error) throw error;

                    if (type === 'material') {
                        set((state) => ({
                            materials: state.materials.map((m) =>
                                m.id === id ? { ...m, view_count: (m.view_count || 0) + 1 } : m
                            ),
                        }));
                    } else {
                        set((state) => ({
                            pastQuestions: state.pastQuestions.map((pq) =>
                                pq.id === id ? { ...pq, view_count: (pq.view_count || 0) + 1 } : pq
                            ),
                        }));
                    }
                } catch {
                    // silent — view count is telemetry, not critical
                }
            },

            deleteResource: async (id, type) => {
                try {
                    set({ isLoading: true, error: null });
                    const { error } = await (supabase as any).from(type).delete().eq('id', id);
                    if (error) throw error;
                    
                    if (type === 'materials') {
                        set(state => ({ materials: state.materials.filter(m => m.id !== id) }));
                    } else {
                        set(state => ({ pastQuestions: state.pastQuestions.filter(p => p.id !== id) }));
                    }
                    set({ isLoading: false });
                } catch (error) {
                    captureStoreError('resource', 'deleteResource', error, { id, type });
                    set({
                        error: (error as any)?.message || 'Failed to delete resource',
                        isLoading: false
                    });
                    throw error;
                }
            },

            clearError: () => set({ error: null }),
            clearCache: () => set({
                materials: [],
                pastQuestions: [],
                courses: [],
                downloadedIds: [],
                lastFetchMaterials: null,
                lastFetchPastQuestions: null,
                lastFetchCourses: null,
                error: null,
            }),
        }),
        {
            name: 'resource-storage',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                materials: state.materials,
                pastQuestions: state.pastQuestions,
                courses: state.courses,
                downloadedIds: state.downloadedIds,
                lastFetchMaterials: state.lastFetchMaterials,
                lastFetchPastQuestions: state.lastFetchPastQuestions,
                lastFetchCourses: state.lastFetchCourses,
            }),
            onRehydrateStorage: (state) => {
                return (state, error) => {
                    if (!error && state) {
                        state.refreshDownloadedStatus();
                    }
                };
            },
        }
    )
);

