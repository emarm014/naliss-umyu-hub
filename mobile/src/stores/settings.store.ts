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

let _settingsFetchPromise: Promise<void> | null = null;

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
        // TTL guard: skip if last fetch was less than 5 seconds ago
        const now = Date.now();
        const state = useSettingsStore.getState();
        if (now - state.lastFetchedAt < 5000) return;

        // In-flight deduplication: if a fetch is already running, piggyback on it
        if (_settingsFetchPromise) return _settingsFetchPromise;

        _settingsFetchPromise = (async () => {
          set({ isLoading: true });
          try {
            // SESSION GUARD: skip when unauthenticated to avoid 401 errors
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
              set({ isLoading: false });
              return;
            }

            // OFFLINE GUARD: skip network query when offline
            try {
              const { useNetworkStore } = require('./network.store');
              if (!useNetworkStore.getState().isOnline) {
                set({ isLoading: false });
                return;
              }
            } catch (_) {}

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
          } finally {
            _settingsFetchPromise = null;
          }
        })();

        return _settingsFetchPromise;
      },

      initializeListener: () => {
        // Initial fetch on mount
        useSettingsStore.getState().fetchSettings();

        // 1. Instant Realtime Subscription for system_settings updates (<100ms response)
        const channel = supabase
          .channel(`system_settings_live_global_${Date.now()}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'system_settings',
            },
            (payload: any) => {
              const record = payload.new || payload.old;
              if (!record || !record.key) return;

              const key = record.key;
              const val = record.value;

              if (key === 'maintenance_mode') {
                set({ maintenanceMode: parseBool(val, false) });
              } else if (key === 'read_only_mode') {
                set({ readOnlyMode: parseBool(val, false) });
              } else if (key === 'allow_registration') {
                set({ allowRegistration: parseBool(val, true) });
              } else if (key === 'maintenance_message') {
                set({ maintenanceMessage: val ?? '' });
              } else if (key === 'maintenance_estimated_end') {
                set({ maintenanceEstimatedEnd: val ?? '' });
              }
            }
          )
          .subscribe();

        // 2. AppState listener — instant fetch when returning to foreground
        const appStateSub = require('react-native').AppState.addEventListener('change', (nextState: string) => {
          if (nextState === 'active') {
            try {
              const { useNetworkStore } = require('./network.store');
              if (useNetworkStore.getState().isOnline) {
                useSettingsStore.getState().fetchSettings();
              }
            } catch (_) {
              useSettingsStore.getState().fetchSettings();
            }
          }
        });

        // 3. Fallback poll every 60 seconds (realtime + AppState already provide timely updates)
        const pollInterval = setInterval(() => {
          useSettingsStore.getState().fetchSettings();
        }, 60000);

        return () => {
          clearInterval(pollInterval);
          supabase.removeChannel(channel);
          appStateSub.remove();
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
