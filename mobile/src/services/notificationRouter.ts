import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useNotificationStore } from '../stores/notification.store';
import { upsertEntityFromNotification } from '../utils/notifications';
import { captureStoreError } from '../utils/sentry';

export interface NotificationIntent {
  path: string;
  notifId: string;
  type: string;
  data?: any;
  timestamp: number;
}

class NotificationRouterService {
  private pendingIntent: NotificationIntent | null = null;
  private handledResponseIds = new Set<string>();
  private isAppReady = false;
  private isAuthResolved = false;
  private isAuthGated = false;
  private activeChatGroupId: string | null = null;

  public setActiveChatGroupId(groupId: string | null): void {
    this.activeChatGroupId = groupId;
  }

  public getActiveChatGroupId(): string | null {
    return this.activeChatGroupId;
  }

  /**
   * Safe payload resolution for all supported notification types.
   * Never throws, handles missing/deleted/malformed payloads gracefully.
   */
  public resolvePathFromPayload(data: any): string {
    if (!data || typeof data !== 'object') {
      return '/(tabs)';
    }

    const type = String(data.type || '').toLowerCase();
    const entityId = data.id || data.group_id || data.pool_id || data.announcement_id || data.event_id;

    try {
      switch (type) {
        case 'chat':
        case 'message':
          const chatId = data.group_id || data.id || data.chatId;
          if (chatId && typeof chatId === 'string' && chatId.length >= 5) {
            return `/chat/${chatId}`;
          } else {
            console.warn('[Notification] Invalid chatId in payload:', chatId);
            return '/(tabs)/messages';
          }

        case 'announcement':
          if (entityId) {
            return `/announcement/${entityId}`;
          }
          return '/(tabs)/announcements';

        case 'event':
          if (entityId) {
            return `/event/${entityId}`;
          }
          return '/(tabs)/announcements';

        case 'quiz':
        case 'event_pool':
        case 'event_pool_quiz':
          if (entityId) {
            return `/event-pool/${entityId}`;
          }
          return '/(tabs)';

        case 'assignment':
        case 'material':
        case 'resource':
          if (data.file_url) {
            const encodedUrl = encodeURIComponent(data.file_url);
            const encodedTitle = encodeURIComponent(data.title || 'Document');
            return `/viewer?fileUrl=${encodedUrl}&fileName=${encodedTitle}`;
          }
          return '/(tabs)/resources';

        case 'security':
        case 'profile':
          if (data.userId && typeof data.userId === 'string') {
            return `/chat/user_profile/${data.userId}`;
          }
          return '/profile';

        case 'fyb':
        case 'fyb_congratulation':
          return '/fyb';

        case 'system':
        case 'general':
        default:
          return '/(tabs)';
      }
    } catch {
      return '/(tabs)';
    }
  }

  /**
   * Primary entry point for handling notification responses (taps).
   * Deduplicates tap events, normalizes destination, and queues or executes navigation.
   */
  public handleNotificationResponse(
    response: Notifications.NotificationResponse,
    currentPathname?: string
  ): void {
    if (!response || !response.notification) return;

    const notif = response.notification;
    const notifId = notif.request.identifier || `notif_${Date.now()}`;
    const actionId = response.actionIdentifier || Notifications.DEFAULT_ACTION_IDENTIFIER;
    const responseKey = `${notifId}_${actionId}_${notif.date || 0}`;

    // 1. Deduplicate handling of identical response events
    if (this.handledResponseIds.has(responseKey)) {
      return;
    }
    this.handledResponseIds.add(responseKey);

    // Limit set size to prevent memory leaks over long sessions
    if (this.handledResponseIds.size > 100) {
      const firstItem = this.handledResponseIds.values().next().value;
      if (firstItem) this.handledResponseIds.delete(firstItem);
    }

    const data = notif.request.content.data || {};
    const notifType = typeof data.type === 'string' ? data.type : 'general';

    // 2. Sync entity & mark read in local store
    if (typeof data.type === 'string') {
      upsertEntityFromNotification(data.type, data);
    }
    useNotificationStore.getState().markAsRead(notifId);

    // Only process navigation for default tap action
    if (actionId !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
      return;
    }

    const targetPath = this.resolvePathFromPayload(data);

    // 3. Foreground Deduplication: If already on target path, skip navigation
    if (currentPathname && currentPathname === targetPath) {
      return;
    }

    // 4. Queue or flush intent
    this.pendingIntent = {
      path: targetPath,
      notifId,
      type: notifType,
      data,
      timestamp: Date.now(),
    };

    this.attemptFlushIntent();
  }

  /**
   * Sets app UI readiness (called when RootLayoutNav completes initial mount).
   */
  public setAppReady(ready: boolean): void {
    this.isAppReady = ready;
    if (ready) {
      this.attemptFlushIntent();
    }
  }

  /**
   * Sets auth resolution status (called by ProtectedRoute when auth gate opens/closes).
   */
  public setAuthResolved(resolved: boolean, isGated: boolean): void {
    this.isAuthResolved = resolved;
    this.isAuthGated = isGated;
    if (resolved && !isGated) {
      this.attemptFlushIntent();
    }
  }

  /**
   * Attempts to flush the buffered notification intent if all system dependencies are ready.
   */
  public attemptFlushIntent(): void {
    if (!this.pendingIntent) return;

    // Must have app UI ready, auth resolved, and not be gated in auth/login screens
    if (!this.isAppReady || !this.isAuthResolved || this.isAuthGated) {
      return;
    }

    const intent = this.pendingIntent;
    this.pendingIntent = null; // Clear before navigating to prevent double execution

    try {
      router.push(intent.path as any);
    } catch (err) {
      captureStoreError('notificationRouter', 'flushIntent', err, { intent });
      // Fallback navigation
      try {
        router.push('/(tabs)' as any);
      } catch {
        // silent
      }
    }
  }

  /**
   * Returns current pending intent if any.
   */
  public getPendingIntent(): NotificationIntent | null {
    return this.pendingIntent;
  }

  /**
   * Clears any stale or cancelled pending intent.
   */
  public clearPendingIntent(): void {
    this.pendingIntent = null;
  }
}

export const NotificationRouter = new NotificationRouterService();
