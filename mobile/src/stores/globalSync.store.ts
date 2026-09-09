import { create } from 'zustand';
import { AppState, AppStateStatus, InteractionManager } from 'react-native';
import { supabase } from '../api/supabase/client';
import * as Sentry from '@sentry/react-native';
import { useAuthStore } from './auth.store';
import { useAnnouncementStore } from './announcement.store';
import { useEventStore } from './event.store';
import { useResourceStore } from './resource.store';
import { useGroupStore } from './group.store';
import { useDirectoryStore } from './directory.store';
import { useMessageStore } from './message.store';
import { useNoteStore } from './note.store';
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
  restoreAllData: (onProgress: (progress: number, step: string) => void) => Promise<void>;
  _openChannels: () => void;
  _startBackgroundSync: () => void;
  _stopBackgroundSync: () => void;
}

// Background sync every 10 minutes â€” keeps data fresh even without realtime events
const BG_SYNC_INTERVAL = 10 * 60 * 1000;

export const useGlobalSyncStore = create<GlobalSyncState>((set, get) => ({
  isInitialized: false,
  _channels: [],
  _bgTimer: null,
  _appStateSubscription: null,

  initialize: () => {
    if (get().isInitialized) return;

    // Reset any messages stuck in 'sending' from a previous kill
    useMessageStore.getState().resetStuckMessages();

    // Defer the heavy 14-stage sync and FTS re-indexing to prevent blocking the JS thread 
    // during app mount, screen transitions, or priority tasks (like opening media).
    const isOnline = useNetworkStore.getState().isOnline;
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        if (isOnline) {
          get().syncAll(true);
        }
        get()._openChannels();
        get()._startBackgroundSync();

        // Restore previously downloaded files + notes on this device (new device login)
        // Only if the user didn't explicitly cancel/skip the data restore screen
        if (isOnline) {
          const { useDataRestoreStore } = require('./data-restore.store');
          const restoreState = useDataRestoreStore.getState();
          if (!restoreState.wasSkipped) {
            const { DownloadTracker } = require('../services/downloadTracker.service');
            DownloadTracker.restoreUserDownloads();
            useNoteStore.getState().fetchCloudNotes();
          }
        }
      }, 3000); // 3000ms explicit grace delay
    });

    set({ isInitialized: true });
  },

  // Only called on sign-out — tears everything down
  terminate: () => {
    get()._stopBackgroundSync();
    get()._channels.forEach(channel => supabase.removeChannel(channel));
    set({ _channels: [], isInitialized: false });
  },

  // Called when network comes back online â€” always force re-sync + fresh channels
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

    const { OfflineSyncService } = require('../services/offlineSync.service');
    await OfflineSyncService.syncAll(force);
  },

  /**
   * Full data restore for new device login — reports progress via callback.
   * Downloads all user data step-by-step with percentage updates.
   */
  restoreAllData: async (onProgress: (progress: number, step: string) => void) => {
    const authStore = useAuthStore.getState();
    if (!authStore.user) return;

    const level = authStore.profile?.level;

    try {
      // Step 1: Profile & settings (0–10%)
      onProgress(2, 'Syncing your profile...');
      await authStore.fetchProfile(true);
      onProgress(10, 'Profile synced');

      // Step 2: Announcements (10–25%)
      onProgress(12, 'Loading announcements...');
      await useAnnouncementStore.getState().fetchAnnouncements(level, true);
      onProgress(25, 'Announcements loaded');

      // Step 3: Groups & messages (25–40%)
      onProgress(27, 'Syncing groups & messages...');
      await useGroupStore.getState().fetchGroups(true);
      onProgress(40, 'Groups synced');

      // Step 4: News, Archive, FYB (40–55%)
      onProgress(42, 'Loading news...');
      try {
        const { useNewsStore } = require('./news.store');
        await useNewsStore.getState().fetchNews(true);
      } catch (e) { Sentry.captureException(e, { tags: { source: 'background_sync' } }); }
      onProgress(46, 'Loading archive...');
      try {
        const { useArchiveStore } = require('./archive.store');
        await useArchiveStore.getState().fetchArchives(0, true);
      } catch (e) { Sentry.captureException(e, { tags: { source: 'background_sync' } }); }
      onProgress(50, 'Loading featured students...');
      try {
        const { useFYBStore } = require('./fyb.store');
        await useFYBStore.getState().fetchFeatured(true);
      } catch (e) { Sentry.captureException(e, { tags: { source: 'background_sync' } }); }
      onProgress(55, 'Content loaded');

      // Step 5: Events, resources, directory (55–70%)
      onProgress(57, 'Syncing events & resources...');
      await Promise.allSettled([
        useEventStore.getState().fetchUpcomingEvents(level, true),
        useResourceStore.getState().fetchMaterials({ level: level as any }, true),
        useResourceStore.getState().fetchPastQuestions({ level: level as any }, true),
        useResourceStore.getState().fetchCourses(level as any, true),
      ]);
      onProgress(65, 'Loading directory...');
      await Promise.allSettled([
        useDirectoryStore.getState().fetchLecturers(true),
        useDirectoryStore.getState().fetchExecutives(true),
      ]);
      onProgress(70, 'Events & resources synced');

      // Step 6: Notes from cloud (70–85%)
      onProgress(72, 'Restoring your notes...');
      try {
        await useNoteStore.getState().fetchCloudNotes();
      } catch (e) { Sentry.captureException(e, { tags: { source: 'background_sync' } }); }
      onProgress(85, 'Notes restored');

      // Step 7: Downloaded files (85–100%)
      onProgress(87, 'Restoring downloaded files...');
      try {
        const { DownloadTracker } = require('../services/downloadTracker.service');
        await DownloadTracker.restoreUserDownloads();
      } catch (e) { Sentry.captureException(e, { tags: { source: 'background_sync' } }); }
      onProgress(100, 'All done!');

    } catch (err) {
      // If any critical step fails, still report progress so far
      Sentry.captureException(err, { tags: { source: 'background_sync' } });
      throw err;
    }
  },

  // â”€â”€ Background periodic sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _startBackgroundSync: () => {
    // Clear any existing timer
    const existing = get()._bgTimer;
    if (existing) clearInterval(existing);

    // Periodic background sync â€” silent, no loading spinners
    const timer = setInterval(() => {
      get().syncAll(false); // respect TTL â€” only re-fetches if stale
    }, BG_SYNC_INTERVAL);

    set({ _bgTimer: timer, _appStateSubscription: null });
  },

  _stopBackgroundSync: () => {
    const timer = get()._bgTimer;
    if (timer) clearInterval(timer);
    const sub = get()._appStateSubscription;
    if (sub) sub.remove();
    set({ _bgTimer: null, _appStateSubscription: null });
  },

  // â”€â”€ Realtime channels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Single multiplexed channel for all tables â€” far more efficient than 11 separate channels.
  // One WebSocket connection, one handshake, one heartbeat.
  _openChannels: async () => {
    // â”€â”€ Emergency Realtime Optimization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Removed the 'mobile:global:broadcast' WebSocket completely to protect the
    // Supabase Free Tier 200 concurrent connection limit.
    // Sync now relies exclusively on AppState foregrounding and background sync intervals.
  },

} as GlobalSyncState));
