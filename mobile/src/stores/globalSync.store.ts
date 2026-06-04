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
    // Remove all dead channels
    get()._channels.forEach(channel => supabase.removeChannel(channel));
    set({ _channels: [] });
    // Small delay to let Supabase client reset before re-subscribing
    setTimeout(() => {
      get()._openChannels();
      // Sync after channels are established
      setTimeout(() => get().syncAll(true), 500);
    }, 200);
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
          get().syncAll(true);
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
  _openChannels: () => {
    // If channels already exist, remove them first to prevent duplicates
    if (get()._channels.length > 0) {
      get()._channels.forEach(channel => supabase.removeChannel(channel));
      set({ _channels: [] });
    }

    let groupDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedGroupFetch = () => {
      if (groupDebounceTimer) clearTimeout(groupDebounceTimer);
      groupDebounceTimer = setTimeout(() => {
        useGroupStore.getState().fetchGroups(true);
      }, 400); // reduced from 600ms → 400ms for snappier group list updates
    };

    // One channel, all tables — multiplexed over a single WebSocket
    const channel = supabase
      .channel(`mobile:all:${Date.now()}`)
      // ── Announcements ──────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, (payload) => {
        const { eventType, old: oldRecord, new: newRecord } = payload;
        const level = useAuthStore.getState().profile?.level;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useAnnouncementStore.setState(s => ({ announcements: s.announcements.filter(a => a.id !== oldRecord.id) }));
        } else {
          useAnnouncementStore.getState().fetchAnnouncements(level, true);
        }
      })
      // ── Events ────────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        const level = useAuthStore.getState().profile?.level;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useEventStore.setState(s => ({ events: s.events.filter(e => e.id !== oldRecord.id) }));
        } else {
          useEventStore.getState().fetchUpcomingEvents(level, true);
        }
      })
      // ── Materials ─────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        const level = useAuthStore.getState().profile?.level;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useResourceStore.setState(s => ({ materials: s.materials.filter(m => m.id !== oldRecord.id) }));
        } else {
          useResourceStore.getState().fetchMaterials({ level: level as any }, true);
        }
      })
      // ── Past Questions ────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'past_questions' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        const level = useAuthStore.getState().profile?.level;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useResourceStore.setState(s => ({ pastQuestions: s.pastQuestions.filter(p => p.id !== oldRecord.id) }));
        } else {
          useResourceStore.getState().fetchPastQuestions({ level: level as any }, true);
        }
      })
      // ── Courses ───────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        const level = useAuthStore.getState().profile?.level;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useResourceStore.setState(s => ({ courses: s.courses.filter(c => c.id !== oldRecord.id) }));
        } else {
          useResourceStore.getState().fetchCourses(level as any, true);
        }
      })
      // ── Lecturers ─────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lecturers' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useDirectoryStore.setState(s => ({ lecturers: s.lecturers.filter(l => l.id !== oldRecord.id) }));
        } else {
          useDirectoryStore.getState().fetchLecturers(true);
        }
      })
      // ── Executives ────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'executives' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useDirectoryStore.setState(s => ({ executives: s.executives.filter(e => e.id !== oldRecord.id) }));
        } else {
          useDirectoryStore.getState().fetchExecutives(true);
        }
      })
      // ── Groups ────────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        if (eventType === 'DELETE' && oldRecord?.id) {
          useGroupStore.setState(s => ({ groups: s.groups.filter(g => g.id !== oldRecord.id) }));
          return;
        }
        if (eventType === 'UPDATE' && newRecord?.id) {
          // Instant patch — no re-fetch needed for simple field changes
          useGroupStore.setState(s => ({
            groups: s.groups.map(g =>
              g.id === newRecord.id
                ? { ...g, name: newRecord.name ?? g.name, avatar_url: newRecord.avatar_url ?? g.avatar_url, is_official: newRecord.is_official ?? g.is_official, is_active: newRecord.is_active ?? g.is_active }
                : g
            ),
          }));
          return;
        }
        debouncedGroupFetch();
      })
      // ── Group Members ─────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, (payload) => {
        const { eventType, old: oldRecord } = payload;
        if (eventType === 'DELETE' && (oldRecord as any)?.user_id) {
          const currentUserId = useAuthStore.getState().user?.id;
          if ((oldRecord as any).user_id === currentUserId) {
            useGroupStore.setState(s => ({ groups: s.groups.filter(g => g.id !== (oldRecord as any).group_id) }));
            return;
          }
        }
        debouncedGroupFetch();
      })
      // ── Messages ──────────────────────────────────────────────────────────
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const { eventType, new: newRecord, old: oldRecord } = payload;
        const currentUserId = useAuthStore.getState().user?.id;

        if (eventType === 'INSERT' && newRecord?.group_id) {
          const msgType = (newRecord as any).message_type || 'text';
          let preview = (newRecord as any).content || '';
          if (msgType === 'image') preview = '📷 Photo';
          else if (msgType === 'video') preview = '🎥 Video';
          else if (msgType === 'document') preview = '📎 Document';
          else if (msgType === 'audio') preview = '🎵 Audio';
          else if (msgType === 'sticker') preview = '😊 Sticker';

          // NOTE: We intentionally do NOT cache the message here because the
          // payload has no user/sender info. The chat screen's own realtime
          // handler fetches full user data and handles caching correctly.
          // Caching here with user:null causes blank sender names in the UI.

          // Only increment unread for messages from others
          if (newRecord.sender_id !== currentUserId) {
            const senderName = (newRecord as any).sender?.username || 'Someone';
            useGroupStore.getState().incrementUnread(newRecord.group_id, `${senderName}: ${preview}`, newRecord.created_at);
          }
          debouncedGroupFetch();
        }

        if (eventType === 'UPDATE' && newRecord?.id) {
          if (newRecord.is_deleted) {
            useMessageStore.getState().removeMessage(newRecord.group_id, newRecord.id);
            // Immediately clear last_message if this was the last message shown
            useGroupStore.setState(state => ({
              groups: state.groups.map(g => {
                if (g.id !== newRecord.group_id) return g;
                // If the deleted message was the last one shown, clear it
                if (g.last_message_at === newRecord.created_at || !g.last_message) {
                  return { ...g, last_message: null, last_message_at: null };
                }
                return g;
              })
            }));
            // Then re-fetch to get the actual new last message from DB
            debouncedGroupFetch();
          } else {
            useMessageStore.getState().updateMessage(newRecord.group_id, newRecord.id, {
              content: newRecord.content, is_edited: newRecord.is_edited, isEdited: newRecord.is_edited,
            });
          }
        }

        if (eventType === 'DELETE' && oldRecord?.id) {
          useMessageStore.getState().removeMessage((oldRecord as any).group_id, oldRecord.id);
        }
      })
      // ── Users ─────────────────────────────────────────────────────────────
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
        const { new: newRecord } = payload;
        if (!newRecord?.id) return;
        const currentUserId = useAuthStore.getState().user?.id;
        if ((newRecord as any).id !== currentUserId) return;

        // NOTE: Ban/suspend handling is done exclusively in ProtectedRoute's
        // per-user realtime subscription. Do NOT call signOut() here — it races
        // with ProtectedRoute and can cause the message cache to be cleared
        // before the restriction screen is shown.
        // Just refresh the profile so the app has the latest data.
        useAuthStore.getState().fetchProfile(true);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          Sentry.addBreadcrumb({
            category: 'realtime',
            message: 'Supabase realtime channel error — will resubscribe on next network restore',
            level: 'warning',
          });
        }
      });

    set({ _channels: [channel] });
  },
} as GlobalSyncState));
