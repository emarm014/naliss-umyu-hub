import * as Sentry from '@sentry/react';

class DiagnosticsManager {
  private startTimeMap: Map<string, number> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;

  public startTimer(key: string) {
    this.startTimeMap.set(key, performance.now());
  }

  public endTimer(key: string, category = 'runtime') {
    const start = this.startTimeMap.get(key);
    if (start === undefined) return 0;
    const duration = performance.now() - start;
    this.startTimeMap.delete(key);

    this.logTelemetry(category, `Performance metric: ${key}`, {
      durationMs: Number(duration.toFixed(2)),
    });
    return duration;
  }

  public logCacheHit(hit: boolean) {
    if (hit) this.cacheHits++;
    else this.cacheMisses++;

    const ratio = this.getCacheHitRatio();
    if ((this.cacheHits + this.cacheMisses) % 50 === 0) {
      this.logTelemetry('cache', `Cache status updated`, {
        ratio: `${(ratio * 100).toFixed(2)}%`,
        hits: this.cacheHits,
        misses: this.cacheMisses,
      });
    }
  }

  public getCacheHitRatio(): number {
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) return 1.0;
    return this.cacheHits / total;
  }

  public logTelemetry(category: string, message: string, data: Record<string, any> = {}) {
    // Add Sentry breadcrumb
    Sentry.addBreadcrumb({
      category,
      message,
      data,
      level: data.error ? 'error' : 'info',
    });

    // Console logging in dev mode
    if (import.meta.env.DEV) {
      console.log(`[Diagnostics] [${category}] ${message}`, data);
    }
  }
}

export const diagnosticsManager = new DiagnosticsManager();
