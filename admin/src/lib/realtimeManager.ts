import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

type RealtimeCallback = (payload: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: any;
  oldRecord: any;
}) => void;

export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';

/**
 * Manages a SINGLE multiplexed Supabase Realtime channel that listens to
 * all registered tables. This avoids the previous architecture of 20
 * separate channels (one per table) which caused reconnect floods when
 * the WebSocket dropped.
 */
class RealtimeManager {
  private channel: RealtimeChannel | null = null;
  private callbacks: Set<RealtimeCallback> = new Set();
  private isVisible: boolean = true;
  private isSubscribed: boolean = false;
  private pendingEvents: any[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tables: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private connectInProgress: boolean = false;

  private static readonly MAX_RECONNECT_ATTEMPTS = 20;

  private connectionStatus: ConnectionStatus = 'DISCONNECTED';
  private statusCallbacks: Set<(status: ConnectionStatus) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public registerTables(tables: string[]) {
    this.tables = [...new Set([...this.tables, ...tables])];
  }

  public subscribe(callback: RealtimeCallback) {
    this.callbacks.add(callback);
    if (!this.isSubscribed) {
      this.isSubscribed = true;
      this.connect();
    }
  }

  public unsubscribe(callback: RealtimeCallback) {
    this.callbacks.delete(callback);
    if (this.callbacks.size === 0 && this.isSubscribed) {
      this.isSubscribed = false;
      this.disconnect();
    }
  }

  public onStatusChange(callback: (status: ConnectionStatus) => void) {
    this.statusCallbacks.add(callback);
    callback(this.connectionStatus);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  private setStatus(status: ConnectionStatus) {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.statusCallbacks.forEach((cb) => cb(status));
    }
  }

  /**
   * Creates ONE channel and registers postgres_changes listeners for ALL
   * tables on it. Supabase multiplexes them over the same WebSocket.
   */
  private connect() {
    // Guard: if a connect is already in progress (e.g. StrictMode double-mount
    // calling subscribe→connect twice rapidly), skip the second call.
    if (this.connectInProgress) return;
    this.connectInProgress = true;

    // Tear down any existing channel first
    this.disconnect();

    if (this.tables.length === 0) {
      this.connectInProgress = false;
      return;
    }

    this.setStatus('CONNECTING');

    // Build a single channel with all table listeners chained via .on()
    let builder = supabase.channel('admin_rt_multiplexed');

    this.tables.forEach((table) => {
      builder = builder.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          this.handleIncomingEvent(table, payload);
        }
      );
    });

    this.channel = builder.subscribe((status) => {
      this.connectInProgress = false;
      if (status === 'SUBSCRIBED') {
        this.setStatus('CONNECTED');
        this.reconnectAttempts = 0;
        this.startHealthCheck();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.setStatus('DISCONNECTED');
        this.stopHealthCheck();
        this.scheduleReconnect();
      }
    });
  }

  private disconnect() {
    this.stopHealthCheck();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.setStatus('DISCONNECTED');
  }

  /**
   * Exponential backoff reconnect: 1s, 2s, 4s, 8s, ... max 30s
   */
  private scheduleReconnect() {
    if (!this.isSubscribed) return;
    if (this.reconnectTimer) return; // already scheduled

    // Cap reconnect attempts to prevent infinite spiral
    if (this.reconnectAttempts >= RealtimeManager.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[RealtimeManager] Max reconnect attempts (${RealtimeManager.MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
      this.setStatus('DISCONNECTED');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[RealtimeManager] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${RealtimeManager.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isSubscribed) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Periodic health check: every 45s, verify the channel is still SUBSCRIBED.
   * If not, force a reconnect. This catches silent socket deaths that the
   * heartbeat mechanism misses.
   */
  private startHealthCheck() {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      if (!this.channel) {
        this.scheduleReconnect();
        return;
      }

      // The Supabase channel exposes its state — check it
      const state = (this.channel as any).state;
      if (state !== 'joined' && state !== 'joining') {
        console.warn('[RealtimeManager] Health check: channel in bad state:', state);
        this.connect();
      }
    }, 45000);
  }

  private stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private handleIncomingEvent(table: string, payload: any) {
    // If the tab is hidden, drop the event to save processing.
    // When the tab regains focus, syncAll(true) will fetch fresh data anyway.
    if (!this.isVisible) return;

    // Event batching within 75ms to prevent render storms
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

    // Notify all callbacks with the flushed batch events
    eventsToFlush.forEach((event) => {
      this.callbacks.forEach((cb) => cb(event));
    });
  }

  private handleVisibilityChange = () => {
    const visible = document.visibilityState === 'visible';
    if (visible === this.isVisible) return;
    this.isVisible = visible;

    // When becoming visible again, check if the channel is healthy
    if (visible && this.isSubscribed) {
      if (!this.channel || this.connectionStatus === 'DISCONNECTED') {
        this.reconnectAttempts = 0; // reset backoff on user return
        this.connect();
      }
    }
  };
}

export const adminRealtimeManager = new RealtimeManager();
