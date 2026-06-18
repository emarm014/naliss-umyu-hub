import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { captureStoreError } from '../utils/sentry';

interface QuizState {
  // pool_id -> { question_id: answer_value }
  answers: Record<string, Record<string, string>>;
  isSubmitting: boolean;
  
  setAnswer: (poolId: string, questionId: string, option: string) => void;
  getAnswers: (poolId: string) => Record<string, string>;
  submitQuiz: (poolId: string) => Promise<{ success: boolean; score?: number; error?: string }>;
  clearAnswers: (poolId: string) => void;
}

export const useQuizStore = create<QuizState>()(
  persist(
    (set, get) => ({
      answers: {},
      isSubmitting: false,

      setAnswer: (poolId, questionId, option) => {
        set((state) => ({
          answers: {
            ...state.answers,
            [poolId]: {
              ...(state.answers[poolId] || {}),
              [questionId]: option,
            },
          },
        }));
      },

      getAnswers: (poolId) => {
        return get().answers[poolId] || {};
      },

      submitQuiz: async (poolId) => {
        const state = get();
        if (state.isSubmitting) return { success: false, error: 'Already submitting' };

        const currentAnswers = state.answers[poolId] || {};

        set({ isSubmitting: true });
        try {
          const { data, error } = await supabase.rpc('submit_quiz', {
            p_pool_id: poolId,
            p_answers: currentAnswers,
          });

          if (error) {
            console.error('Quiz submit error:', error);
            return { success: false, error: error.message };
          }

          // If successful, we can optionally clear the answers to save space
          // get().clearAnswers(poolId);
          
          return { success: true, score: (data as any)?.score };
        } catch (err: any) {
          console.error('Quiz submit exception:', err);
          return { success: false, error: err.message || 'Failed to submit quiz' };
        } finally {
          set({ isSubmitting: false });
        }
      },

      clearAnswers: (poolId) => {
        set((state) => {
          const newAnswers = { ...state.answers };
          delete newAnswers[poolId];
          return { answers: newAnswers };
        });
      },
    }),
    {
      name: 'naliss-quiz-storage',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
