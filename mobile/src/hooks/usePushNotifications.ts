import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../api/supabase/client';
import { useAuthStore } from '../stores/auth.store';
import { useNotificationStore } from '../stores/notification.store';
import { upsertEntityFromNotification } from '../utils/notifications';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
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
        .eq('user_id', userId)
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
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

const IS_EXPO_GO = Constants.appOwnership === 'expo';

// Local Rich Media Cache Helper
async function cacheMediaForNotification(data: any): Promise<any> {
  const imageUrl = data?.cover_image_url || data?.file_url || data?.image_url || data?.avatar_url || null;
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) return data;
  try {
    const filename = imageUrl.split('/').pop()?.split('?')[0] || 'cached_image';
    const localUri = `${FileSystem.documentDirectory}${filename}`;
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists) {
      await FileSystem.downloadAsync(imageUrl, localUri);
    }
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

    if (user) {
      registerForPushNotificationsAsync().then(token => {
        if (token && !IS_EXPO_GO) {
          saveTokenToDatabase(token);
        }
      });

      // Token Rotation listener
      tokenListener = Notifications.addPushTokenListener(async (tokenObj) => {
        const token = tokenObj.data;
        if (token && !IS_EXPO_GO) {
          await saveTokenToDatabase(token);
        }
      });

      // Sync history and delivered tray
      syncNotificationHistory();
      syncDeliveredNotifications();

      // Register background fetch
      BackgroundFetch.getStatusAsync().then(status => {
        if (status === BackgroundFetch.BackgroundFetchStatus.Available) {
          BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
            minimumInterval: 15 * 60,
            stopOnTerminate: false,
            startOnBoot: true,
          }).catch(() => {});
        }
      });
    }

    // Fired when a notification is received while the app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(async (notification) => {
      const { title, body, data } = notification.request.content;
      const notifId = notification.request.identifier || Math.random().toString(36).substring(2);
      const notifType = (data?.type as string) || 'general';

      // Silent Sync pushes wake application and trigger reloading
      if (notifType === 'silent_sync' || data?.is_silent === 'true' || data?.is_silent === true) {
        if (data?.sync_target === 'messages' && data?.group_id) {
          // Future expansion: trigger messages reload
        }
        return;
      }
      
      const cachedData = await cacheMediaForNotification(data);

      useNotificationStore.getState().addNotification({
        id: notifId,
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
      logTelemetry(notifId, notifType, 'delivered');
    });

    // Fired when user taps a notification (foreground, background, or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const { title, body, data } = response.notification.request.content;
      const notifId = response.notification.request.identifier || Math.random().toString(36).substring(2);
      const notifType = (data?.type as string) || 'general';
      
      const cachedData = await cacheMediaForNotification(data);

      useNotificationStore.getState().addNotification({
        id: notifId,
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
        await supabase.from('notification_history').update({ is_read: true }).eq('notification_id', notifId).catch(() => {});
        logTelemetry(notifId, notifType, 'opened');
      } else if (actionId === 'reply' && (response as any).userText && (data as any)?.group_id && user) {
        const replyText = (response as any).userText;
        await supabase.from('messages').insert({
          group_id: (data as any).group_id,
          sender_id: user.id,
          content: replyText,
        });
        logTelemetry(notifId, notifType, 'opened');
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
        logTelemetry(notifId, notifType, 'dismissed');
      } else if (actionId === 'download' && (data as any)?.file_url) {
        try {
          const fileUrl = (data as any).file_url;
          const filename = typeof fileUrl === 'string' ? fileUrl.split('/').pop() || 'downloaded_file' : 'downloaded_file';
          const localUri = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.downloadAsync(fileUrl, localUri);
        } catch {
          // silent
        }
        logTelemetry(notifId, notifType, 'opened');
      } else if (actionId === 'dismiss') {
        logTelemetry(notifId, notifType, 'dismissed');
      } else {
        // Default tap action
        logTelemetry(notifId, notifType, 'opened');

        // Deep link to the relevant screen based on notification type
        if (!data?.type) return;

        try {
          switch (data.type) {
            case 'announcement':
              if (data.id) {
                router.push(`/announcement/${data.id}` as any);
              } else {
                router.push('/(tabs)/announcements' as any);
              }
              break;
            case 'event':
              if (data.id) {
                router.push(`/event/${data.id}` as any);
              } else {
                router.push('/(tabs)/announcements' as any);
              }
              break;
            case 'material':
              router.push('/(tabs)/resources' as any);
              break;
            case 'message':
              if (data.group_id) {
                router.push(`/chat/${data.group_id}` as any);
              } else {
                router.push('/(tabs)/messages' as any);
              }
              break;
            default:
              router.push('/(tabs)' as any);
          }
        } catch {
          // silent
        }
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
          logTelemetry(notifId, notifType, 'delivered');
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
    };
  }, [user?.id]);

  async function saveTokenToDatabase(token: string) {
    if (!user) return;

    try {
      const { error } = await (supabase as any).from('user_push_tokens')
        .upsert({ user_id: user.id, push_token: token, updated_at: new Date().toISOString() });

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

  // Configure Interactive Categories
  await configureNotificationCategories();

  if (Platform.OS === 'android') {
    try {
      await Notifications.deleteNotificationChannelAsync('default');
    } catch {
      // silent
    }

    // High Priority (respect DND)
    await Notifications.setNotificationChannelAsync('default_v2', {
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

  return token;
}
