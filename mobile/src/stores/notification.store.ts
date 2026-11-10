import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import * as Notifications from 'expo-notifications';
import { supabase } from '../api/supabase/client';
import { useMutationQueueStore } from './mutationQueue.store';
import { normalizeError } from '../utils/sentry';

export const updateDeviceBadge = (notifications?: any[]) => {
  try {
    const notifList = Array.isArray(notifications)
      ? notifications
      : useNotificationStore.getState().notifications || [];
    const unreadNotifs = notifList.filter((n) => !n.isRead && n.type !== 'message' && n.type !== 'chat').length;

    let unreadChatMessages = 0;
    try {
      const { useGroupStore } = require('./group.store');
      const groupState = useGroupStore.getState();
      if (!groupState.isBadgeCleared && Array.isArray(groupState.groups)) {
        unreadChatMessages = groupState.groups.reduce(
          (sum: number, g: any) => sum + (Number(g?.unread_count) || 0),
          0
        );
      }
    } catch {
      // ignore if groupStore not initialized yet
    }

    Notifications.setBadgeCountAsync(unreadNotifs + unreadChatMessages).catch(() => {});
  } catch {
    // silent
  }
};

/**
 * Background helper to sync read status for notification IDs to Supabase history.
 * If offline, enqueues mutations into useMutationQueueStore for reliable background replay.
 */
async function syncReadStateToBackend(notificationIds: string[]): Promise<void> {
  if (!notificationIds || notificationIds.length === 0) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await (supabase as any)
      .from('notification_history')
      .update({ is_read: true } as any)
      .in('notification_id', notificationIds);

    if (error) {
      throw normalizeError(error);
    }
  } catch {
    // Offline or network error: Enqueue to mutation queue for reliable offline replay
    try {
      const queueStore = useMutationQueueStore.getState();
      notificationIds.forEach((id) => {
        queueStore.enqueue({
          table: 'notification_history',
          action: 'update',
          payload: { is_read: true },
          queryConstraints: {
            eq: { notification_id: id },
          },
        });
      });
      queueStore.processQueue().catch(() => {});
    } catch {
      // silent fallback
    }
  }
}

export interface AppNotification {
  id: string;
  type: 'announcement' | 'event' | 'resource' | 'message' | string;
  title: string;
  message: string;
  date: string;
  isRead: boolean;
  data?: any;
}

interface NotificationState {
  notifications: AppNotification[];
  _hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  addNotification: (notification: Omit<AppNotification, 'isRead'> & { isRead?: boolean }) => void;
  addNotifications: (notifications: Array<Omit<AppNotification, 'isRead'> & { isRead?: boolean }>) => void;
  markAsRead: (id: string) => void;
  markGroupAsRead: (groupId: string) => void;
  markEntityAsRead: (type: string, entityId: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      _hasHydrated: false,
      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),

      addNotification: (notif) => {
        if (notif.type === 'message' || notif.type === 'chat') return;
        set((state) => {
          const exists = state.notifications.some((n) => n.id === notif.id);
          let newNotifs = [];
          if (exists) {
            newNotifs = state.notifications.map((n) =>
              n.id === notif.id
                ? { ...n, ...notif, isRead: n.isRead || !!notif.isRead }
                : n
            );
          } else {
            newNotifs = [
              { ...notif, isRead: notif.isRead ?? false } as AppNotification,
              ...state.notifications,
            ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          }
          updateDeviceBadge(newNotifs);
          return { notifications: newNotifs };
        });
      },

      addNotifications: (newNotifs) => {
        set((state) => {
          const current = state.notifications.filter((n) => n.type !== 'message' && n.type !== 'chat');
          newNotifs.forEach((notif) => {
            if (notif.type === 'message' || notif.type === 'chat') return;
            const idx = current.findIndex((n) => n.id === notif.id);
            if (idx >= 0) {
              current[idx] = {
                ...current[idx],
                ...notif,
                isRead: current[idx].isRead || !!notif.isRead,
              } as AppNotification;
            } else {
              current.push({ ...notif, isRead: notif.isRead ?? false } as AppNotification);
            }
          });
          const sorted = current.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          updateDeviceBadge(sorted);
          return { notifications: sorted };
        });
      },

      markAsRead: (id) => {
        const state = get();
        const target = state.notifications.find((n) => n.id === id);
        if (!target || target.isRead) return;

        set((s) => {
          const updated = s.notifications.map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          );
          updateDeviceBadge(updated);
          return { notifications: updated };
        });

        syncReadStateToBackend([id]);
      },

      markGroupAsRead: (groupId) => {
        if (!groupId) return;
        const state = get();
        const affectedIds: string[] = [];

        const updated = state.notifications.map((n) => {
          const matchesGroup =
            n.data?.group_id === groupId ||
            n.data?.id === groupId ||
            n.id === groupId ||
            (n.type === 'message' && n.data?.group_id === groupId);

          if (matchesGroup && !n.isRead) {
            affectedIds.push(n.id);
            return { ...n, isRead: true };
          }
          return n;
        });

        if (affectedIds.length > 0) {
          set({ notifications: updated });
          updateDeviceBadge(updated);
          syncReadStateToBackend(affectedIds);
        }
      },

      markEntityAsRead: (type, entityId) => {
        if (!type || !entityId) return;
        const state = get();
        const affectedIds: string[] = [];

        const updated = state.notifications.map((n) => {
          const matchesEntity =
            n.type === type &&
            (n.data?.id === entityId || n.id === entityId || n.data?.announcement_id === entityId || n.data?.event_id === entityId);

          if (matchesEntity && !n.isRead) {
            affectedIds.push(n.id);
            return { ...n, isRead: true };
          }
          return n;
        });

        if (affectedIds.length > 0) {
          set({ notifications: updated });
          updateDeviceBadge(updated);
          syncReadStateToBackend(affectedIds);
        }
      },

      markAllAsRead: () => {
        const state = get();
        const unreadIds = state.notifications.filter((n) => !n.isRead).map((n) => n.id);
        if (unreadIds.length === 0) return;

        set((s) => {
          const updated = s.notifications.map((n) => ({ ...n, isRead: true }));
          updateDeviceBadge(updated);
          return { notifications: updated };
        });

        syncReadStateToBackend(unreadIds);
      },

      clearNotifications: () => {
        updateDeviceBadge([]);
        set({ notifications: [] });
      },
    }),
    {
      name: 'naliss-notification-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        notifications: state.notifications,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
          // Restore OS badge count immediately upon rehydration (cold start, reboot, launch)
          if (Array.isArray(state.notifications)) {
            updateDeviceBadge(state.notifications);
          }
        }
      },
    }
  )
);
