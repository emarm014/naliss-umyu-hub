import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

type RealtimeCallback = (payload: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: any;
  oldRecord: any;
}) => void;

class RealtimeManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private callbacks: Set<RealtimeCallback> = new Set();
  private isVisible: boolean = true;
  private isSubscribed: boolean = false;
  private pendingEvents: any[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tables: string[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('online', this.handleOnline);
    }
  }

  public registerTables(tables: string[]) {
    this.tables = [...new Set([...this.tables, ...tables])];
  }

  public subscribe(callback: RealtimeCallback) {
    this.callbacks.add(callback);
    if (!this.isSubscribed) {
      this.isSubscribed = true;
      this.connectAll();
    }
  }

  public unsubscribe(callback: RealtimeCallback) {
    this.callbacks.delete(callback);
    if (this.callbacks.size === 0 && this.isSubscribed) {
      this.isSubscribed = false;
      this.disconnectAll();
    }
  }

  private connectAll() {
    if (!this.isVisible) return;
    this.tables.forEach((table) => {
      if (this.channels.has(table)) return;

      const channel = supabase
        .channel(`admin_rt_mgr_${table}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            this.handleIncomingEvent(table, payload);
          }
        )
        .subscribe((status) => {
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
  }

  private handleIncomingEvent(table: string, payload: any) {
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

    if (visible) {
      // Tab is visible again, reconnect all channels
      this.connectAll();
    } else {
      // Tab is hidden, disconnect all channels to save connections/bandwidth
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
    const delay = Math.min(1000 * 2 ** attempt, 30000);
    setTimeout(() => {
      if (!this.isSubscribed || !this.isVisible) return;
      const existing = this.channels.get(table);
      if (existing) {
        supabase.removeChannel(existing);
        this.channels.delete(table);
      }
      const channel = supabase
        .channel(`admin_rt_mgr_${table}`)
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
}

export const adminRealtimeManager = new RealtimeManager();
