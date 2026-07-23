import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

export type CompositionState = {
    // poolId -> Draft Text
    essayDrafts: Record<string, string>;
    // poolId -> { url, type }
    challengeDrafts: Record<string, { url: string, type: 'image' | 'video' | 'raw' }>;
    isSubmitting: boolean;

    // Actions
    setEssayDraft: (poolId: string, text: string) => void;
    setChallengeDraft: (poolId: string, draft: { url: string, type: 'image' | 'video' | 'raw' }) => void;
    getEssayDraft: (poolId: string) => string;
    getChallengeDraft: (poolId: string) => { url: string, type: 'image' | 'video' | 'raw' } | null;
    clearDraft: (poolId: string) => void;
    
    // Submit
    submitEvaluation: (poolId: string, payload: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
};

export const useCompositionStore = create<CompositionState>()(
    persist(
        (set, get) => ({
            essayDrafts: {},
            challengeDrafts: {},
            isSubmitting: false,

            setEssayDraft: (poolId, text) => {
                set((state) => ({
                    essayDrafts: {
                        ...state.essayDrafts,
                        [poolId]: text
                    }
                }));
            },

            setChallengeDraft: (poolId, draft) => {
                set((state) => ({
                    challengeDrafts: {
                        ...state.challengeDrafts,
                        [poolId]: draft
                    }
                }));
            },

            getEssayDraft: (poolId) => {
                return get().essayDrafts[poolId] || '';
            },

            getChallengeDraft: (poolId) => {
                return get().challengeDrafts[poolId] || null;
            },

            clearDraft: (poolId) => {
                set((state) => {
                    const newEssays = { ...state.essayDrafts };
                    const newChallenges = { ...state.challengeDrafts };
                    delete newEssays[poolId];
                    delete newChallenges[poolId];
                    return {
                        essayDrafts: newEssays,
                        challengeDrafts: newChallenges
                    };
                });
            },

            submitEvaluation: async (poolId: string, payload: Record<string, any>) => {
                if (get().isSubmitting) return { success: false, error: 'Already submitting' };
                set({ isSubmitting: true });
                
                try {
                    const { error } = await supabase.rpc('submit_manual_evaluation', {
                        p_pool_id: poolId,
                        p_payload: payload
                    });

                    if (error) {
                        console.error('Submit Evaluation Error:', error);
                        return { success: false, error: error.message };
                    }

                    return { success: true };
                } catch (err: any) {
                    console.error('Submit Evaluation Exception:', err);
                    return { success: false, error: err.message || 'Failed to submit entry' };
                } finally {
                    set({ isSubmitting: false });
                }
            }
        }),
        {
            name: 'composition-storage',
            storage: createJSONStorage(() => mmkvStorage)
        }
    )
);
