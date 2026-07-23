import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

export type VotingState = {
    // poolId -> candidateUserId
    selectedCandidateDrafts: Record<string, string>;
    isSubmitting: boolean;

    // Actions
    setVoteDraft: (poolId: string, candidateUserId: string) => void;
    getVoteDraft: (poolId: string) => string;
    clearVoteDraft: (poolId: string) => void;
    
    // Submit RPC
    submitVote: (poolId: string, candidateUserId: string) => Promise<{ success: boolean; error?: string }>;
};

export const useVotingStore = create<VotingState>()(
    persist(
        (set, get) => ({
            selectedCandidateDrafts: {},
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

            submitVote: async (poolId: string, candidateUserId: string) => {
                if (get().isSubmitting) return { success: false, error: 'Submission in progress' };
                set({ isSubmitting: true });

                try {
                    const { data, error } = await supabase.rpc('submit_vote', {
                        p_pool_id: poolId,
                        p_candidate_user_id: candidateUserId
                    });

                    if (error) {
                        console.error('Submit Vote Error:', error);
                        return { success: false, error: error.message };
                    }

                    return { success: true };
                } catch (err: any) {
                    console.error('Submit Vote Exception:', err);
                    return { success: false, error: err.message || 'Failed to cast vote' };
                } finally {
                    set({ isSubmitting: false });
                }
            }
        }),
        {
            name: 'voting-storage',
            storage: createJSONStorage(() => mmkvStorage)
        }
    )
);
