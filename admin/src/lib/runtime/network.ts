import { diagnosticsManager } from './diagnostics';

interface OfflineMutation {
  id: string;
  execute: () => Promise<any>;
  rollback: () => void;
  resolve: (res: any) => void;
  reject: (err: any) => void;
}

class NetworkManager {
  private isOnline = true;
  private latency = 0;
  private slowModeThreshold = 1500; // 1.5s latency threshold
  private offlineQueue: OfflineMutation[] = [];
  private listeners: Set<(status: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      window.addEventListener('online', () => this.handleStatusChange(true));
      window.addEventListener('offline', () => this.handleStatusChange(false));
    }
  }

  public registerListener(callback: (status: boolean) => void) {
    this.listeners.add(callback);
    callback(this.isOnline);
  }

  public unregisterListener(callback: (status: boolean) => void) {
    this.listeners.delete(callback);
  }

  private handleStatusChange(online: boolean) {
    if (this.isOnline === online) return;
    this.isOnline = online;
    diagnosticsManager.logTelemetry('network', `Network status changed to ${online ? 'ONLINE' : 'OFFLINE'}`);
    this.listeners.forEach((cb) => cb(online));

    if (online) {
      this.flushOfflineQueue();
    }
  }

  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  public isSlowConnection(): boolean {
    return this.latency > this.slowModeThreshold;
  }

  public async measureLatency(): Promise<number> {
    const start = performance.now();
    try {
      // Fast ping check using cache-busted request
      await fetch('/ping.txt', { method: 'HEAD', cache: 'no-store' });
    } catch {
      // Ignored - ping check
    }
    const rtt = performance.now() - start;
    this.latency = rtt;
    return rtt;
  }

  public queueOfflineMutation(
    execute: () => Promise<any>,
    rollback: () => void
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substring(2, 9);
      this.offlineQueue.push({ id, execute, rollback, resolve, reject });
      diagnosticsManager.logTelemetry('network', `Queued mutation ${id} while offline. Queue size: ${this.offlineQueue.length}`);
    });
  }

  private async flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    diagnosticsManager.logTelemetry('network', `Flushing ${this.offlineQueue.length} offline mutations`);
    
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const mutation of queue) {
      try {
        const res = await mutation.execute();
        mutation.resolve(res);
      } catch (err) {
        mutation.rollback();
        mutation.reject(err);
      }
    }
  }
}

export const networkManager = new NetworkManager();
