import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

          const { data, error } = await supabase
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
            data.forEach((item) => { map[item.key] = item.value; });
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

        // Keep a single shared realtime channel — only one instance app-wide
        // (ProtectedRoute calls initializeListener once, not per user)
        const existingChannel = supabase.getChannels().find(
          (ch) => ch.topic === 'realtime:public:system_settings'
        );
        if (existingChannel) {
          supabase.removeChannel(existingChannel);
        }

        const channel = supabase
          .channel('system_settings_live', {
            config: { broadcast: { ack: false }, presence: { key: '' } },
          })
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'system_settings' },
            (payload) => {
              const record = payload.new as any;
              if (!record?.key) return;
              const { key, value } = record;
              set((state) => {
                switch (key) {
                  case 'maintenance_mode':
                    return { ...state, maintenanceMode: parseBool(value, false), lastFetchedAt: Date.now() };
                  case 'read_only_mode':
                    return { ...state, readOnlyMode: parseBool(value, false), lastFetchedAt: Date.now() };
                  case 'allow_registration':
                    return { ...state, allowRegistration: parseBool(value, true), lastFetchedAt: Date.now() };
                  case 'maintenance_message':
                    return { ...state, maintenanceMessage: value ?? '', lastFetchedAt: Date.now() };
                  case 'maintenance_estimated_end':
                    return { ...state, maintenanceEstimatedEnd: value ?? '', lastFetchedAt: Date.now() };
                  default:
                    return state;
                }
              });
            }
          )
          .subscribe(async (status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              const { useNetworkStore } = require('./network.store');
              const isOnline = await useNetworkStore.getState().checkNetworkStatus();
              if (isOnline) {
                useSettingsStore.getState().fetchSettings();
              }
            }
          });

        // Return cleanup — clears poll interval AND removes realtime channel
        return () => {
          clearInterval(pollInterval);
          supabase.removeChannel(channel);
        };
      },
    }),
    {
      name: 'naliss-settings-v2',
      storage: createJSONStorage(() => AsyncStorage),
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
