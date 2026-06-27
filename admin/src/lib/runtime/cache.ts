import { queryClient } from '../queryClient';
import { diagnosticsManager } from './diagnostics';

class CacheManager {
  private version = '1.0.0';
  private ttlMap: Map<string, number> = new Map();

  public getVersion(): string {
    return this.version;
  }

  public set(key: string, data: any, ttlMs: number = 10 * 60 * 1000) {
    queryClient.setQueryData([key], data);
    this.ttlMap.set(key, Date.now() + ttlMs);
    diagnosticsManager.logTelemetry('cache', `Cached key "${key}" with TTL ${ttlMs}ms`);
  }

  public get(key: string): any {
    const expires = this.ttlMap.get(key);
    if (expires && Date.now() > expires) {
      this.invalidate([key]);
      diagnosticsManager.logCacheHit(false);
      return undefined;
    }

    const data = queryClient.getQueryData([key]);
    diagnosticsManager.logCacheHit(data !== undefined);
    return data;
  }

  public invalidate(queryKey: string[]) {
    queryClient.invalidateQueries({ queryKey });
    this.ttlMap.delete(queryKey[0]);
    diagnosticsManager.logTelemetry('cache', `Invalidated query key: ${queryKey.join('.')}`);
  }

  public evictStaleCache() {
    const now = Date.now();
    this.ttlMap.forEach((expires, key) => {
      if (now > expires) {
        this.invalidate([key]);
      }
    });
  }

  public clearAll() {
    queryClient.clear();
    this.ttlMap.clear();
    diagnosticsManager.logTelemetry('cache', 'Cleared entire memory cache store');
  }
}

export const cacheManager = new CacheManager();
