import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';

interface DataRestoreState {
  /** Whether this device needs data restore (no prior MMKV cache) */
  isNewDevice: boolean;
  /** Whether restore is currently running */
  restoreInProgress: boolean;
  /** Whether restore completed successfully */
  restoreCompleted: boolean;
  /** Whether user explicitly chose to skip */
  wasSkipped: boolean;
  /** The user ID that last completed or skipped the restore */
  lastUserId: string | null;
  /** Progress percentage 0–100 */
  progress: number;
  /** Human-readable current step description */
  currentStep: string;
  /** Error message if restore failed */
  error: string | null;

  /** Check if this is a new device (no cached data in MMKV) */
  detectNewDevice: (currentUserId?: string) => void;
  /** Mark restore as started */
  startRestore: () => void;
  /** Update progress */
  setProgress: (progress: number, step: string) => void;
  /** Mark restore as completed */
  completeRestore: () => void;
  /** Mark restore as skipped */
  skipRestore: () => void;
  /** Set error */
  setError: (error: string) => void;
  /** Reset transient state (e.g., on logout) — preserves completed/skipped for same user */
  reset: () => void;
}

export const useDataRestoreStore = create<DataRestoreState>()(
  persist(
    (set, get) => ({
      isNewDevice: false,
      restoreInProgress: false,
      restoreCompleted: false,
      wasSkipped: false,
      lastUserId: null,
      progress: 0,
      currentStep: '',
      error: null,

      detectNewDevice: (currentUserId?: string) => {
        // If the same user already completed or skipped, don't show again
        const state = get();
        if (currentUserId && state.lastUserId === currentUserId && (state.restoreCompleted || state.wasSkipped)) {
          return;
        }

        // Different user logging in — clear previous user's flags
        if (currentUserId && state.lastUserId && state.lastUserId !== currentUserId) {
          set({ restoreCompleted: false, wasSkipped: false, lastUserId: null });
        }

        // Already completed or skipped (same user or no userId tracking yet)
        if (get().restoreCompleted || get().wasSkipped) return;

        // Check if MMKV has any existing cached data from prior sessions
        // If both announcement-storage and group-store are empty, this is a new device
        try {
          const { getSyncItem } = require('./mmkv.storage');
          const announcementData = getSyncItem('announcement-storage');
          const groupData = getSyncItem('group-store');
          
          let hasAnnouncementData = false;
          let hasGroupData = false;

          if (announcementData) {
            try {
              const parsed = JSON.parse(announcementData);
              hasAnnouncementData = parsed?.state?.announcements?.length > 0;
            } catch {}
          }
          if (groupData) {
            try {
              const parsed = JSON.parse(groupData);
              hasGroupData = parsed?.state?.groups?.length > 0;
            } catch {}
          }

          // If both stores are empty, this is a new/fresh device
          if (!hasAnnouncementData && !hasGroupData) {
            set({ isNewDevice: true });
          }
        } catch {
          // If MMKV read fails, assume not new device (safer default)
        }
      },

      startRestore: () => {
        set({ restoreInProgress: true, progress: 0, currentStep: 'Preparing...', error: null });
      },

      setProgress: (progress: number, step: string) => {
        set({ progress: Math.min(100, Math.max(0, progress)), currentStep: step });
      },

      completeRestore: () => {
        let userId: string | null = null;
        try { userId = require('./auth.store').useAuthStore.getState().user?.id || null; } catch {}
        set({
          restoreInProgress: false,
          restoreCompleted: true,
          isNewDevice: false,
          progress: 100,
          currentStep: 'All done!',
          error: null,
          lastUserId: userId,
        });
      },

      skipRestore: () => {
        let userId: string | null = null;
        try { userId = require('./auth.store').useAuthStore.getState().user?.id || null; } catch {}
        set({
          wasSkipped: true,
          isNewDevice: false,
          restoreInProgress: false,
          progress: 0,
          currentStep: '',
          error: null,
          lastUserId: userId,
        });
      },

      setError: (error: string) => {
        set({ error, restoreInProgress: false });
      },

      reset: () => {
        // Only reset transient state — preserve restoreCompleted/wasSkipped/lastUserId
        // so the same user doesn't see the restore screen again after re-login
        set({
          isNewDevice: false,
          restoreInProgress: false,
          progress: 0,
          currentStep: '',
          error: null,
        });
      },
    }),
    {
      name: 'data-restore-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        restoreCompleted: state.restoreCompleted,
        wasSkipped: state.wasSkipped,
        lastUserId: state.lastUserId,
      }),
    }
  )
);
