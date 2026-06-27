import { cacheManager } from './cache';
import { diagnosticsManager } from './diagnostics';

class MemoryManager {
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null;
  private heapLimitPercent = 0.85; // Trigger eviction at 85% heap usage

  public startMonitoring() {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in (performance as any)) {
      this.memoryCheckInterval = setInterval(() => {
        this.checkMemoryPressure();
      }, 30000); // Audit memory every 30 seconds
    }
  }

  public stopMonitoring() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  private checkMemoryPressure() {
    const memory = (performance as any).memory;
    if (!memory) return;

    const used = memory.usedJSHeapSize;
    const limit = memory.jsHeapSizeLimit;
    const usageRatio = used / limit;

    if (usageRatio > this.heapLimitPercent) {
      diagnosticsManager.logTelemetry('memory', 'High memory pressure detected, clearing stale caches', {
        usedHeapMb: Math.round(used / 1024 / 1024),
        heapLimitMb: Math.round(limit / 1024 / 1024),
        usageRatio: usageRatio.toFixed(2),
      });

      // Clear all cached queryClient entries to release transient memory
      cacheManager.clearAll();
    }
  }
}

export const memoryManager = new MemoryManager();
