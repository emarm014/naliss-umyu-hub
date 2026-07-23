import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';

interface Attempt {
  timestamp: number;
}

interface RegistrationLimiterState {
  attempts: Attempt[];
  incrementAttempt: () => void;
  checkLimit: () => boolean;
  getRemainingTime: () => number | null; // returns minutes remaining if blocked
}

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export const useRegistrationLimiter = create<RegistrationLimiterState>()(
  persist(
    (set, get) => ({
      attempts: [],

      incrementAttempt: () => {
        const now = Date.now();
        set((state) => {
          // Clean up old attempts outside the 1-hour window
          const validAttempts = state.attempts.filter(a => now - a.timestamp < COOLDOWN_MS);
          return { attempts: [...validAttempts, { timestamp: now }] };
        });
      },

      checkLimit: () => {
        const now = Date.now();
        const validAttempts = get().attempts.filter(a => now - a.timestamp < COOLDOWN_MS);
        return validAttempts.length >= MAX_ATTEMPTS;
      },

      getRemainingTime: () => {
        const now = Date.now();
        const validAttempts = get().attempts.filter(a => now - a.timestamp < COOLDOWN_MS);
        
        if (validAttempts.length >= MAX_ATTEMPTS) {
          // Time remaining until the oldest valid attempt expires
          const oldestAttempt = validAttempts[0];
          const timePassed = now - oldestAttempt.timestamp;
          const timeRemaining = COOLDOWN_MS - timePassed;
          return Math.ceil(timeRemaining / (60 * 1000));
        }
        return null;
      }
    }),
    {
      name: 'naliss-registration-limiter',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
