import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';

interface SettingsState {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceEstimatedEnd: string;
  readOnlyMode: boolean;
  allowRegistration: boolean;
  isLoading: boolean;
  lastFetchedAt: number;

  fetchSettings: () => Promise<void>;
  setSettings: (settings: Partial<SettingsState>) => void;
  initializeListener: () => () => void;
}

function parseBool(value: string | undefined | null, defaultVal: boolean): boolean {
  if (value === null || value === undefined) return defaultVal;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return defaultVal;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      maintenanceMode: false,
      maintenanceMessage: '',
      maintenanceEstimatedEnd: '',
      readOnlyMode: false,
      allowRegistration: true,
      isLoading: false,
      lastFetchedAt: 0,

      setSettings: (settings) => set((state) => ({ ...state, ...settings })),

      fetchSettings: async () => {
        set({ isLoading: true });
        try {
          // SESSION GUARD: skip when unauthenticated to avoid 401 errors
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            set({ isLoading: false });
            return;
          }

          const { data, error } = await (supabase as any)
            .from('system_settings')
            .select('key, value')
            .in('key', [
              'maintenance_mode',
              'maintenance_message',
              'maintenance_estimated_end',
              'read_only_mode',
              'allow_registration',
            ]);

          if (error) throw error;
          if (data && data.length > 0) {
            const map: Record<string, string> = {};
            data.forEach((item: any) => { map[item.key] = item.value; });
            set({
              maintenanceMode: parseBool(map.maintenance_mode, false),
              readOnlyMode: parseBool(map.read_only_mode, false),
              allowRegistration: parseBool(map.allow_registration, true),
              maintenanceMessage: map.maintenance_message ?? '',
              maintenanceEstimatedEnd: map.maintenance_estimated_end ?? '',
              isLoading: false,
              lastFetchedAt: Date.now(),
            });
          } else {
            set({ isLoading: false });
          }
        } catch {
          set({ isLoading: false });
        }
      },

      initializeListener: () => {
        // ── Scale optimisation: poll every 5 minutes instead of holding a
        // permanent WebSocket per user. system_settings almost never changes
        // (only when admin toggles maintenance/read-only mode).
        // This saves 1 realtime connection slot per active user — at 200 users
        // that's 200 freed slots on the free tier (limit: 200 total).
        //
        // The realtime channel is still used as an instant-update path for
        // admins who need to see changes immediately, but regular users get
        // updates within 5 minutes which is perfectly acceptable.
        const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

        // Initial fetch on mount
        useSettingsStore.getState().fetchSettings();

        // Poll every 5 minutes
        const pollInterval = setInterval(() => {
          useSettingsStore.getState().fetchSettings();
        }, POLL_INTERVAL_MS);

        // Removed system_settings_live WebSocket per emergency optimization
        // to protect the 200 concurrent connection limit on Supabase Free Tier.
        // We now rely purely on the 5-minute REST polling interval above, which
        // is more than sufficient for global app settings.
        return () => {
          clearInterval(pollInterval);
        };
      },
    }),
    {
      name: 'naliss-settings-v2',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        maintenanceMode: state.maintenanceMode,
        readOnlyMode: state.readOnlyMode,
        allowRegistration: state.allowRegistration,
        maintenanceMessage: state.maintenanceMessage,
        maintenanceEstimatedEnd: state.maintenanceEstimatedEnd,
        lastFetchedAt: state.lastFetchedAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const age = Date.now() - (state.lastFetchedAt ?? 0);
        if (age > 5 * 60 * 1000) {
          setTimeout(() => {
            useSettingsStore.getState().fetchSettings();
          }, 100);
        }
      },
    }
  )
);
