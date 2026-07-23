import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from './mmkv.storage';
import { supabase } from '../api/supabase/client';
import { Logger } from '../utils/logger';

export interface OfflineMutation {
  id: string;
  table: string;
  action: 'insert' | 'update' | 'delete';
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
              if (error) throw error;
            } else if (mut.action === 'update') {
              let updateQuery = query.update(mut.payload);
              if (mut.queryConstraints?.eq) {
                for (const [key, val] of Object.entries(mut.queryConstraints.eq)) {
                  updateQuery = updateQuery.eq(key, val);
                }
              }
              const { error } = await updateQuery;
              if (error) throw error;
            } else if (mut.action === 'delete') {
              let deleteQuery = query.delete();
              if (mut.queryConstraints?.eq) {
                for (const [key, val] of Object.entries(mut.queryConstraints.eq)) {
                  deleteQuery = deleteQuery.eq(key, val);
                }
              }
              const { error } = await deleteQuery;
              if (error) throw error;
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
      })
    }
  )
);
