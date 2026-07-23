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

      fetchUnreadCount: async () => {
        try {
          const lastOpened = get().lastOpenedAt;
          let query = supabase.from('archives').select('id', { count: 'exact', head: true });
          if (lastOpened) {
            query = query.gt('created_at', lastOpened);
          }
          const { count, error } = await query;
          if (!error && count !== null) {
            set({ unreadCount: count });
          }
        } catch (err) {}
      },

      markAsRead: () => {
        set({ lastOpenedAt: new Date().toISOString(), unreadCount: 0 });
      },

      fetchArchives: async (pageIndex = 0, force = false) => {
        const { archives, hasMore, isFetchingMore } = get();
        
        if (pageIndex > 0 && (!hasMore || isFetchingMore)) return;
        
        if (!force && pageIndex === 0 && archives.length > 0 && !useNetworkStore.getState().isOnline) {
          // Strictly offline reliable, never load
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
