import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';

export interface Announcement {
    id: string;
    title: string;
    content: string;
    cover_image_url: string | null;
    category: 'general' | 'academic' | 'social' | 'event' | string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    target_level: string | null;
    is_published: boolean;
    is_pinned: boolean;
    view_count: number;
    published_at: string | null;
    created_at: string;
    updated_at: string;
}

interface AnnouncementState {
    announcements: Announcement[];
    readIds: string[];
    isLoading: boolean;
    lastFetch: number | null;
    error: string | null;
    fetchAnnouncements: (level?: string | null, force?: boolean) => Promise<void>;
    fetchReadStatus: () => Promise<void>;
    markAsRead: (announcementId: string) => Promise<void>;
    markAllAsRead: (level?: string | null) => Promise<void>;
}

// No TTL — cached data never expires. Always available offline indefinitely.
// Background refresh happens when online, but cache is never invalidated.
const CACHE_TTL = Infinity;

export const useAnnouncementStore = create<AnnouncementState>()(
    persist(
        (set, get) => ({
            announcements: [],
            readIds: [],
            isLoading: false,
            lastFetch: null,
            error: null,

            fetchAnnouncements: async (level, force = false) => {
                const { lastFetch, announcements } = get();
                const isFresh = lastFetch && Date.now() - lastFetch < CACHE_TTL && announcements.length > 0;

                // Stale-while-revalidate: show cached data immediately, refresh in background
                if (!force && isFresh) return;

                // OFFLINE GUARD: If offline and we have cached data, serve it immediately
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                // If we have cached data, don't show loading spinner — update silently
                if (announcements.length === 0) set({ isLoading: true });
                set({ error: null });

                try {
                    let query = supabase
                        .from('announcements')
                        .select('*')
                        .eq('is_published', true)
                        .order('is_pinned', { ascending: false })
                        .order('created_at', { ascending: false });

                    if (level) {
                        query = query.or(`target_level.is.null,target_level.eq.${level}`);
                    }

                    const { data, error } = await query.limit(50);

                    if (error) throw error;
                    
                    set({ announcements: (data as unknown) as Announcement[], isLoading: false, lastFetch: Date.now() });
                } catch (error) {
                    // Offline or network error — keep showing cached data, don't clear it
                    const isNetworkError = error instanceof Error && 
                        (error.message.includes('network') || error.message.includes('fetch') || 
                         error.message.includes('Failed') || error.message.includes('abort'));
                    set({
                        error: isNetworkError ? null : (error instanceof Error ? error.message : 'Failed to fetch'),
                        isLoading: false
                        // announcements NOT cleared — cached data stays visible
                    });
                }
            },

            fetchReadStatus: async () => {
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session?.user) return;

                    const { data, error } = await (supabase
                        .from('user_announcement_reads' as any)
                        .select('announcement_id')
                        .eq('user_id', session.user.id) as any);

                    if (!error && data) {
                        set({ readIds: data.map((r: any) => r.announcement_id) });
                    }
                } catch {
                    // silent — read status is non-critical
                }
            },

            markAsRead: async (announcementId) => {
                // Optimistic update first
                set(state => ({ readIds: [...new Set([...state.readIds, announcementId])] }));
                try {
                    await (supabase.rpc('mark_announcement_as_read' as any, { a_id: announcementId }) as any);
                } catch {
                    // silent — read tracking is non-critical
                }
            },

            markAllAsRead: async (level) => {
                // Optimistic update first
                const allIds = get().announcements.map(a => a.id);
                set(state => ({ readIds: [...new Set([...state.readIds, ...allIds])] }));
                try {
                    await (supabase.rpc('mark_all_announcements_as_read' as any, { u_level: level || null }) as any);
                } catch {
                    // silent — read tracking is non-critical
                }
            }
        }),
        {
            name: 'announcement-storage',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                announcements: state.announcements,
                readIds: state.readIds,
                lastFetch: state.lastFetch,
            }),
        }
    )
);

