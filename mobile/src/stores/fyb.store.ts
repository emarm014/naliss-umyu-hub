import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { useNetworkStore } from './network.store';

export type FeaturedStudentEntry = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  custom_image_url: string | null;
  is_active: boolean;
  published_at: string;
  expires_at: string | null;
  total_congratulations: number;
  created_at: string;
  users: {
    full_name: string;
    username: string;
    avatar_url: string | null;
  };
};

interface FYBState {
  entries: FeaturedStudentEntry[];
  isLoading: boolean;
  lastFetch: number | null;
  unreadCount: number;
  lastOpenedAt: string | null;
  
  fetchFeatured: (force?: boolean) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: () => void;
  clearCache: () => void;
}

export const useFYBStore = create<FYBState>()(
  persist(
    (set, get) => ({
      entries: [],
      isLoading: false,
      lastFetch: null,
      unreadCount: 0,
      lastOpenedAt: null,

      clearCache: () => set({ entries: [], lastFetch: null, unreadCount: 0 }),

      fetchUnreadCount: async () => {
        try {
          const lastOpened = get().lastOpenedAt;
          if (!lastOpened) {
            set({ lastOpenedAt: new Date().toISOString(), unreadCount: 0 });
            return;
          }
          const { count, error } = await supabase.from('featured_students')
            .select('id', { count: 'exact', head: true })
            .gt('created_at', lastOpened);
          if (!error && count !== null) {
            set({ unreadCount: count });
          }
        } catch (err) {}
      },

      markAsRead: () => {
        set({ lastOpenedAt: new Date().toISOString(), unreadCount: 0 });
      },

      fetchFeatured: async (force = false) => {
        const { entries } = get();

        // LOCAL-FIRST: read from SQLite cache immediately (always works — even on new device)
        if (!force && entries.length === 0) {
          try {
            const { getCachedEntityList } = require('../lib/database');
            const cached = await getCachedEntityList('featured_students');
            if (cached.length > 0) {
              set({ entries: cached as any[], isLoading: false });
            }
          } catch { /* fall through to server fetch */ }
        }

        const { useNetworkStore } = require('./network.store');
        if (!force && get().entries.length > 0 && !useNetworkStore.getState().isOnline) {
          // If offline and we have cache, NEVER load/spin.
          return;
        }

        // Only show full loading state if we have never fetched before
        if (!get().lastFetch && get().entries.length === 0) set({ isLoading: true });

        try {
          const { data, error } = await supabase
            .from('featured_students')
            .select(`
              id, user_id, type, title, subtitle, description,
              custom_image_url, is_active, published_at, expires_at,
              total_congratulations, created_at,
              users!featured_students_user_id_fkey ( full_name, username, avatar_url )
            `)
            .neq('type' as any, 'event_winner' as any)
            .order('published_at', { ascending: false });

          if (error) throw error;

          const items = (data || []) as unknown as FeaturedStudentEntry[];
          if (items.length > 0) {
            const { cacheEntityList } = require('../lib/database');
            cacheEntityList('featured_students', items, '').catch(() => {});

            // Background prefetch covers for offline
            const { getOptimizedCloudinaryUrl } = require('../lib/cloudinary');
            const { prefetchAsset } = require('../utils/prefetchAsset');
            items.forEach((item: any) => {
                const img = item.custom_image_url || item.users?.avatar_url;
                if (img) {
                    const homeUrl = getOptimizedCloudinaryUrl(img, 600, 400);
                    const posterEntityId = 'poster_' + homeUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
                    prefetchAsset(posterEntityId, homeUrl, 'poster');
                }
            });
          }
          
          set({ 
            entries: items, 
            isLoading: false, 
            lastFetch: Date.now() 
          });
        } catch (err) {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'fyb-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        entries: state.entries,
        lastFetch: state.lastFetch,
        unreadCount: state.unreadCount,
        lastOpenedAt: state.lastOpenedAt,
      })
    }
  )
);
