import { useEffect, useRef } from 'react';
import { Platform, Linking, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { supabase } from '../api/supabase/client';
import { useAuthStore } from '../stores/auth.store';
import { useNotificationStore } from '../stores/notification.store';
import { upsertEntityFromNotification } from '../utils/notifications';
import { extractFileNameFromUrl } from '../utils/download';
import { UnifiedDownloadEngine } from '../utils/unifiedDownload';
import { NotificationRouter } from '../services/notificationRouter';

// ── Per-device push token cache ───────────────────────────────────────────────
// Cached in-memory so the auth store can reference it at sign-out time
// to delete only THIS device's token, not all tokens for the user.
let currentPushToken: string | null = null;

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

    if (isCurrentActiveChat) {
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
      const { data: remoteHistory } = await supabase
        .from('notification_history')
        .select('*')
        .eq('user_id' as any, userId as any)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (remoteHistory && remoteHistory.length > 0) {
        const localList = remoteHistory.map((h: any) => ({
          id: h.notification_id,
          type: h.type,
          title: h.title,
          message: h.body,
          date: h.created_at,
          isRead: h.is_read,
          data: h.data
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

export function usePushNotifications() {
  const { user } = useAuthStore();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const handledNotificationId = useRef<string | null>(null);

  // Register Android notification channels once
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    (async () => {
        // Messages — heads-up + lock screen (like WhatsApp)
        await Notifications.setNotificationChannelAsync('messages', {
            name: 'Messages',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#4F46E5',
            sound: 'default',
            showBadge: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        });

        // Announcements — heads-up
        await Notifications.setNotificationChannelAsync('announcements', {
            name: 'Announcements',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 200],
            sound: 'default',
            showBadge: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        });

        // Featured Students — heads-up
        await Notifications.setNotificationChannelAsync('featured', {
            name: 'Featured Students',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 300, 100, 300],
            lightColor: '#F59E0B',
            sound: 'default',
            showBadge: false,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });

        // General / Events — normal tray only (no heads-up)
        await Notifications.setNotificationChannelAsync('general', {
            name: 'General',
            importance: Notifications.AndroidImportance.DEFAULT,
            sound: 'default',
            showBadge: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        });

        // Low priority / silent
        await Notifications.setNotificationChannelAsync('low_priority', {
            name: 'Background',
            importance: Notifications.AndroidImportance.LOW,
            sound: null,
            showBadge: false,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
        });
    })().catch(() => {});
  }, []);

  // Cold-start handler: useLastNotificationResponse covers the case where the
  // app was killed and the user tapped a notification to launch it. The ref
  // guard ensures we only handle each notification ONCE — without it, React
  // enters an infinite re-render loop (useLayoutEffect → setState →
  // re-render → useLayoutEffect → "Maximum update depth exceeded").
  useEffect(() => {
    if (lastNotificationResponse) {
      const id = lastNotificationResponse.notification.request.identifier;
      if (id !== handledNotificationId.current) {
        handledNotificationId.current = id;
        NotificationRouter.handleColdStartResponse(lastNotificationResponse);
      }
    }
  }, [lastNotificationResponse]);

  // Telemetry Helper
  async function logTelemetry(notifId: string, type: string, status: 'delivered' | 'opened' | 'dismissed' | 'failed') {
    try {
      const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'unknown';
      const deviceInfo = `${Platform.Version}`;
      await (supabase as any).rpc('log_notification_telemetry', {
        p_notification_id: notifId,
        p_type: type || 'general',
        p_status: status,
        p_platform: platform,
        p_device_info: deviceInfo,
      });
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
      
      if (error) throw error;
      if (remoteHistory && remoteHistory.length > 0) {
        const localList = remoteHistory.map((h: any) => ({
          id: h.notification_id,
          type: h.type,
          title: h.title,
          message: h.body,
          date: h.created_at,
          isRead: h.is_read,
          data: h.data
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

    if (user) {
      registerForPushNotificationsAsync().then(token => {
        if (token && !IS_EXPO_GO) {
          currentPushToken = token;
          saveTokenToDatabase(token);
        }
      });

      // Token Rotation listener
      tokenListener = Notifications.addPushTokenListener(async (tokenObj) => {
        const token = tokenObj.data;
        if (token && !IS_EXPO_GO) {
          currentPushToken = token;
          await saveTokenToDatabase(token);
        }
      });

      // Sync history and delivered tray
      syncNotificationHistory();
      syncDeliveredNotifications();

      // AppState listener to re-sync history and badge when app resumes to foreground
      appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          syncNotificationHistory();
          syncDeliveredNotifications();
        }
      });



      // Register background task
      BackgroundTask.registerTaskAsync(BACKGROUND_FETCH_TASK, {
        minimumInterval: 15 * 60,
      }).catch((err) => console.error('[PushNotifications] background task registration failed:', err));
    }

    // Fired when a notification is received while the app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(async (notification) => {
      const { title, body, data } = notification.request.content;
      const notifId = notification.request.identifier || Math.random().toString(36).substring(2);
      const notifType = (data?.type as string) || 'general';

      // Silent Sync pushes wake application and trigger reloading
      if (notifType === 'silent_sync' || data?.is_silent === 'true' || data?.is_silent === true) {
        if (data?.sync_target === 'profile') {
          useAuthStore.getState().fetchProfile(true).catch(e => {
            console.error('[PushNotifications] background profile sync failed:', e);
          });
        } else if (data?.sync_target === 'messages' && data?.group_id) {
          // Future expansion: trigger messages reload
        }
        return;
      }
      
      const cachedData = await cacheMediaForNotification(data);
      const effectiveNotifId = notifType === 'fyb_congratulation'
        ? `fyb_congratulations_${data?.featured_student_id || 'active'}`
        : notifId;

      useNotificationStore.getState().addNotification({
        id: effectiveNotifId,
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

      // Log telemetry
    });

    // Fired when user taps a notification (foreground, background, or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const { title, body, data } = response.notification.request.content;
      const notifId = response.notification.request.identifier || Math.random().toString(36).substring(2);
      const notifType = (data?.type as string) || 'general';
      
      const cachedData = await cacheMediaForNotification(data);
      const effectiveNotifId = notifType === 'fyb_congratulation'
        ? `fyb_congratulations_${data?.featured_student_id || 'active'}`
        : notifId;

      useNotificationStore.getState().addNotification({
        id: effectiveNotifId,
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
        useNotificationStore.getState().markAsRead(notifId);
        try {
          await (supabase as any).from('notification_history').update({ is_read: true } as any).eq('notification_id', notifId);
        } catch (err: any) {
          console.error('[PushNotifications] mark notification read failed:', err);
        }
      } else if (actionId === 'reply' && (response as any).userText && (data as any)?.group_id && user) {
        const replyText = (response as any).userText;
        await (supabase as any).from('messages').insert({
          group_id: (data as any).group_id,
          sender_id: user.id,
          content: replyText,
        });
      } else if (actionId === 'remind_later') {
        // Schedule a local reminder for 1 hour later
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
      } else {
        // Default tap action — delegate to NotificationRouter for deterministic, gated routing
        NotificationRouter.handleTapResponse(response);
      }
    });

    async function syncDeliveredNotifications() {
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        for (const notif of presented) {
          const { title, body, data } = notif.request.content;
          const notifId = notif.request.identifier || Math.random().toString(36).substring(2);
          const dateStr = notif.date ? new Date(notif.date).toISOString() : new Date().toISOString();
          const notifType = (data?.type as string) || 'general';

          const cachedData = await cacheMediaForNotification(data);
          
          useNotificationStore.getState().addNotification({
            id: notifId,
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

          // Log telemetry
        }
      } catch {
        // silent
      }
    }

    return () => {
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
    };
  }, [user?.id]);

  async function saveTokenToDatabase(token: string) {
    if (!user) return;

    try {
      const { error } = await (supabase as any).from('user_push_tokens')
        .upsert(
          { user_id: user.id, push_token: token, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,push_token' }
        );

      if (error) throw error;
    } catch {
      // silent
    }
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

async function registerForPushNotificationsAsync() {
  let token;

  // Configure Interactive Categories in parallel — doesn't need to complete before token registration
  const categoriesPromise = configureNotificationCategories();

  if (Platform.OS === 'android') {
    // One-time cleanup of legacy channel — only attempt if it still exists
    try {
      const legacyChannel = await Notifications.getNotificationChannelAsync('default');
      if (legacyChannel) {
        await Notifications.deleteNotificationChannelAsync('default');
      }
    } catch {
      // silent
    }

    // High Priority (respect DND)
    await Notifications.setNotificationChannelAsync('urgent_alerts_v1', {
      name: 'Default Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#064e3b',
      bypassDnd: false, // Obey Do Not Disturb settings
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
      bypassDnd: true, // Bypasses Do Not Disturb
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
      showBadge: true,
    });

    // Low Priority Channel
    await Notifications.setNotificationChannelAsync('low_priority', {
      name: 'Silent Updates',
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
      sound: null,
      vibrationPattern: null,
    });
  }

  const isDevice = Constants.isDevice !== false;
  if (isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch {
      // silent
    }
  }

  // Await categories to ensure they're registered before the function returns
  await categoriesPromise;

  return token;
}
