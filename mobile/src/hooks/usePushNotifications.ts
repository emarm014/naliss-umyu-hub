import { useEffect, useRef } from 'react';
import { Platform, Linking, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { supabase } from '../api/supabase/client';
import { useAuthStore } from '../stores/auth.store';
import { useSignupStore } from '../stores/signup.store';
import { useNotificationStore } from '../stores/notification.store';
import { registerOnlineCallback } from '../stores/network.store';
import { upsertEntityFromNotification } from '../utils/notifications';
import { UnifiedDownloadEngine } from '../utils/unifiedDownload';
import { NotificationRouter } from '../services/notificationRouter';
import { normalizeError } from '../utils/sentry';

const EXPO_PUSH_TOKEN_REGEX = /^Expo(nent)?PushToken\[.+\]$/;

// ── Per-device push token cache & registration state ──────────────────────────
let currentPushToken: string | null = null;
let isTokenSavedToDb = false;
let registrationRetryTimer: ReturnType<typeof setTimeout> | null = null;
let registrationRetryAttempt = 0;
let registrationInFlight = false;
const MAX_REGISTRATION_RETRIES = 5;

function clearRegistrationRetryTimer() {
  if (registrationRetryTimer) {
    clearTimeout(registrationRetryTimer);
    registrationRetryTimer = null;
  }
}

export function getEasProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export function isValidExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && EXPO_PUSH_TOKEN_REGEX.test(token);
}

/**
 * Returns the push token registered by this device instance, or null if not yet registered.
 * Used by auth.store.ts signOut to scope token deletion to the current device only.
 */
export function getCurrentPushToken(): string | null {
  return currentPushToken;
}

/**
 * Opens the OS notification settings screen for this app.
 * Useful when the user has permanently denied notification permissions
 * and needs to re-enable them from Settings.
 */
export async function openNotificationSettings(): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openSettings();
    } else {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS,
        {
          extra: {
            'android.provider.extra.APP_PACKAGE':
              Constants.expoConfig?.android?.package ?? 'com.naliss.umyuk',
          },
        }
      );
    }
  } catch {
    // Fallback: open general app settings
    await Linking.openSettings();
  }
}

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification?.request?.content?.data;
    const activeGroupId = NotificationRouter.getActiveChatGroupId();

    // Active Chat Foreground Suppression:
    // If the user is currently viewing the active chat (e.g. /chat/group_123),
    // suppress foreground alert & sound so banners don't pop up over their active conversation.
    const isCurrentActiveChat =
      data?.type === 'message' &&
      data?.group_id &&
      activeGroupId &&
      String(data.group_id) === String(activeGroupId);

    const msgId = String(data?.id || data?.notification_id || '');
    const isDuplicateMessage =
      (data?.type === 'message' || data?.type === 'chat') &&
      !data?._localRealtime &&
      NotificationRouter.hasShownMessageNotification(msgId);

    if ((data?.type === 'message' || data?.type === 'chat') && msgId && !isCurrentActiveChat) {
      NotificationRouter.markMessageNotificationShown(msgId);
    }

    if (isCurrentActiveChat || isDuplicateMessage) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: false,
        shouldShowList: true,
      };
    }

    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      shouldShowList: true,
    };
  },
});

const BACKGROUND_FETCH_TASK = 'background-notification-sync';

// Background Task Registration
TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (userId) {
      const { data: remoteHistory, error } = await supabase
        .from('notification_history')
        .select('*')
        .eq('user_id' as any, userId as any)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && remoteHistory && remoteHistory.length > 0) {
        const localList = remoteHistory.map((h: any) => ({
          id: h.notification_id,
          type: h.type,
          title: h.title,
          message: h.body,
          date: h.created_at,
          isRead: h.is_read,
          data: h.data,
        }));
        useNotificationStore.getState().addNotifications(localList);
      }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Local Rich Media Cache Helper
async function cacheMediaForNotification(data: any): Promise<any> {
  const imageUrl = data?.cover_image_url || data?.file_url || data?.image_url || data?.avatar_url || null;
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) return data;
  try {
    const fileId = `notif_cache_${Date.now()}`;
    const localUri = await UnifiedDownloadEngine.download(imageUrl, fileId, undefined, 'cache');
    if (!localUri) return data;
    return {
      ...data,
      cover_image_url: localUri,
      image_url: localUri,
    };
  } catch {
    return data;
  }
}

async function ensureAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    await Notifications.deleteNotificationChannelAsync('messages');
    await Notifications.deleteNotificationChannelAsync('announcements');
  } catch {
    // ignore if legacy channels don't exist
  }

  // Messages — heads-up + lock screen (like WhatsApp)
  await Notifications.setNotificationChannelAsync('messages_v2', {
    name: 'Messages & Chat',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#064e3b',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  // Announcements — heads-up + lock screen
  await Notifications.setNotificationChannelAsync('announcements_v2', {
    name: 'Announcements',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#064e3b',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  // Events & Competitions — high-importance heads-up + lock screen
  await Notifications.setNotificationChannelAsync('events_v1', {
    name: 'Events & Competitions',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#064e3b',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  // Featured Students — heads-up
  await Notifications.setNotificationChannelAsync('featured', {
    name: 'Featured Students',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 100, 300],
    lightColor: '#F59E0B',
    sound: 'default',
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  // General — normal tray
  await Notifications.setNotificationChannelAsync('general', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });

  // High Priority (respect DND)
  await Notifications.setNotificationChannelAsync('urgent_alerts_v1', {
    name: 'Default Alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#064e3b',
    bypassDnd: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
    showBadge: true,
  });

  // Critical Security (bypasses DND)
  await Notifications.setNotificationChannelAsync('critical_security', {
    name: 'Critical & Security Alerts',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#991b1b',
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
    showBadge: true,
  });

  // Low Priority / silent
  await Notifications.setNotificationChannelAsync('low_priority', {
    name: 'Silent Updates',
    importance: Notifications.AndroidImportance.LOW,
    showBadge: false,
    sound: null,
    vibrationPattern: null,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
  });

  try {
    const legacyChannel = await Notifications.getNotificationChannelAsync('default');
    if (legacyChannel) {
      await Notifications.deleteNotificationChannelAsync('default');
    }
  } catch {
    // silent
  }
}

export function usePushNotifications() {
  const { user, isProfileComplete } = useAuthStore();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const handledNotificationId = useRef<string | null>(null);

  // Register Android notification channels once on mount
  useEffect(() => {
    ensureAndroidNotificationChannels().catch(() => {});
  }, []);

  // Cold-start handler
  useEffect(() => {
    if (lastNotificationResponse) {
      const id = lastNotificationResponse.notification.request.identifier;
      if (id !== handledNotificationId.current) {
        handledNotificationId.current = id;
        NotificationRouter.handleColdStartResponse(lastNotificationResponse);
      }
    }
  }, [lastNotificationResponse]);

  // Telemetry Helper (per-device aware)
  async function logTelemetry(
    notifId: string,
    type: string,
    status: 'delivered' | 'opened' | 'dismissed' | 'failed'
  ) {
    if (!notifId) return;
    try {
      const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'unknown';
      const deviceInfo = `${Platform.Version}`;
      const { error } = await (supabase as any).rpc('log_notification_telemetry', {
        p_notification_id: notifId,
        p_type: type || 'general',
        p_status: status,
        p_platform: platform,
        p_device_info: deviceInfo,
        p_push_token: currentPushToken,
      });
      if (error) {
        console.warn('[PushNotifications] log_notification_telemetry error:', error.message);
      }
    } catch {
      // silent
    }
  }

  // Cross-device History Synchronization
  async function syncNotificationHistory() {
    if (!user) return;
    try {
      const { data: remoteHistory, error } = await supabase
        .from('notification_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw normalizeError(error);
      if (remoteHistory && remoteHistory.length > 0) {
        const localList = remoteHistory.map((h: any) => ({
          id: h.notification_id,
          type: h.type,
          title: h.title,
          message: h.body,
          date: h.created_at,
          isRead: h.is_read,
          data: h.data,
        }));
        useNotificationStore.getState().addNotifications(localList);
      }
    } catch {
      // silent
    }
  }

  useEffect(() => {
    let tokenListener: any = null;
    let appStateSub: any = null;
    let unregisterOnlineCb: (() => void) | null = null;
    let isMounted = true;

    const isSigningUp = useSignupStore.getState().hasActiveSession() || isProfileComplete === false;

    const scheduleRegistrationRetry = () => {
      if (!isMounted || IS_EXPO_GO) return;
      if (registrationRetryAttempt >= MAX_REGISTRATION_RETRIES) return;

      clearRegistrationRetryTimer();
      const delayMs = 2000 * Math.pow(2, registrationRetryAttempt);
      registrationRetryAttempt += 1;

      registrationRetryTimer = setTimeout(() => {
        if (!isMounted) return;
        attemptTokenRegistration(false);
      }, delayMs);
    };

    const attemptTokenRegistration = async (allowPrompt: boolean) => {
      if (!isMounted || !user || isSigningUp || IS_EXPO_GO || registrationInFlight) return;
      registrationInFlight = true;
      try {
        const token = await registerForPushNotificationsAsync({ allowPrompt });
        if (!token) {
          // If permission is already granted, token retrieval failed transiently -> backoff retry
          const perm = await Notifications.getPermissionsAsync().catch(() => null);
          if (perm?.status === 'granted') {
            scheduleRegistrationRetry();
          }
          return;
        }

        const saved = await saveTokenToDatabase(token);
        if (saved) {
          registrationRetryAttempt = 0;
          clearRegistrationRetryTimer();
        } else {
          scheduleRegistrationRetry();
        }
      } catch {
        scheduleRegistrationRetry();
      } finally {
        registrationInFlight = false;
      }
    };

    if (user && !isSigningUp) {
      registrationRetryAttempt = 0;
      attemptTokenRegistration(true);

      // Token Rotation listener:
      // addPushTokenListener receives the raw native device token (FCM/APNs).
      // Always exchange it for a fresh Expo Push Token using the EAS projectId and save ONLY the Expo token.
      tokenListener = Notifications.addPushTokenListener(async () => {
        if (IS_EXPO_GO || !isMounted) return;
        const projectId = getEasProjectId();
        try {
          const expoTokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
          const freshExpoToken = expoTokenObj?.data;
          if (isValidExpoPushToken(freshExpoToken)) {
            currentPushToken = freshExpoToken;
            isTokenSavedToDb = false;
            const saved = await saveTokenToDatabase(freshExpoToken);
            if (!saved) {
              registrationRetryAttempt = 0;
              scheduleRegistrationRetry();
            }
          }
        } catch {
          registrationRetryAttempt = 0;
          scheduleRegistrationRetry();
        }
      });

      // Sync history and delivered tray
      syncNotificationHistory();
      syncDeliveredNotifications();

      // AppState listener: when app resumes to foreground, re-check notification permission
      // without prompting again, retry token registration if needed, and sync history
      appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          if (!currentPushToken || !isTokenSavedToDb) {
            registrationRetryAttempt = 0;
            attemptTokenRegistration(false);
          } else {
            // Even if previously saved, re-verify permission wasn't toggled in OS Settings
            Notifications.getPermissionsAsync()
              .then(({ status }) => {
                if (status === 'granted' && (!currentPushToken || !isTokenSavedToDb)) {
                  registrationRetryAttempt = 0;
                  attemptTokenRegistration(false);
                }
              })
              .catch(() => {});
          }

          try {
            const { useNetworkStore } = require('../stores/network.store');
            if (useNetworkStore.getState().isOnline) {
              syncNotificationHistory();
              syncDeliveredNotifications();
            }
          } catch {
            syncNotificationHistory();
            syncDeliveredNotifications();
          }
        }
      });

      // Network reconnect listener: retry registration with backoff (without prompting) and sync history
      unregisterOnlineCb = registerOnlineCallback(() => {
        if (!isMounted) return;
        if (!currentPushToken || !isTokenSavedToDb) {
          registrationRetryAttempt = 0;
          attemptTokenRegistration(false);
        }
        syncNotificationHistory();
        syncDeliveredNotifications();
      });

      // Register background task
      BackgroundTask.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60,
      }).catch((err) => console.error('[PushNotifications] background task registration failed:', err));
    } else if (!user) {
      isTokenSavedToDb = false;
      clearRegistrationRetryTimer();
    }

    // Fired when a notification is received while the app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(async (notification) => {
      const { title, body, data } = notification.request.content;
      const notifType = (data?.type as string) || 'general';
      const fallbackId = `local_${notification.date || 0}_${title || 'notitle'}_${notifType}`;
      const notifId = data?.notification_id || data?.id || notification.request.identifier || fallbackId;

      // Silent Sync pushes wake application and trigger reloading
      if (notifType === 'silent_sync' || data?.is_silent === 'true' || data?.is_silent === true) {
        if (data?.sync_target === 'profile') {
          useAuthStore.getState().fetchProfile(true).catch(e => {
            console.error('[PushNotifications] background profile sync failed:', e);
          });
        }
        return;
      }

      const cachedData = await cacheMediaForNotification(data);
      const effectiveNotifId = notifType === 'fyb_congratulation'
        ? `fyb_congratulations_${data?.featured_student_id || 'active'}`
        : notifId;

      useNotificationStore.getState().addNotification({
        id: String(effectiveNotifId || ''),
        type: notifType,
        title: title || 'New Notification',
        message: body || '',
        date: new Date().toISOString(),
        isRead: false,
        data: cachedData,
      });

      if (data?.type) {
        upsertEntityFromNotification(data.type as string, data);
      }

      if (!data?._localRealtime) {
        logTelemetry(String(notifId || ''), notifType, 'delivered');
      }
    });

    // Fired when user taps a notification (foreground, background, or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const { title, body, data } = response.notification.request.content;
      const notifType = (data?.type as string) || 'general';
      const fallbackId = `local_${response.notification.date || 0}_${title || 'notitle'}_${notifType}`;
      const notifId = data?.notification_id || data?.id || response.notification.request.identifier || fallbackId;

      const cachedData = await cacheMediaForNotification(data);
      const effectiveNotifId = notifType === 'fyb_congratulation'
        ? `fyb_congratulations_${data?.featured_student_id || 'active'}`
        : notifId;

      useNotificationStore.getState().addNotification({
        id: String(effectiveNotifId || ''),
        type: notifType,
        title: title || 'New Notification',
        message: body || '',
        date: response.notification.date ? new Date(response.notification.date).toISOString() : new Date().toISOString(),
        isRead: true,
        data: cachedData,
      });

      if (data?.type) {
        upsertEntityFromNotification(data.type as string, data);
      }

      const actionId = response.actionIdentifier;

      // Handle Quick Actions
      if (actionId === 'mark_read') {
        useNotificationStore.getState().markAsRead(String(notifId || ''));
        try {
          const { error: readErr } = await (supabase as any)
            .from('notification_history')
            .update({ is_read: true } as any)
            .eq('notification_id', String(notifId || ''));
          if (readErr) {
            console.error('[PushNotifications] mark notification read failed:', readErr.message);
          }
        } catch (err: any) {
          console.error('[PushNotifications] mark notification read failed:', err);
        }
      } else if (actionId === 'reply' && (response as any).userText && (data as any)?.group_id && user) {
        const replyText = (response as any).userText;
        // Server trigger tr_enqueue_chat_message_notification + tr_kick_notification_worker
        // automatically dispatches the push notification upon INSERT into public.messages.
        const { error: replyErr } = await (supabase as any).from('messages').insert({
          group_id: (data as any).group_id,
          sender_id: user.id,
          content: replyText,
        });
        if (replyErr) {
          console.error('[PushNotifications] quick reply insert failed:', replyErr.message);
        }
      } else if (actionId === 'remind_later') {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Reminder: ${title}`,
            body: body || 'You scheduled a reminder.',
            data: data,
          },
          trigger: { seconds: 3600 } as any,
        });
      } else if (actionId === 'download' && (data as any)?.file_url) {
        try {
          const fileUrl = (data as any).file_url;
          await UnifiedDownloadEngine.download(fileUrl, `notif_dl_${Date.now()}`);
        } catch {
          // silent
        }
      } else if (actionId === 'dismiss') {
        logTelemetry(String(notifId || ''), notifType, 'dismissed');
      } else {
        logTelemetry(String(notifId || ''), notifType, 'opened');
        NotificationRouter.handleTapResponse(response);
      }
    });

    async function syncDeliveredNotifications() {
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        for (const notif of presented) {
          const { title, body, data } = notif.request.content;
          const notifType = (data?.type as string) || 'general';
          const fallbackId = `local_${notif.date || 0}_${title || 'notitle'}_${notifType}`;
          const notifId = data?.notification_id || data?.id || notif.request.identifier || fallbackId;
          const dateStr = notif.date ? new Date(notif.date).toISOString() : new Date().toISOString();

          const cachedData = await cacheMediaForNotification(data);

          useNotificationStore.getState().addNotification({
            id: String(notifId || ''),
            type: notifType,
            title: title || 'New Notification',
            message: body || '',
            date: dateStr,
            isRead: false,
            data: cachedData,
          });

          if (data?.type) {
            upsertEntityFromNotification(data.type as string, data);
          }

          if (!data?._localRealtime) {
            logTelemetry(String(notifId || ''), notifType, 'delivered');
          }
        }
      } catch {
        // silent
      }
    }

    return () => {
      isMounted = false;
      clearRegistrationRetryTimer();
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
      if (tokenListener) {
        tokenListener.remove();
      }
      if (appStateSub) {
        appStateSub.remove();
      }
      if (unregisterOnlineCb) {
        unregisterOnlineCb();
      }
    };
  }, [user?.id, isProfileComplete]);
}

/**
 * Saves a validated Expo push token to the database via register_push_token RPC
 * (with fallback to user_push_tokens upsert). Rejects raw native FCM/APNs tokens.
 */
export async function saveTokenToDatabase(token: string): Promise<boolean> {
  if (!isValidExpoPushToken(token)) {
    console.warn('[PushNotifications] Rejected non-Expo push token in saveTokenToDatabase');
    return false;
  }

  const user = useAuthStore.getState().user || (await supabase.auth.getUser()).data.user;
  if (!user) return false;

  try {
    const { error: rpcError } = await (supabase as any).rpc('register_push_token', {
      p_token: token,
    });

    if (!rpcError) {
      isTokenSavedToDb = true;
      return true;
    }

    // Fallback if migration hasn't been applied yet
    const { error: upsertError } = await (supabase as any)
      .from('user_push_tokens')
      .upsert(
        { user_id: user.id, push_token: token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,push_token' }
      );

    if (upsertError) {
      throw normalizeError(upsertError);
    }

    isTokenSavedToDb = true;
    return true;
  } catch (err: any) {
    console.warn('[PushNotifications] saveTokenToDatabase failed:', err?.message || err);
    isTokenSavedToDb = false;
    return false;
  }
}

async function configureNotificationCategories() {
  try {
    await Notifications.setNotificationCategoryAsync('chat_actions', [
      {
        identifier: 'reply',
        buttonTitle: 'Reply',
        textInput: {
          submitButtonTitle: 'Send',
          placeholder: 'Type reply...',
        },
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'mark_read',
        buttonTitle: 'Mark as Read',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'mute',
        buttonTitle: 'Mute Conversation',
        options: { opensAppToForeground: false },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('announcement_actions', [
      {
        identifier: 'open',
        buttonTitle: 'Open',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'save',
        buttonTitle: 'Save',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'dismiss',
        buttonTitle: 'Dismiss',
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('event_actions', [
      {
        identifier: 'join',
        buttonTitle: 'Join',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'interested',
        buttonTitle: 'Interested',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'dismiss',
        buttonTitle: 'Dismiss',
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('quiz_actions', [
      {
        identifier: 'start_quiz',
        buttonTitle: 'Start Quiz',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'remind_later',
        buttonTitle: 'Remind Me Later',
        options: { opensAppToForeground: false },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('material_actions', [
      {
        identifier: 'download',
        buttonTitle: 'Download File',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'bookmark',
        buttonTitle: 'Bookmark',
        options: { opensAppToForeground: false },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('security_actions', [
      {
        identifier: 'review',
        buttonTitle: 'Review Alert',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'secure_account',
        buttonTitle: 'Secure Account',
        options: { opensAppToForeground: true, isDestructive: true },
      },
    ]);
  } catch {
    // silent
  }
}

export async function registerForPushNotificationsAsync(
  options?: { allowPrompt?: boolean }
): Promise<string | null | undefined> {
  const allowPrompt = options?.allowPrompt !== false;
  let token: string | null = null;

  const categoriesPromise = configureNotificationCategories();

  await ensureAndroidNotificationChannels();

  const isDevice = Constants.isDevice !== false;
  if (isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted' && allowPrompt) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      await categoriesPromise;
      return null;
    }

    const projectId = getEasProjectId();

    try {
      const rawToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (isValidExpoPushToken(rawToken)) {
        token = rawToken;
        if (!IS_EXPO_GO) {
          currentPushToken = token;
          await saveTokenToDatabase(token);
        }
      }
    } catch (err: any) {
      console.warn('[PushNotifications] getExpoPushTokenAsync error:', err?.message || err);
    }
  }

  await categoriesPromise;

  return token;
}
