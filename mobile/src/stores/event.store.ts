import * as Notifications from 'expo-notifications';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';

export interface Event {
    id: string;
    title: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue: string | null;
    cover_image_url: string | null;
    is_virtual: boolean;
    virtual_link: string | null;
    max_attendees: number | null;
    current_attendees: number;
    status: 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled';
    is_public: boolean;
    target_level: string | null;
    view_count: number;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    pool_id?: string | null;
}

interface EventState {
    events: Event[];
    isLoading: boolean;
    lastFetch: number | null;
    error: string | null;
    fetchUpcomingEvents: (level?: string | null, force?: boolean) => Promise<void>;
    clearCache: () => void;
}

const CACHE_TTL = Infinity; // No TTL â€” cached events available offline indefinitely


export async function scheduleTimetableAlarms(events: Event[]) {
    try {
        // Filter events for lectures, exams, or timetable slots
        const academicEvents = events.filter(ev => {
            const text = ((ev.title || '') + ' ' + (ev.description || '')).toLowerCase();
            return text.includes('lecture') || text.includes('exam') || text.includes('timetable_slot') || text.includes('timetable');
        });

        // Cancel all previously scheduled notifications (or you could track them, but for simplicity we can cancel all or just let expo handle it if we have specific IDs. Since we don't have the previous IDs, we can cancel all scheduled notifications, or ideally just the ones we own. For this scope, we'll cancel all to prevent duplication of timetable alarms as requested, or just rely on a specific logic if possible. Actually the prompt says "matching our timetable structure". We can't cancel by ID if we don't know it, so we'll cancel all scheduled ones that might match).
        // A safer way is to fetch all scheduled and cancel those that match our pattern.
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        for (const notif of scheduled) {
            if (notif.content.title?.includes('Upcoming Academic Session')) {
                await Notifications.cancelScheduledNotificationAsync(notif.identifier);
            }
        }

        for (const ev of academicEvents) {
            let eventDateStr = ev.start_date;
            if (ev.start_time) {
                eventDateStr += 'T' + ev.start_time;
            }
            const targetDate = new Date(eventDateStr);
            const alarmTime = new Date(targetDate.getTime() - (15 * 60 * 1000));
            
            if (alarmTime.getTime() > Date.now()) {
                await Notifications.scheduleNotificationAsync({
                    content: {
                        title: "Upcoming Academic Session",
                        body: `Your lecture/exam '${ev.title}' is starting in 15 minutes. Check your seat and location!`,
                        data: { eventId: ev.id },
                    },
                    trigger: { date: alarmTime } as any,
                });
            }
        }
    } catch (e) {
        console.error('Error scheduling timetable alarms:', e);
    }
}

export const useEventStore = create<EventState>()(
    persist(
        (set, get) => ({
            events: [],
            isLoading: false,
            lastFetch: null,
            error: null,

            fetchUpcomingEvents: async (level, force = false) => {
                const { lastFetch, events } = get();
                const isFresh = lastFetch && Date.now() - lastFetch < CACHE_TTL && events.length > 0;

                if (!force && isFresh) return;

                // LOCAL-FIRST: read from SQLite cache immediately (always works)
                if (!force && events.length === 0) {
                    try {
                        const { getCachedEntityList } = require('../lib/database');
                        const cached = await getCachedEntityList('events');
                        if (cached.length > 0) {
                            set({ events: cached as any, isLoading: false });
                        }
                    } catch { /* fall through to server fetch */ }
                }

                // Only show full loading state if we have never fetched before
                if (!get().lastFetch) set({ isLoading: true });

                // OFFLINE GUARD: if offline, data from SQLite is already displayed
                const { useNetworkStore } = require('./network.store');
                if (!useNetworkStore.getState().isOnline) {
                  set({ isLoading: false });
                  return;
                }

                try {
                    let query = (supabase as any).from('events')
                        .select('*, event_pools(id)')
                        .in('status', ['published', 'ongoing']);

                    if (level) {
                        query = query.or(`target_level.is.null,target_level.eq.${level}`);
                    }

                    const { data, error } = await query.order('created_at', { ascending: false }).limit(30);

                    if (error) throw error;

                    const mappedEvents = (data || []).map((ev: any) => ({
                        ...ev,
                        pool_id: ev.event_pools && ev.event_pools.length > 0 ? ev.event_pools[0].id : null,
                        event_pools: undefined
                    }));

                    
                    const { cacheEntityList } = require('../lib/database');
                    const session = (await supabase.auth.getSession()).data.session;
                    cacheEntityList('events', mappedEvents, session?.user?.id || '').catch(() => {});

                    // Background prefetch covers for offline
                    const { getOptimizedCloudinaryUrl } = require('../utils/cloudinary');
                    const { prefetchAsset } = require('../utils/prefetchAsset');
                    mappedEvents.forEach((ev: any) => {
                        if (ev.cover_image_url) {
                            const homeUrl = getOptimizedCloudinaryUrl(ev.cover_image_url, 600, 400);
                            const posterEntityId = 'poster_' + homeUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
                            prefetchAsset(posterEntityId, homeUrl, 'poster');
                        }
                    });

                    set({ events: mappedEvents as unknown as Event[], isLoading: false, lastFetch: Date.now() });
                    scheduleTimetableAlarms(mappedEvents as unknown as Event[]);

                } catch (err) {
                    Logger.error('event-store', 'fetchEvents failed', err);
                    set({ isLoading: false });
                }
            },
            clearCache: () => set({ events: [], lastFetch: null, error: null }),
        }),
        {
            name: 'event-storage',
            storage: createJSONStorage(() => mmkvStorage),
            partialize: (state) => ({
                events: state.events,
                lastFetch: state.lastFetch,
            }),
        }
    )
);

