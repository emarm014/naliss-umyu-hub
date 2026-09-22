import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';
import { normalizeError } from '../utils/sentry';

export interface OfflineMutation {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'delete' | 'upsert';
  payload: any;
  queryConstraints?: {
    eq?: { [key: string]: any };
  };
  timestamp: number;
}

interface MutationQueueState {
  queue: OfflineMutation[];
  failedQueue: OfflineMutation[];
  isProcessing: boolean;
  enqueue: (mutation: Omit<OfflineMutation, 'id' | 'timestamp'>) => void;
  processQueue: () => Promise<void>;
  clearQueue: () => void;
  clearFailedQueue: () => void;
  retryFailedQueue: () => void;
}

const loggedFatalMutations = new Set<string>();

// Tables that are valid targets for offline mutations.
// Mutations targeting tables outside this list are silently purged on hydration.
// This prevents stale mutations from old code (e.g., targeting a removed 'profiles' table)
// from endlessly retrying and throwing 404/403 errors.
const VALID_MUTATION_TABLES = new Set([
  'users', 'user_sessions', 'messages', 'reactions', 'group_members',
  'groups', 'news', 'archives', 'featured_students', 'announcement_reads',
  'notification_history', 'notepad_notes', 'notepad_folders',
  'system_settings', 'event_pools', 'event_pool_participants',
  'event_pool_submissions', 'event_pool_votes',
  'congratulations', 'fyb_courses', 'fyb_materials',
]);

/**
 * Removes any queued mutations that target tables no longer in the schema.
 * This auto-cleans leftover mutations from old code paths.
 */
function sanitizeQueue(queue: OfflineMutation[]): OfflineMutation[] {
  return queue.filter(mut => {
    if (!VALID_MUTATION_TABLES.has(mut.table)) {
      Logger.warn('mutationQueue', `Purging stale mutation targeting removed table: "${mut.table}"`, { id: mut.id });
      return false;
    }
    return true;
  });
}

export const useMutationQueueStore = create<MutationQueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      failedQueue: [],
      isProcessing: false,

      enqueue: (mutation) => {
        const newMutation: OfflineMutation = {
          ...mutation,
          id: `mut-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          timestamp: Date.now()
        };
        
        Logger.info('mutationQueue', 'Enqueuing offline mutation', { 
          table: mutation.table, 
          action: mutation.action,
          id: newMutation.id 
        });

        set((state) => ({ queue: [...state.queue, newMutation] }));
      },

      processQueue: async () => {
        // Prevent concurrent queue processing loops
        if (get().isProcessing || get().queue.length === 0) return;

        // Skip processing entirely if device is offline
        try {
          const NetInfo = require('@react-native-community/netinfo').default;
          const netState = await NetInfo.fetch();
          if (!netState.isConnected) {
            Logger.info('mutationQueue', 'Device is offline, skipping queue processing.');
            return;
          }
        } catch (_) {}

        set({ isProcessing: true });
        Logger.info('mutationQueue', `Processing mutation queue (${get().queue.length} items)...`);

        // Create a copy of the queue and process it sequentially to guarantee chronological order
        const currentQueue = [...get().queue].sort((a, b) => a.timestamp - b.timestamp);
        
        // We will keep track of mutations that failed with transient network errors so we can re-enqueue them
        const failedMutations: OfflineMutation[] = [];
        const newFailedQueue: OfflineMutation[] = [...get().failedQueue];
        let networkInterrupted = false;

        for (const mut of currentQueue) {
          if (networkInterrupted) {
            failedMutations.push(mut);
            continue;
          }

          try {
            Logger.info('mutationQueue', `Replaying mutation: ${mut.action} on ${mut.table}`, { id: mut.id });
            
            let query = (supabase as any).from(mut.table as any);

            if (mut.action === 'insert') {
              const { error } = await query.insert(mut.payload);
              if (error) throw normalizeError(error);
            } else if (mut.action === 'update') {
              let updateQuery = query.update(mut.payload);
              if (mut.queryConstraints?.eq) {
                for (const [key, val] of Object.entries(mut.queryConstraints.eq)) {
                  updateQuery = updateQuery.eq(key, val);
                }
              }
              const { error } = await updateQuery;
              if (error) throw normalizeError(error);
            } else if (mut.action === 'delete') {
              let deleteQuery = query.delete();
              if (mut.queryConstraints?.eq) {
                for (const [key, val] of Object.entries(mut.queryConstraints.eq)) {
                  deleteQuery = deleteQuery.eq(key, val);
                }
              }
              const { error } = await deleteQuery;
              if (error) throw normalizeError(error);
            } else if (mut.action === 'upsert') {
              const { error } = await query.upsert(mut.payload);
              if (error) throw normalizeError(error);
            }

            Logger.info('mutationQueue', `Successfully replayed mutation`, { id: mut.id });
          } catch (err: any) {
            const isNetwork = err?.status === 0 || 
                              err?.message?.toLowerCase().includes('network request failed') || 
                              err?.message?.toLowerCase().includes('failed to fetch');
            
            if (isNetwork) {
              Logger.warn('mutationQueue', `Network error replaying mutation, pausing queue.`, { id: mut.id });
              failedMutations.push(mut);
              networkInterrupted = true;
            } else {
              // Critical code/db/RLS violation error â€” log once, move to failedQueue to prevent queue blockage
              const errKey = `${mut.id}-${err?.message || 'unknown'}`;
              if (!loggedFatalMutations.has(errKey)) {
                loggedFatalMutations.add(errKey);
                Logger.error('mutationQueue', `Fatal mutation error, moving to failedQueue`, err, { id: mut.id });
              }
              newFailedQueue.push(mut);
            }
          }
        }

        // Restore the failed items back into the queue
        set({ queue: failedMutations, failedQueue: newFailedQueue, isProcessing: false });
        Logger.info('mutationQueue', `Finished processing queue. Remaining active items: ${failedMutations.length}, failed items: ${newFailedQueue.length}`);
      },

      clearQueue: () => set({ queue: [] }),
      clearFailedQueue: () => set({ failedQueue: [] }),
      retryFailedQueue: () => {
        const failed = get().failedQueue;
        if (failed.length === 0) return;
        
        // Push failed mutations back into primary queue sorted by original timestamp
        set((state) => ({
          queue: [...state.queue, ...failed].sort((a, b) => a.timestamp - b.timestamp),
          failedQueue: []
        }));
      }
    }),
    {
      name: 'mutation-queue-storage',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        queue: state.queue,
        failedQueue: state.failedQueue
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Auto-purge stale mutations targeting removed/renamed tables
          const cleanQueue = sanitizeQueue(state.queue);
          const cleanFailed = sanitizeQueue(state.failedQueue);
          if (cleanQueue.length !== state.queue.length || cleanFailed.length !== state.failedQueue.length) {
            useMutationQueueStore.setState({ queue: cleanQueue, failedQueue: cleanFailed });
          }
        }
      }
    }
  )
);
