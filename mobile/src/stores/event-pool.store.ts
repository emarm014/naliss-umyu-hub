import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { useNetworkStore } from './network.store';

export type EventPool = {
    id: string;
    title: string;
    description: string;
    status: 'scheduled' | 'live' | 'completed';
    start_time: string;
    end_time: string | null;
    banner_url: string | null;
    type?: string;
    participation_rule: 'open' | 'level_based' | 'role_based' | 'custom_list' | 'department_based' | 'individual_selection' | string;
    target_constraints: any;
    reward_type: 'certificate' | 'points' | 'physical' | 'none';
    reward_details: string | null;
    created_at: string;
    featured_students?: {
        id: string;
        user_id: string;
        title: string;
        users: { full_name: string; username: string; avatar_url: string | null };
    }[];
};

interface EventPoolState {
  pools: EventPool[];
  isLoading: boolean;
  lastFetch: number | null;
  serverTimeOffset: number;
  
  fetchPools: (force?: boolean) => Promise<void>;
  fetchServerTimeOffset: () => Promise<void>;
}

export const useEventPoolStore = create<EventPoolState>()(
  persist(
    (set, get) => ({
      pools: [],
      isLoading: false,
      lastFetch: null,
      serverTimeOffset: 0,

      fetchServerTimeOffset: async () => {
        try {
            const startFetch = Date.now();
            const { data, error } = await supabase.rpc('get_server_time');
            if (!error && data) {
                const latency = (Date.now() - startFetch) / 2;
                set({ serverTimeOffset: new Date(data).getTime() - Date.now() + latency });
            }
        } catch {}
      },

      fetchPools: async (force = false) => {
        if (!force && get().pools.length > 0 && !useNetworkStore.getState().isOnline) {
          // Strictly offline reliable, never load
          return;
        }

        if (get().pools.length === 0) set({ isLoading: true });

        try {
          await get().fetchServerTimeOffset();
          const { data, error } = await (supabase as any)
            .from('event_pools')
            .select(`
                *,
                featured_students (
                    id, user_id, title, type,
                    users!featured_students_user_id_fkey ( full_name, username, avatar_url )
                )
            `)
            .in('status', ['live', 'scheduled', 'completed'])
            .order('start_time', { ascending: false });

          if (error) throw error;

          const typedData = (data as any[]).map(pool => ({
            ...pool,
            featured_students: pool.featured_students?.filter((fs: any) => fs.type === 'event_winner' || fs.title?.includes('Winner')) || []
          }));
          
          set({ 
            pools: typedData, 
            isLoading: false, 
            lastFetch: Date.now() 
          });
        } catch (err) {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'event-pool-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        pools: state.pools,
        lastFetch: state.lastFetch,
      })
    }
  )
);
