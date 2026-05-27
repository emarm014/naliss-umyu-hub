import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';
import { Material, Course, MaterialType, AcademicLevel, SemesterType, PastQuestion } from '../types';
import { checkFileExists, extractFileNameFromUrl } from '../utils/download';
import { captureStoreError } from '../utils/sentry';

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

                // OFFLINE GUARD: serve cached data immediately
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                if (materials.length === 0) set({ isLoading: true });
                set({ error: null });

                try {
                    let query = supabase
                        .from('materials')
                        .select('*')
                        .eq('is_active', true);

                    if (filters?.type && filters.type !== 'all' as any) {
                        query = query.eq('material_type', filters.type);
                    }
                    if (filters?.courseId) query = query.eq('course_id', filters.courseId);
                    if (filters?.level) query = query.eq('level', filters.level);
                    if (filters?.semester) query = query.eq('semester', filters.semester);

                    const { data, error } = await query.order('created_at', { ascending: false });

                    if (error) throw error;
                    
                    const materials = (data as unknown) as Material[];
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

                // OFFLINE GUARD: serve cached data immediately
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                if (pastQuestions.length === 0) set({ isLoading: true });
                set({ error: null });

                try {
                    let query = supabase
                        .from('past_questions' as any)
                        .select('*, course:course_id(*)')
                        .eq('is_public', true);

                    if (filters?.courseId) query = query.eq('course_id', filters.courseId);
                    if (filters?.level) query = query.eq('level', filters.level);
                    if (filters?.semester) query = query.eq('semester', filters.semester);

                    const { data, error } = await query.order('created_at', { ascending: false });

                    if (error) throw error;
                    
                    const pastQuestions = (data as unknown) as PastQuestion[];
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

                // OFFLINE GUARD: serve cached data immediately
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                if (courses.length === 0) set({ isLoading: true });

                try {
                    let query = supabase.from('courses')
                        .select('*, lecturer:lecturers!courses_lecturer_id_fkey(id, full_name, title)')
                        .eq('is_active', true);
                    if (level) query = query.eq('level', level);
                    const { data, error } = await query.order('code');
                    if (error) throw error;
                    set({ courses: (data as unknown) as Course[], isLoading: false, lastFetchCourses: Date.now() });
                } catch (err) {
                    captureStoreError('resource', 'fetchCourses', err, { level });
                    set({ isLoading: false });
                }
            },


            refreshDownloadedStatus: async () => {
                const { materials, pastQuestions } = get();
                
                // Parallel file existence checks — 10x faster than sequential for loop
                const checks = await Promise.all(
                    [...materials, ...pastQuestions].map(async (item) => {
                        if (!item.file_url) return null;
                        const realName = item.file_name || extractFileNameFromUrl(item.file_url, item.id);
                        const exists = await checkFileExists(`${item.id}_${realName.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()}`);
                        return exists ? item.id : null;
                    })
                );
                
                const downloaded = checks.filter(Boolean) as string[];
                set({ downloadedIds: [...new Set(downloaded)] });
            },

            incrementDownloadCount: async (id, type) => {
                try {
                    const rpcName = type === 'material' ? 'increment_material_download_count' : 'increment_pq_download_count';
                    const paramName = type === 'material' ? 'material_id' : 'pq_id';
                    
                    const { error } = await supabase.rpc(rpcName as any, {
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
                    
                    const { error } = await supabase.rpc(rpcName as any, {
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
            storage: createJSONStorage(() => AsyncStorage),
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

