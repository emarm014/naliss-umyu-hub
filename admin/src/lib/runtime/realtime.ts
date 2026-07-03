import { supabase } from '../supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { diagnosticsManager } from './diagnostics';

type RealtimeCallback = (payload: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: any;
  oldRecord: any;
}) => void;

class RealtimeCoordinator {
  private channels: Map<string, RealtimeChannel> = new Map();
  private callbacks: Set<RealtimeCallback> = new Set();
  private isVisible = true;
  private isSubscribed = false;
  private pendingEvents: any[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tables: string[] = [];
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('online', this.handleOnline);
    }
  }

  public registerTables(tables: string[]) {
    this.tables = [...new Set([...this.tables, ...tables])];
    diagnosticsManager.logTelemetry('realtime', `Registered tables: ${tables.join(', ')}`);
  }

  public subscribe(callback: RealtimeCallback) {
    this.callbacks.add(callback);
    if (!this.isSubscribed) {
      this.isSubscribed = true;
      this.connectAll();
      this.startHeartbeat();
    }
  }

  public unsubscribe(callback: RealtimeCallback) {
    this.callbacks.delete(callback);
    if (this.callbacks.size === 0 && this.isSubscribed) {
      this.isSubscribed = false;
      this.disconnectAll();
      this.stopHeartbeat();
    }
  }

  private connectAll() {
    if (!this.isVisible) return;
    this.tables.forEach((table) => {
      if (this.channels.has(table)) return;

      const channel = supabase
        .channel(`admin_coord_rt_${table}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            this.handleIncomingEvent(table, payload);
          }
        )
        .subscribe((status) => {
          diagnosticsManager.logTelemetry('realtime', `Channel status for "${table}": ${status}`);
          if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            this.handleReconnect(table);
          }
        });

      this.channels.set(table, channel);
    });
  }

  private disconnectAll() {
    this.channels.forEach((channel) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
    diagnosticsManager.logTelemetry('realtime', 'Disconnected all channels');
  }

  private handleIncomingEvent(table: string, payload: any) {
    diagnosticsManager.startTimer(`rt_event_${table}`);

    // Event batching within 75ms frame window to protect UI thread from render storm
    this.pendingEvents.push({
      table,
      eventType: payload.eventType,
      newRecord: payload.new,
      oldRecord: payload.old,
    });

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushEvents();
      }, 75);
    }
  }

  private flushEvents() {
    this.flushTimer = null;
    const eventsToFlush = [...this.pendingEvents];
    this.pendingEvents = [];

    eventsToFlush.forEach((event) => {
      this.callbacks.forEach((cb) => cb(event));
      diagnosticsManager.endTimer(`rt_event_${event.table}`, 'realtime');
    });
  }

  private handleVisibilityChange = () => {
    const visible = document.visibilityState === 'visible';
    if (visible === this.isVisible) return;
    this.isVisible = visible;

    if (visible) {
      this.connectAll();
    } else {
      this.disconnectAll();
    }
  };

  private handleOnline = () => {
    if (this.isSubscribed) {
      this.disconnectAll();
      this.connectAll();
    }
  };

  private handleReconnect(table: string, attempt = 0) {
    const jitter = Math.random() * 1000;
    const delay = Math.min(1000 * 2 ** attempt + jitter, 30000);
    
    setTimeout(() => {
      if (!this.isSubscribed || !this.isVisible) return;
      const existing = this.channels.get(table);
      if (existing) {
        supabase.removeChannel(existing);
        this.channels.delete(table);
      }
      
      const channel = supabase
        .channel(`admin_coord_rt_${table}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            this.handleIncomingEvent(table, payload);
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            this.handleReconnect(table, attempt + 1);
          }
        });
      this.channels.set(table, channel);
    }, delay);
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      // Validate websocket session connectivity
      const isConnected = supabase.realtime.isConnected();
      if (!isConnected) {
        diagnosticsManager.logTelemetry('realtime', 'WebSocket connection lost, prompting socket connect()');
        supabase.realtime.connect();
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

export const realtimeCoordinator = new RealtimeCoordinator();
