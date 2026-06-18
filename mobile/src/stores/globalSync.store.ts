import { create } from 'zustand';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../api/supabase/client';
import { captureStoreError } from '../utils/sentry';
import * as Sentry from '@sentry/react-native';
import { useAuthStore } from './auth.store';
import { useAnnouncementStore } from './announcement.store';
import { useEventStore } from './event.store';
import { useResourceStore } from './resource.store';
import { useGroupStore } from './group.store';
import { useDirectoryStore } from './directory.store';
import { useMessageStore } from './message.store';
import { useNetworkStore } from './network.store';
import { RealtimeChannel } from '@supabase/supabase-js';

interface GlobalSyncState {
  isInitialized: boolean;
  _channels: RealtimeChannel[];
  _bgTimer: ReturnType<typeof setInterval> | null;
  _appStateSubscription: { remove: () => void } | null;

  initialize: () => void;
  terminate: () => void;
  resubscribe: () => void;
  syncAll: (force?: boolean) => Promise<void>;
  _openChannels: () => void;
  _startBackgroundSync: () => void;
  _stopBackgroundSync: () => void;
}

// Background sync every 10 minutes — keeps data fresh even without realtime events
const BG_SYNC_INTERVAL = 10 * 60 * 1000;

export const useGlobalSyncStore = create<GlobalSyncState>((set, get) => ({
  isInitialized: false,
  _channels: [],
  _bgTimer: null,
  _appStateSubscription: null,

  initialize: () => {
    if (get().isInitialized) return;

    // Only do initial sync if online — cached data is already in stores from AsyncStorage
    const isOnline = useNetworkStore.getState().isOnline;
    if (isOnline) {
      get().syncAll(true);
    }
    get()._openChannels();
    get()._startBackgroundSync();

    set({ isInitialized: true });
  },

  // Only called on sign-out — tears everything down
  terminate: () => {
    get()._stopBackgroundSync();
    get()._channels.forEach(channel => supabase.removeChannel(channel));
    set({ _channels: [], isInitialized: false });
  },

  // Called when network comes back online — always force re-sync + fresh channels
  resubscribe: () => {
    (async () => {
      // Safely await removal of all dead channels to prevent socket leaks
      if (get()._channels.length > 0) {
        await Promise.all(get()._channels.map(channel => supabase.removeChannel(channel)));
        set({ _channels: [] });
      }
      
      // Small delay to let Supabase client reset before re-subscribing
      setTimeout(() => {
        get()._openChannels();
        // Thundering herd prevention: stagger reconnection syncs across 5.5s
        const jitterDelay = 500 + Math.random() * 5000;
        setTimeout(() => get().syncAll(true), jitterDelay);
      }, 200);
    })();
  },

  syncAll: async (force = false) => {
    // Skip network calls when offline — cached data is already in stores
    const isOnline = useNetworkStore.getState().isOnline;
    if (!isOnline) return;

    const authStore = useAuthStore.getState();
    if (!authStore.user) return;

    const level = authStore.profile?.level;

    // Priority 1: User-visible content first (groups, announcements, events)
    // Priority 2: Secondary content (materials, courses, directory) — slightly deferred
    // This makes the app feel faster — the most important screens load first
    const [p1] = await Promise.allSettled([
      useGroupStore.getState().fetchGroups(force),
      useAnnouncementStore.getState().fetchAnnouncements(level, force),
      useEventStore.getState().fetchUpcomingEvents(level, force),
    ]);

    // Secondary content — fire and forget, don't block
    Promise.allSettled([
      useResourceStore.getState().fetchMaterials({ level: level as any }, force),
      useResourceStore.getState().fetchPastQuestions({ level: level as any }, force),
      useResourceStore.getState().fetchCourses(level as any, force),
      useDirectoryStore.getState().fetchLecturers(force),
      useDirectoryStore.getState().fetchExecutives(force),
    ]);
  },

  // ── Background periodic sync ──────────────────────────────────────────────
  _startBackgroundSync: () => {
    // Clear any existing timer
    const existing = get()._bgTimer;
    if (existing) clearInterval(existing);

    // Periodic background sync — silent, no loading spinners
    const timer = setInterval(() => {
      get().syncAll(false); // respect TTL — only re-fetches if stale
    }, BG_SYNC_INTERVAL);

    // AppState listener — re-sync when app comes back to foreground (only if online)
    const appStateSub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // Force a fresh network check before syncing to avoid spamming failed requests
        const isOnline = await useNetworkStore.getState().checkNetworkStatus();
        if (isOnline) {
          // Thundering herd prevention for app foreground transitions
          const jitterDelay = Math.random() * 5000;
          setTimeout(() => get().syncAll(true), jitterDelay);
        }
      }
    });

    set({ _bgTimer: timer, _appStateSubscription: appStateSub });
  },

  _stopBackgroundSync: () => {
    const timer = get()._bgTimer;
    if (timer) clearInterval(timer);
    const sub = get()._appStateSubscription;
    if (sub) sub.remove();
    set({ _bgTimer: null, _appStateSubscription: null });
  },

  // ── Realtime channels ─────────────────────────────────────────────────────
  // Single multiplexed channel for all tables — far more efficient than 11 separate channels.
  // One WebSocket connection, one handshake, one heartbeat.
  _openChannels: async () => {
    // ── Emergency Realtime Optimization ─────────────────────────────────────
    // Removed the 'mobile:global:broadcast' WebSocket completely to protect the
    // Supabase Free Tier 200 concurrent connection limit.
    // Sync now relies exclusively on AppState foregrounding and background sync intervals.
  },

} as GlobalSyncState));
