import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import * as Notifications from 'expo-notifications';

const updateDeviceBadge = (notifications: any[]) => {
    try {
        const unreadCount = notifications.filter(n => !n.isRead).length;
        Notifications.setBadgeCountAsync(unreadCount);
    } catch {
        // silent
    }
};

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
                    const current = [...state.notifications];
                    newNotifs.forEach((notif) => {
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
                set((state) => {
                    const updated = state.notifications.map((n) =>
                        n.id === id ? { ...n, isRead: true } : n
                    );
                    updateDeviceBadge(updated);
                    return { notifications: updated };
                });
            },

            markAllAsRead: () => {
                set((state) => {
                    const updated = state.notifications.map((n) => ({ ...n, isRead: true }));
                    updateDeviceBadge(updated);
                    return { notifications: updated };
                });
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
                }
            },
        }
    )
);
