import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

export type CompositionState = {
    // poolId -> Draft Text
    essayDrafts: Record<string, string>;
    // poolId -> { url, type }
    challengeDrafts: Record<string, { url: string, type: 'image' | 'video' | 'raw' }>;
    // poolId -> ms timestamp of last MMKV save
    lastSavedAt: Record<string, number>;
    isSubmitting: boolean;

    // Actions
    setEssayDraft: (poolId: string, text: string) => void;
    setChallengeDraft: (poolId: string, draft: { url: string, type: 'image' | 'video' | 'raw' }) => void;
    getEssayDraft: (poolId: string) => string;
    getChallengeDraft: (poolId: string) => { url: string, type: 'image' | 'video' | 'raw' } | null;
    getLastSavedAt: (poolId: string) => number | null;
    clearDraft: (poolId: string) => void;
    
    // Submit
    submitEvaluation: (poolId: string, payload: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
};

export const useCompositionStore = create<CompositionState>()(
    persist(
        (set, get) => ({
            essayDrafts: {},
            challengeDrafts: {},
            lastSavedAt: {},
            isSubmitting: false,

            setEssayDraft: (poolId, text) => {
                set((state) => ({
                    essayDrafts: {
                        ...state.essayDrafts,
                        [poolId]: text
                    },
                    lastSavedAt: {
                        ...state.lastSavedAt,
                        [poolId]: Date.now()
                    }
                }));
            },

            setChallengeDraft: (poolId, draft) => {
                set((state) => ({
                    challengeDrafts: {
                        ...state.challengeDrafts,
                        [poolId]: draft
                    },
                    lastSavedAt: {
                        ...state.lastSavedAt,
                        [poolId]: Date.now()
                    }
                }));
            },

            getEssayDraft: (poolId) => {
                return get().essayDrafts[poolId] || '';
            },

            getChallengeDraft: (poolId) => {
                return get().challengeDrafts[poolId] || null;
            },

            getLastSavedAt: (poolId) => {
                return get().lastSavedAt[poolId] || null;
            },

            clearDraft: (poolId) => {
                set((state) => {
                    const newEssays = { ...state.essayDrafts };
                    const newChallenges = { ...state.challengeDrafts };
                    const newSaved = { ...state.lastSavedAt };
                    delete newEssays[poolId];
                    delete newChallenges[poolId];
                    delete newSaved[poolId];
                    return {
                        essayDrafts: newEssays,
                        challengeDrafts: newChallenges,
                        lastSavedAt: newSaved
                    };
                });
            },

            submitEvaluation: async (poolId: string, payload: Record<string, any>) => {
                if (get().isSubmitting) return { success: false, error: 'Already submitting' };
                set({ isSubmitting: true });
                
                try {
                    // Enrich essay payloads with word_count and submitted_client_time
                    const enrichedPayload = { ...payload };
                    if (typeof enrichedPayload.text === 'string') {
                        enrichedPayload.word_count = enrichedPayload.text.trim().split(/\s+/).filter(Boolean).length;
                    }
                    enrichedPayload.submitted_client_time = new Date().toISOString();

                    const { error } = await supabase.rpc('submit_manual_evaluation', {
                        p_pool_id: poolId,
                        p_payload: enrichedPayload
                    });

                    if (error) {
                        if (!error.message?.toLowerCase().includes('already')) {
                            console.error('Submit Evaluation Error:', error);
                        }
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
