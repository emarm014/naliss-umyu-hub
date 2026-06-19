import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';

export interface Event {
    id: string;
    title: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue: string | null;
    cover_image_url: string | null;
    is_virtual: boolean;
    virtual_link: string | null;
    max_attendees: number | null;
    current_attendees: number;
    status: 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled';
    is_public: boolean;
    target_level: string | null;
    view_count: number;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    pool_id?: string | null;
}

interface EventState {
    events: Event[];
    isLoading: boolean;
    lastFetch: number | null;
    error: string | null;
    fetchUpcomingEvents: (level?: string | null, force?: boolean) => Promise<void>;
    clearCache: () => void;
}

const CACHE_TTL = Infinity; // No TTL — cached events available offline indefinitely

export const useEventStore = create<EventState>()(
    persist(
        (set, get) => ({
            events: [],
            isLoading: false,
            lastFetch: null,
            error: null,

            fetchUpcomingEvents: async (level, force = false) => {
                const { lastFetch, events } = get();
                const isFresh = lastFetch && Date.now() - lastFetch < CACHE_TTL && events.length > 0;

                if (!force && isFresh) return;

                // OFFLINE GUARD: serve cached data immediately
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                // Silent background refresh if we already have data
                if (events.length === 0) set({ isLoading: true });

                try {
                    const now = new Date().toISOString().split('T')[0];
                    let query = (supabase as any).from('events')
                        .select('*, event_pools(id)')
                        .in('status', ['published', 'ongoing'])
                        .gte('start_date', now);

                    if (level) {
                        query = query.or(`target_level.is.null,target_level.eq.${level}`);
                    }

                    const { data, error } = await query.order('start_date', { ascending: true }).limit(30);

                    if (error) throw error;

                    const mappedEvents = data.map((ev: any) => ({
                        ...ev,
                        pool_id: ev.event_pools && ev.event_pools.length > 0 ? ev.event_pools[0].id : null,
                        event_pools: undefined
                    }));

                    set({ events: mappedEvents as unknown as Event[], isLoading: false, lastFetch: Date.now() });
                } catch {
                    // Keep cached data on network failure
                    set({ isLoading: false });
                }
            },
            clearCache: () => set({ events: [], lastFetch: null, error: null }),
        }),
        {
            name: 'event-storage',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                events: state.events,
                lastFetch: state.lastFetch,
            }),
        }
    )
);

