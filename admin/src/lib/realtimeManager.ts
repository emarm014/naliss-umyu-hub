import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

type RealtimeCallback = (payload: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: any;
  oldRecord: any;
}) => void;

export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';

class RealtimeManager {
  private channels: Map<string, RealtimeChannel> = new Map();
  private callbacks: Set<RealtimeCallback> = new Set();
  private isVisible: boolean = true;
  private isSubscribed: boolean = false;
  private pendingEvents: any[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tables: string[] = [];
  
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

  private connectAll() {
    console.log(`[IDLE-AUDIT] RealtimeManager connectAll at ${Date.now()}`);
    this.setStatus('CONNECTING');

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
          if (status === 'SUBSCRIBED') {
            this.setStatus('CONNECTED');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.setStatus('DISCONNECTED');
          }
        });

      this.channels.set(table, channel);
    });
  }

  private disconnectAll() {
    console.log(`[IDLE-AUDIT] RealtimeManager disconnectAll at ${Date.now()}`);
    this.channels.forEach((channel) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
    
    this.setStatus('DISCONNECTED');
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

    // Fix 1: We no longer disconnect channels on hidden!
    // Disconnecting causes reconnect storms and orphans other channels.
    // Instead, we just pause processing in handleIncomingEvent and let 
    // App.tsx's focus handler trigger a syncAll(true) when we return.
  };
}

export const adminRealtimeManager = new RealtimeManager();
