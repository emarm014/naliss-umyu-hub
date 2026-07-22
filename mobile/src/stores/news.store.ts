import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';

interface NewsState {
  news: any[];
  unreadCount: number;
  lastOpenedAt: string | null;
  lastFetchNews: number | null;
  isLoading: boolean;
  
  fetchUnreadCount: () => Promise<void>;
  markAsRead: () => void;
  fetchNews: (force?: boolean) => Promise<void>;
  clearCache: () => void;
}

const CACHE_TTL = Infinity;

export const useNewsStore = create<NewsState>()(
  persist(
    (set, get) => ({
      news: [],
      unreadCount: 0,
      lastOpenedAt: null,
      lastFetchNews: null,
      isLoading: false,

      fetchUnreadCount: async () => {
        try {
          const lastOpened = get().lastOpenedAt;
          let query = supabase.from('news').select('id', { count: 'exact', head: true });
          
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

      fetchNews: async (force = false) => {
        const { lastFetchNews, news } = get();
        const isFresh = lastFetchNews && Date.now() - lastFetchNews < CACHE_TTL && news.length > 0;
        
        if (!force && isFresh) return;

        // LOCAL-FIRST: read from SQLite cache immediately (always works)
        if (!force && news.length === 0) {
            try {
                const { getCachedEntityList } = require('../lib/database');
                const cached = await getCachedEntityList('news');
                if (cached.length > 0) {
                    set({ news: cached as any, isLoading: false });
                }
            } catch { /* fall through to server fetch */ }
        }

        // OFFLINE GUARD: if offline, data from SQLite is already displayed
        const { useNetworkStore } = require('./network.store');
        if (!useNetworkStore.getState().isOnline) {
            set({ isLoading: false });
            return;
        }

        if (get().news.length === 0) set({ isLoading: true });

        try {
          const { data, error } = await supabase
            .from('news')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

          if (error) throw error;

          const { cacheEntityList } = require('../lib/database');
          cacheEntityList('news', data, '').catch(() => {});
          
          set({ news: data as any[], isLoading: false, lastFetchNews: Date.now() });
        } catch (err) {
          Logger.error('news-store', 'fetchNews failed', err);
          set({ isLoading: false });
        }
      },

      clearCache: () => set({ news: [], lastFetchNews: null, unreadCount: 0 })
    }),
    {
      name: 'news-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        news: state.news,
        lastFetchNews: state.lastFetchNews,
        lastOpenedAt: state.lastOpenedAt,
      }),
    }
  )
);
