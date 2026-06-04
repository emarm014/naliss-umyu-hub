import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

            addNotification: (notif) => {
                set((state) => {
                    const exists = state.notifications.some((n) => n.id === notif.id);
                    if (exists) {
                        return {
                            notifications: state.notifications.map((n) =>
                                n.id === notif.id
                                    ? { ...n, ...notif, isRead: n.isRead || !!notif.isRead }
                                    : n
                            ),
                        };
                    }
                    return {
                        notifications: [
                            { ...notif, isRead: notif.isRead ?? false } as AppNotification,
                            ...state.notifications,
                        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
                    };
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
                    return {
                        notifications: current.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
                    };
                });
            },

            markAsRead: (id) => {
                set((state) => ({
                    notifications: state.notifications.map((n) =>
                        n.id === id ? { ...n, isRead: true } : n
                    ),
                }));
            },

            markAllAsRead: () => {
                set((state) => ({
                    notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
                }));
            },

            clearNotifications: () => set({ notifications: [] }),
        }),
        {
            name: 'naliss-notification-storage',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
