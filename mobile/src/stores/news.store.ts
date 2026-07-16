import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

interface NewsState {
  unreadCount: number;
  lastOpenedAt: string | null;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: () => void;
}

export const useNewsStore = create<NewsState>()(
  persist(
    (set, get) => ({
      unreadCount: 0,
      lastOpenedAt: null,
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
      }
    }),
    {
      name: 'news-storage',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
