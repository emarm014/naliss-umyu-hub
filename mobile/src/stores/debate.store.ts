import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

export type DebateRound = {
    round_name: string;
    speaker_id: string;
    speaker_side: 'affirmative' | 'opposition' | string;
    duration_sec: number;
};

export type DebateState = {
    rounds: DebateRound[];
    current_round_index: number;
    active_speaker_id: string | null;
    turn_ends_at: string | null;
    completed_at?: string | null;
};

export type DebateStoreState = {
    // poolId -> submitted round indices (to prevent re-submission)
    submittedRounds: Record<string, number[]>;
    isSubmitting: boolean;
    isAdvancing: boolean;

    // Actions
    markRoundSubmitted: (poolId: string, roundIndex: number) => void;
    hasSubmittedRound: (poolId: string, roundIndex: number) => boolean;

    // RPCs
    advanceTurn: (poolId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    submitEntry: (poolId: string, content: Record<string, any>) => Promise<{ success: boolean; data?: any; error?: string }>;
};

export const useDebateStore = create<DebateStoreState>()(
    persist(
        (set, get) => ({
            submittedRounds: {},
            isSubmitting: false,
            isAdvancing: false,

            markRoundSubmitted: (poolId, roundIndex) => {
                set((state) => {
                    const existing = state.submittedRounds[poolId] || [];
                    if (existing.includes(roundIndex)) return state;
                    return {
                        submittedRounds: {
                            ...state.submittedRounds,
                            [poolId]: [...existing, roundIndex]
                        }
                    };
                });
            },

            hasSubmittedRound: (poolId, roundIndex) => {
                const rounds = get().submittedRounds[poolId] || [];
                return rounds.includes(roundIndex);
            },

            advanceTurn: async (poolId: string) => {
                if (get().isAdvancing) return { success: false, error: 'Already advancing' };
                set({ isAdvancing: true });

                try {
                    const { data, error } = await supabase.rpc('advance_debate_turn', {
                        p_pool_id: poolId
                    });

                    if (error) {
                        console.error('Advance Turn Error:', error);
                        return { success: false, error: error.message };
                    }

                    return { success: true, data };
                } catch (err: any) {
                    console.error('Advance Turn Exception:', err);
                    return { success: false, error: err.message || 'Failed to advance turn' };
                } finally {
                    set({ isAdvancing: false });
                }
            },

            submitEntry: async (poolId: string, content: Record<string, any>) => {
                if (get().isSubmitting) return { success: false, error: 'Already submitting' };
                set({ isSubmitting: true });

                try {
                    const { data, error } = await supabase.rpc('submit_debate_entry', {
                        p_pool_id: poolId,
                        p_content: content
                    });

                    if (error) {
                        console.error('Submit Entry Error:', error);
                        return { success: false, error: error.message };
                    }

                    return { success: true, data };
                } catch (err: any) {
                    console.error('Submit Entry Exception:', err);
                    return { success: false, error: err.message || 'Failed to submit entry' };
                } finally {
                    set({ isSubmitting: false });
                }
            }
        }),
        {
            name: 'debate-storage',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                submittedRounds: state.submittedRounds,
            }),
        }
    )
);
