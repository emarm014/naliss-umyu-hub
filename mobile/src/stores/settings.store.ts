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
  lastFetchedAt: number; // epoch ms — used to detect stale cache

  // Actions
  fetchSettings: () => Promise<void>;
  setSettings: (settings: Partial<SettingsState>) => void;
  initializeListener: () => () => void;
}

// Parse a raw DB string value to boolean — handles 'true'/'false'/'1'/'0' etc.
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
          // SESSION GUARD: system_settings requires authentication (RLS).
          // Skip the fetch when unauthenticated to avoid 401 errors on login/register screens.
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
        // Remove any existing channel with this name first to avoid duplicates
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
            // If subscription fails, fall back to a fresh fetch (if online)
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              const { useNetworkStore } = require('./network.store');
              const isOnline = await useNetworkStore.getState().checkNetworkStatus();
              if (isOnline) {
                useSettingsStore.getState().fetchSettings();
              }
            }
          });

        return () => {
          supabase.removeChannel(channel);
        };
      },
    }),
    {
      name: 'naliss-settings-v2', // bumped version — forces cache invalidation
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
        // If cache is older than 5 minutes, fetch fresh immediately on hydration
        const age = Date.now() - (state.lastFetchedAt ?? 0);
        if (age > 5 * 60 * 1000) {
          // Defer slightly to let the store finish hydrating first
          setTimeout(() => {
            useSettingsStore.getState().fetchSettings();
          }, 100);
        }
      },
    }
  )
);
