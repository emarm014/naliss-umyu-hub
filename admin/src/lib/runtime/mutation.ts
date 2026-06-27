import { networkManager } from './network';
import { performanceScheduler, TaskPriority } from './scheduler';
import { diagnosticsManager } from './diagnostics';

interface MutationOptions {
  optimisticApply: () => void;
  rollbackApply: () => void;
  dbWrite: () => Promise<any>;
}

class MutationCoordinator {
  public async mutate(id: string, options: MutationOptions): Promise<any> {
    diagnosticsManager.startTimer(`mutation_${id}`);
    
    // 1. Apply optimistic update to Zustand store
    options.optimisticApply();

    const executeWrite = async () => {
      try {
        const result = await options.dbWrite();
        diagnosticsManager.logTelemetry('mutation', `Database write completed for mutation ${id}`);
        return result;
      } catch (err) {
        // 2. Rollback instantly on DB write failure
        options.rollbackApply();
        diagnosticsManager.logTelemetry('mutation', `Database write failed for mutation ${id}, rolling back`, {
          error: (err as Error).message,
        });
        throw err;
      }
    };

    // 3. Network Resilience check
    if (!networkManager.getOnlineStatus()) {
      return networkManager.queueOfflineMutation(executeWrite, options.rollbackApply);
    }

    // 4. Schedule write task in P1 priority queue
    return new Promise((resolve, reject) => {
      performanceScheduler.schedule(async () => {
        try {
          const res = await executeWrite();
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          diagnosticsManager.endTimer(`mutation_${id}`, 'mutation');
        }
      }, TaskPriority.P1_IMMEDIATE);
    });
  }
}

export const mutationCoordinator = new MutationCoordinator();
