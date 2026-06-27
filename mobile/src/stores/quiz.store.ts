import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase/client';

interface QuizState {
  poolStartTimes: Record<string, number>;
  answers: Record<string, Record<string, string>>;
  isSubmitting: boolean;

  getPoolStartTime: (poolId: string) => number | null;
  setPoolStartTime: (poolId: string, startTime: number) => void;
  clearPoolStartTime: (poolId: string) => void;

  setAnswer: (poolId: string, qId: string, option: string) => void;
  getAnswers: (poolId: string) => Record<string, string>;
  clearAnswers: (poolId: string) => void;
  submitQuiz: (poolId: string) => Promise<{ success: boolean; score?: number; error?: string }>;
}

export const useQuizStore = create<QuizState>()(
  persist(
    (set, get) => ({
      poolStartTimes: {},
      answers: {},
      isSubmitting: false,

      getPoolStartTime: (poolId) => {
        return get().poolStartTimes[poolId] || null;
      },

      setPoolStartTime: (poolId, startTime) => {
        set((state) => ({
          poolStartTimes: {
            ...state.poolStartTimes,
            [poolId]: startTime,
          },
        }));
      },

      clearPoolStartTime: (poolId) => {
        set((state) => {
          const next = { ...state.poolStartTimes };
          delete next[poolId];
          return { poolStartTimes: next };
        });
      },

      setAnswer: (poolId, qId, option) => {
        set((state) => {
          const poolAns = state.answers[poolId] || {};
          return {
            answers: {
              ...state.answers,
              [poolId]: {
                ...poolAns,
                [qId]: option,
              },
            },
          };
        });
      },

      getAnswers: (poolId) => {
        return get().answers[poolId] || {};
      },

      clearAnswers: (poolId) => {
        set((state) => {
          const next = { ...state.answers };
          delete next[poolId];
          return { answers: next };
        });
      },

      submitQuiz: async (poolId) => {
        if (get().isSubmitting) {
          return { success: false, error: 'Submission already in progress.' };
        }
        set({ isSubmitting: true });
        try {
          const answers = get().getAnswers(poolId);
          const { data, error } = await supabase.rpc('submit_quiz', {
            p_pool_id: poolId,
            p_answers: answers,
          });

          if (error) {
            console.error('Submit Quiz Error:', error);
            return { success: false, error: error.message };
          }

          const res = data as any;
          return { success: true, score: res.score };
        } catch (err: any) {
          console.error('Submit Quiz Exception:', err);
          return { success: false, error: err.message || 'Failed to submit quiz.' };
        } finally {
          set({ isSubmitting: false });
        }
      },
    }),
    {
      name: 'naliss-quiz-pool-started-at',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        poolStartTimes: state.poolStartTimes,
        answers: state.answers,
      }),
    }
  )
);
