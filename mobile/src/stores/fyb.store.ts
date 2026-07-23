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
  
  fetchFeatured: (force?: boolean) => Promise<void>;
}

export const useFYBStore = create<FYBState>()(
  persist(
    (set, get) => ({
      entries: [],
      isLoading: false,
      lastFetch: null,

      fetchFeatured: async (force = false) => {
        if (!force && get().entries.length > 0 && !useNetworkStore.getState().isOnline) {
          // If offline and we have cache, NEVER load/spin.
          return;
        }

        if (get().entries.length === 0) set({ isLoading: true });

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
          
          set({ 
            entries: (data || []) as unknown as FeaturedStudentEntry[], 
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
      })
    }
  )
);
