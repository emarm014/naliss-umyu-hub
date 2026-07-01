import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';

const SIGNUP_TIMEOUT_MS = 3_600_000; // 1 hour inactivity timeout

interface SignupState {
  // Provider info
  provider: 'email' | 'google';
  
  // Step 1: Credentials (for email provider)
  email?: string;
  password?: string;
  
  // Google specific tokens (if Google provider)
  access_token?: string;
  refresh_token?: string;

  // Step 2: Identity
  full_name?: string;
  username?: string;
  reg_number?: string;
  
  // Step 3: Academic Level
  level?: number;
  department?: string;

  // Track which step the user is on so we can resume
  currentStep?: number; // 1=email, 2=otp, 3=password, 4=identity, 5=level

  // For artificial delay
  isGoogleDelaying: boolean;

  // Timeout tracking — timestamp of last activity during signup
  lastActivityTime: number | null;

  setIsGoogleDelaying: (delaying: boolean) => void;
  setProvider: (provider: 'email' | 'google') => void;
  setCredentials: (email?: string, password?: string) => void;
  setGoogleTokens: (email: string, access_token: string, refresh_token: string) => void;
  setIdentity: (full_name: string, username: string, reg_number: string) => void;
  setLevel: (level: number, department?: string) => void;
  setCurrentStep: (step: number) => void;

  /** Call on every step transition to keep the session alive */
  touchActivity: () => void;
  /** Returns true if signup has timed out (>1 hour since last activity) */
  hasTimedOut: () => boolean;
  /** Returns true if there is an active in-progress signup session */
  hasActiveSession: () => boolean;

  // Reset when done or unmounting
  reset: () => void;

  // OTP lock state
  otpResendCounts: Record<string, number>;
  otpResendLocks: Record<string, number>;
  getOTPResendState: (email: string) => { count: number; lockedUntil: number | null };
  incrementOTPResendCount: (email: string) => { count: number; lockedUntil: number | null };
  clearOTPResendState: (email: string) => void;
}

const initialState = {
  provider: 'email' as const,
  email: undefined,
  password: undefined,
  access_token: undefined,
  refresh_token: undefined,
  full_name: undefined,
  username: undefined,
  reg_number: undefined,
  level: undefined,
  department: 'Library and Information Science',
  currentStep: undefined,
  isGoogleDelaying: false,
  lastActivityTime: null as number | null,
  otpResendCounts: {} as Record<string, number>,
  otpResendLocks: {} as Record<string, number>,
};

export const useSignupStore = create<SignupState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      setIsGoogleDelaying: (delaying: boolean) => set({ isGoogleDelaying: delaying }),
      setProvider: (provider: 'email' | 'google') => set({ provider }),

      setCredentials: (email, password) => set((state) => ({
        // Preserve existing provider (e.g. 'google') — never override it silently
        provider: state.provider,
        email: email ?? state.email,
        // Only update password if explicitly provided — never wipe it with undefined
        ...(password !== undefined ? { password } : {}),
        lastActivityTime: Date.now(),
      })),
      
      setGoogleTokens: (email, access_token, refresh_token) => set({ 
        provider: 'google', 
        email, 
        access_token, 
        refresh_token,
        lastActivityTime: Date.now(),
      }),
      
      setIdentity: (full_name, username, reg_number) => set({ full_name, username, reg_number, lastActivityTime: Date.now() }),
      
      setLevel: (level, department) => set((state) => ({ 
        level, 
        department: department || state.department,
        lastActivityTime: Date.now(),
      })),

      setCurrentStep: (step: number) => set({ currentStep: step, lastActivityTime: Date.now() }),

      touchActivity: () => set({ lastActivityTime: Date.now() }),

      hasTimedOut: () => {
        const { lastActivityTime } = get();
        if (!lastActivityTime) return false;
        return Date.now() - lastActivityTime > SIGNUP_TIMEOUT_MS;
      },

      hasActiveSession: () => {
        const { email, lastActivityTime } = get();
        if (!email || !lastActivityTime) return false;
        // Has email set and hasn't timed out
        return Date.now() - lastActivityTime <= SIGNUP_TIMEOUT_MS;
      },
      reset: () => set(initialState),

      getOTPResendState: (email) => {
        const { otpResendCounts, otpResendLocks } = get();
        const count = otpResendCounts[email] ?? 0;
        const lockedUntil = otpResendLocks[email] ?? null;

        if (lockedUntil && Date.now() >= lockedUntil) {
          set((state) => {
            const nextCounts = { ...state.otpResendCounts };
            const nextLocks = { ...state.otpResendLocks };
            delete nextCounts[email];
            delete nextLocks[email];
            return { otpResendCounts: nextCounts, otpResendLocks: nextLocks };
          });
          return { count: 0, lockedUntil: null };
        }

        return { count, lockedUntil };
      },

      incrementOTPResendCount: (email) => {
        const { count } = get().getOTPResendState(email);
        const next = count + 1;

        let lockedUntil: number | null = null;
        if (next >= 3) {
          lockedUntil = Date.now() + 30 * 60 * 1000;
        }

        set((state) => ({
          otpResendCounts: {
            ...state.otpResendCounts,
            [email]: next,
          },
          otpResendLocks: {
            ...state.otpResendLocks,
            ...(lockedUntil ? { [email]: lockedUntil } : {}),
          },
        }));

        return { count: next, lockedUntil };
      },

      clearOTPResendState: (email) => {
        set((state) => {
          const nextCounts = { ...state.otpResendCounts };
          const nextLocks = { ...state.otpResendLocks };
          delete nextCounts[email];
          delete nextLocks[email];
          return { otpResendCounts: nextCounts, otpResendLocks: nextLocks };
        });
      },
    }),
    {
      name: 'naliss-signup-session',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        provider: state.provider,
        email: state.email,
        access_token: state.access_token,
        refresh_token: state.refresh_token,
        full_name: state.full_name,
        username: state.username,
        reg_number: state.reg_number,
        level: state.level,
        department: state.department,
        currentStep: state.currentStep,
        lastActivityTime: state.lastActivityTime,
        otpResendCounts: state.otpResendCounts,
        otpResendLocks: state.otpResendLocks,
      }),
    }
  )
);
