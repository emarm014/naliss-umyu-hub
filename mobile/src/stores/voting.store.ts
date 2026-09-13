import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

export type VotingResults = {
    is_sealed: boolean;
    total_votes: number;
    tallies?: Record<string, number>;
};

export type VotingState = {
    // poolId -> candidateUserId (draft selection before casting)
    selectedCandidateDrafts: Record<string, string>;
    // poolId_userId -> true (local ballot receipt, persisted across restarts)
    ballotReceipts: Record<string, boolean>;
    isSubmitting: boolean;

    // Actions
    setVoteDraft: (poolId: string, candidateUserId: string) => void;
    getVoteDraft: (poolId: string) => string;
    clearVoteDraft: (poolId: string) => void;
    hasVoted: (poolId: string, userId: string) => boolean;
    markVoted: (poolId: string, userId: string) => void;
    
    // Submit RPC (uses new cast_pool_vote)
    submitVote: (poolId: string, candidateUserId: string) => Promise<{ success: boolean; voted_at?: string; error?: string }>;
    // Fetch results RPC
    fetchResults: (poolId: string) => Promise<{ success: boolean; data?: VotingResults; error?: string }>;
};

export const useVotingStore = create<VotingState>()(
    persist(
        (set, get) => ({
            selectedCandidateDrafts: {},
            ballotReceipts: {},
            isSubmitting: false,

            setVoteDraft: (poolId, candidateUserId) => {
                set((state) => ({
                    selectedCandidateDrafts: {
                        ...state.selectedCandidateDrafts,
                        [poolId]: candidateUserId
                    }
                }));
            },

            getVoteDraft: (poolId) => {
                return get().selectedCandidateDrafts[poolId] || '';
            },

            clearVoteDraft: (poolId) => {
                set((state) => {
                    const newDrafts = { ...state.selectedCandidateDrafts };
                    delete newDrafts[poolId];
                    return {
                        selectedCandidateDrafts: newDrafts
                    };
                });
            },

            hasVoted: (poolId, userId) => {
                return !!get().ballotReceipts[`${poolId}_${userId}`];
            },

            markVoted: (poolId, userId) => {
                set((state) => ({
                    ballotReceipts: {
                        ...state.ballotReceipts,
                        [`${poolId}_${userId}`]: true
                    }
                }));
            },

            submitVote: async (poolId: string, candidateUserId: string) => {
                if (get().isSubmitting) return { success: false, error: 'Submission in progress' };
                set({ isSubmitting: true });

                try {
                    const { data, error } = await supabase.rpc('cast_pool_vote', {
                        p_pool_id: poolId,
                        p_option_id: candidateUserId
                    });

                    if (error) {
                        if (!error.message?.toLowerCase().includes('already')) {
                            console.error('Cast Vote Error:', error);
                        }
                        return { success: false, error: error.message };
                    }

                    const res = data as any;
                    return { success: true, voted_at: res?.voted_at };
                } catch (err: any) {
                    console.error('Cast Vote Exception:', err);
                    return { success: false, error: err.message || 'Failed to cast vote' };
                } finally {
                    set({ isSubmitting: false });
                }
            },

            fetchResults: async (poolId: string) => {
                try {
                    const { data, error } = await supabase.rpc('get_voting_results', {
                        p_pool_id: poolId
                    });

                    if (error) {
                        console.error('Fetch Results Error:', error);
                        return { success: false, error: error.message };
                    }

                    return { success: true, data: data as unknown as VotingResults };
                } catch (err: any) {
                    console.error('Fetch Results Exception:', err);
                    return { success: false, error: err.message || 'Failed to fetch results' };
                }
            }
        }),
        {
            name: 'voting-storage',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                selectedCandidateDrafts: state.selectedCandidateDrafts,
                ballotReceipts: state.ballotReceipts,
            }),
        }
    )
);
