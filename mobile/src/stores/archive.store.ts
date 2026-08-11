import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { useNetworkStore } from './network.store';

interface ArchiveState {
  archives: any[];
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  page: number;
  lastFetch: number | null;
  unreadCount: number;
  lastOpenedAt: string | null;
  
  fetchArchives: (pageIndex?: number, force?: boolean) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: () => void;
  clearCache: () => void;
}

export const useArchiveStore = create<ArchiveState>()(
  persist(
    (set, get) => ({
      archives: [],
      isLoading: false,
      isFetchingMore: false,
      hasMore: true,
      page: 0,
      lastFetch: null,
      unreadCount: 0,
      lastOpenedAt: null,

      clearCache: () => set({ archives: [], lastFetch: null, unreadCount: 0, page: 0, hasMore: true }),

      fetchUnreadCount: async () => {
        try {
          const lastOpened = get().lastOpenedAt;
          if (!lastOpened) {
            set({ lastOpenedAt: new Date().toISOString(), unreadCount: 0 });
            return;
          }
          const { count, error } = await supabase.from('archives')
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

      fetchArchives: async (pageIndex = 0, force = false) => {
        const { archives, hasMore, isFetchingMore, lastFetch } = get();
        
        if (pageIndex > 0 && (!hasMore || isFetchingMore)) return;

        // Freshness check (parity with other stores)
        const CACHE_TTL = Infinity;
        const isFresh = lastFetch && Date.now() - lastFetch < CACHE_TTL && archives.length > 0;
        if (!force && pageIndex === 0 && isFresh) return;
        
        // LOCAL-FIRST: read from SQLite cache immediately (always works)
        if (!force && pageIndex === 0 && archives.length === 0) {
          try {
            const { getCachedEntityList } = require('../lib/database');
            const cached = await getCachedEntityList('archives');
            if (cached.length > 0) {
              set({ archives: cached as any[], isLoading: false });
            }
          } catch { /* fall through to server fetch */ }
        }

        // STRICT OFFLINE GUARD: if offline, data from SQLite is already displayed.
        // Never attempt network request if offline, even on pull-to-refresh.
        const { useNetworkStore } = require('./network.store');
        if (!useNetworkStore.getState().isOnline) {
          set({ isLoading: false, isFetchingMore: false });
          return;
        }

        if (pageIndex === 0 && archives.length === 0) set({ isLoading: true });
        if (pageIndex > 0) set({ isFetchingMore: true });

        try {
          const { data, error } = await supabase
            .from('archives')
            .select('*')
            .order('created_at', { ascending: false })
            .range(pageIndex * 20, (pageIndex * 20) + 19);

          if (error) throw error;
          const items = (data || []) as any[];

          if (pageIndex === 0 && items.length > 0) {
            const { cacheEntityList } = require('../lib/database');
            cacheEntityList('archives', items, '').catch(() => {});
          }
          
          set((state) => ({
            archives: pageIndex === 0 ? items : [...state.archives, ...items],
            hasMore: items.length >= 20,
            page: pageIndex,
            isLoading: false,
            isFetchingMore: false,
            lastFetch: Date.now()
          }));
        } catch (err) {
          set({ isLoading: false, isFetchingMore: false, hasMore: false });
        }
      },
    }),
    {
      name: 'archive-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        archives: state.archives,
        lastFetch: state.lastFetch,
        unreadCount: state.unreadCount,
        lastOpenedAt: state.lastOpenedAt,
      })
    }
  )
);
