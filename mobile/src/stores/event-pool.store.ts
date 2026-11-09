import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { useNetworkStore } from './network.store';
import { normalizeError } from '../utils/sentry';

export type EventPool = {
    id: string;
    title: string;
    description: string;
    status: 'draft' | 'scheduled' | 'live' | 'completed' | 'archived';
    computedStatus?: 'draft' | 'scheduled' | 'live' | 'completed' | 'archived';
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
    /** All officially declared winners, sorted by position (1 = winner). */
    winners?: PoolWinner[];
};

export type PoolWinner = {
    key: string;
    user_id: string | null;
    name: string;
    avatar_url: string | null;
    /** 1 = Winner, 2 = 1st Runner-Up, 3 = 2nd Runner-Up, ... */
    position: number;
    /** Human readable label, e.g. "Winner", "1st Runner-Up" or an election post title. */
    label: string;
};

const PODIUM_LABELS: Record<number, string> = {
    1: 'Winner',
    2: '1st Runner-Up',
    3: '2nd Runner-Up',
    4: '4th Position',
    5: '5th Position',
};

export const getPodiumLabel = (position: number | null | undefined): string => {
    if (!position) return 'Participant';
    return PODIUM_LABELS[position] || `${position}th Position`;
};

const podiumStatusToPosition = (status: string | null | undefined): number | null => {
    if (!status) return null;
    const entry = Object.entries(PODIUM_LABELS).find(([, label]) => label === status.trim());
    return entry ? Number(entry[0]) : null;
};

const podiumRankToPosition = (rank: string | null | undefined): number => {
    const parsed = parseInt(String(rank ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

/**
 * Loads every declared winner across all pools from the publicly readable sources:
 *  - pool_participants.winner_position  (quiz / essay / challenge / debate)
 *  - pool_candidates.is_winner          (voting / talent)
 * Failures are isolated so the pool list itself always renders.
 */
const fetchDeclaredWinners = async (): Promise<Record<string, PoolWinner[]>> => {
    const byPool: Record<string, PoolWinner[]> = {};
    const push = (poolId: string, w: PoolWinner) => {
        if (!byPool[poolId]) byPool[poolId] = [];
        byPool[poolId].push(w);
    };

    const [participantsRes, candidatesRes] = await Promise.all([
        (supabase as any)
            .from('pool_participants')
            .select('id, pool_id, user_id, winner_position, users:user_id ( full_name, username, avatar_url )')
            .not('winner_position', 'is', null),
        (supabase as any)
            .from('pool_candidates')
            .select('id, pool_id, candidate_user_id, display_name, photo_url, position_title, podium_rank, users:candidate_user_id ( full_name, username, avatar_url )')
            .eq('is_winner', true),
    ]);

    if (participantsRes.error) {
        console.warn('[event-pool] Failed to load participant winners:', participantsRes.error.message);
    } else {
        for (const p of participantsRes.data || []) {
            push(p.pool_id, {
                key: `participant_${p.id}`,
                user_id: p.user_id,
                name: p.users?.full_name || p.users?.username || 'Participant',
                avatar_url: p.users?.avatar_url ?? null,
                position: p.winner_position,
                label: getPodiumLabel(p.winner_position),
            });
        }
    }

    if (candidatesRes.error) {
        console.warn('[event-pool] Failed to load candidate winners:', candidatesRes.error.message);
    } else {
        for (const c of candidatesRes.data || []) {
            const position = podiumRankToPosition(c.podium_rank);
            const post = c.position_title && c.position_title !== 'General' ? c.position_title : null;
            push(c.pool_id, {
                key: `candidate_${c.id}`,
                user_id: c.candidate_user_id ?? null,
                name: c.users?.full_name || c.display_name || 'Candidate',
                avatar_url: c.photo_url || c.users?.avatar_url || null,
                position,
                label: post ? `${post} — ${getPodiumLabel(position)}` : getPodiumLabel(position),
            });
        }
    }

    return byPool;
};

const sortWinners = (winners: PoolWinner[]) =>
    [...winners].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));

interface EventPoolState {
  pools: EventPool[];
  isLoading: boolean;
  lastFetch: number | null;
  serverTimeOffset: number;
  
  fetchPools: (force?: boolean) => Promise<void>;
  fetchServerTimeOffset: () => Promise<void>;
  clearCache: () => void;
  clearUserData: () => void;
  clearContentCache: () => void;
}

export const useEventPoolStore = create<EventPoolState>()(
  persist(
    (set, get) => ({
      pools: [],
      isLoading: false,
      lastFetch: null,
      serverTimeOffset: 0,

      clearCache: () => set({ pools: [], lastFetch: null }),
      clearUserData: () => set({}),
      clearContentCache: () => set({ lastFetch: null }),

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
        const { pools } = get();

        // LOCAL-FIRST: read from SQLite cache immediately (always works — even on new device)
        if (!force && pools.length === 0) {
          try {
            const { getCachedEntityList } = require('../lib/database');
            const cached = await getCachedEntityList('event_pools');
            if (cached.length > 0) {
              set({ pools: cached as any[], isLoading: false });
            }
          } catch { /* fall through to server fetch */ }
        }

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
            .in('status', ['draft', 'scheduled', 'live', 'completed', 'archived'])
            .order('start_time', { ascending: false });

          if (error) throw normalizeError(error);

          const winnersByPool = await fetchDeclaredWinners().catch((e) => {
            console.warn('[event-pool] Failed to load declared winners:', e?.message || e);
            return {} as Record<string, PoolWinner[]>;
          });

          const typedData = (data as any[]).map(pool => {
            const featured = pool.featured_students?.filter((fs: any) => fs.type === 'event_winner' || fs.title?.includes('Winner')) || [];

            let winners: PoolWinner[] = winnersByPool[pool.id] || [];
            // Legacy fallback: pools whose winners were only "featured" (no declared position)
            if (winners.length === 0 && featured.length > 0) {
              winners = featured.map((fs: any) => {
                const position = podiumStatusToPosition(String(fs.title || '').split('—')[0]) ?? 1;
                return {
                  key: `featured_${fs.id}`,
                  user_id: fs.user_id,
                  name: fs.users?.full_name || fs.users?.username || 'Winner',
                  avatar_url: fs.users?.avatar_url ?? null,
                  position,
                  label: getPodiumLabel(position),
                };
              });
            }

            return {
              ...pool,
              featured_students: featured,
              winners: sortWinners(winners),
            };
          });

          if (typedData.length > 0) {
            const { cacheEntityList } = require('../lib/database');
            cacheEntityList('event_pools', typedData, '').catch(() => {});
          }
          
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
