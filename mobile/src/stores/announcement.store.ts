import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { captureStoreError, isNetworkError } from '../utils/sentry';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  cover_image_url: string | null;
  category: 'general' | 'academic' | 'social' | 'event' | string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  target_level: string | null;
  pool_id: string | null;
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
  clearCache: () => void;
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

        // LOCAL-FIRST: read from SQLite cache immediately (always works — even on new device)
        if (!force && announcements.length === 0) {
          try {
            const { getCachedEntityList } = require('../lib/database');
            const cached = await getCachedEntityList('announcements');
            if (cached.length > 0) {
              set({ announcements: cached as any, isLoading: false });
            }
          } catch { /* fall through to server fetch */ }
        }

        // OFFLINE GUARD: if offline, data from SQLite is already displayed
        const { useNetworkStore } = require('./network.store');
        if (!useNetworkStore.getState().isOnline) {
          set({ isLoading: false });
          return;
        }

        // SESSION GUARD: Don't query if unauthenticated — avoids 401 spam after logout
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          set({ isLoading: false });
          return;
        }

        // If we still have no data, show loading spinner
        if (get().announcements.length === 0) set({ isLoading: true });
        set({ error: null });

        try {
          let query = (supabase as any).from('announcements')
            .select('*')
            .eq('is_published', true)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

          if (level) {
            query = query.or(`target_level.is.null,target_level.eq.${level}`);
          }

          const { data, error } = await query.limit(50);

          // Convert Supabase error object to a real Error so Sentry captures it
          // as a proper exception (not "Object captured as exception with keys: code, details, hint, message")
          if (error) {
            const err = new Error(error.message || 'Supabase query failed');
            (err as any).code = error.code;
            (err as any).details = error.details;
            (err as any).hint = error.hint;
            throw err;
          }

          const { cacheEntityList } = require('../lib/database');
          cacheEntityList('announcements', data, session.user.id).catch(() => {});
          
          // Background prefetch covers for offline
          const { getOptimizedCloudinaryUrl } = require('../lib/cloudinary');
          const { prefetchAsset } = require('../utils/prefetchAsset');
          data.forEach((ann: any) => {
              if (ann.cover_image_url) {
                  // Prefetch for Home tab (CachedImage, 600x400, entityId = ann.id)
                  const homeUrl = getOptimizedCloudinaryUrl(ann.cover_image_url, 600, 400);
                  prefetchAsset(ann.id, homeUrl, 'announcement_cover');

                  // Prefetch for Updates tab (PosterImage, 800 width, entityId = auto generated)
                  const updatesUrl = getOptimizedCloudinaryUrl(ann.cover_image_url, 800);
                  const posterEntityId = 'poster_' + updatesUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
                  prefetchAsset(posterEntityId, updatesUrl, 'poster');
              }
          });

          set({ announcements: (data as unknown) as Announcement[], isLoading: false, lastFetch: Date.now() });
        } catch (error) {
          // Offline or network error — keep showing cached data, don't clear it
          const isNetErr = isNetworkError(error);
          if (!isNetErr) {
            captureStoreError('announcement', 'fetchAnnouncements', error, { level });
          }
          set({
            error: isNetErr ? null : ((error as any)?.message || 'Failed to fetch'),
            isLoading: false,
            // announcements NOT cleared — cached data stays visible
          });
        }
      },

      fetchReadStatus: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) return;

          const { data, error } = await ((supabase as any).from('user_announcement_reads' as any)
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
          await ((supabase as any).rpc('mark_announcement_as_read' as any, { a_id: announcementId }) as any);
        } catch {
          // silent — read tracking is non-critical
        }
      },

      markAllAsRead: async (level) => {
        // Optimistic update first
        const allIds = get().announcements.map(a => a.id);
        set(state => ({ readIds: [...new Set([...state.readIds, ...allIds])] }));
        try {
          await ((supabase as any).rpc('mark_all_announcements_as_read' as any, { u_level: level || null }) as any);
        } catch {
          // silent — read tracking is non-critical
        }
      },

      clearCache: () => set({ announcements: [], readIds: [], lastFetch: null, error: null }),
    }),
    {
      name: 'announcement-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        announcements: state.announcements,
        readIds: state.readIds,
        lastFetch: state.lastFetch,
      }),
    }
  )
);
