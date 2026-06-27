import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
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

// Detect if running inside Expo Go.
// In Expo Go, push tokens belong to Expo's app (host.exp.exponent), not ours.
// We still allow notifications to work during testing, but we do NOT save
// the Expo Go token to the database — it would be invalid in production.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

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

      // Synchronize any notifications currently sitting in the system tray
      syncDeliveredNotifications();
    }

    // Fired when a notification is received while the app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      const { title, body, data } = notification.request.content;
      const notifId = notification.request.identifier || Math.random().toString(36).substring(2);
      const notifType = (data?.type as string) || 'general';
      
      useNotificationStore.getState().addNotification({
        id: notifId,
        type: notifType,
        title: title || 'New Notification',
        message: body || '',
        date: new Date().toISOString(),
        isRead: false,
        data: data,
      });

      if (data?.type) {
        upsertEntityFromNotification(data.type as string, data);
      }

      // Log telemetry
      logTelemetry(notifId, notifType, 'delivered');
    });

    // Fired when user taps a notification (foreground, background, or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const { title, body, data } = response.notification.request.content;
      const notifId = response.notification.request.identifier || Math.random().toString(36).substring(2);
      const notifType = (data?.type as string) || 'general';
      
      useNotificationStore.getState().addNotification({
        id: notifId,
        type: notifType,
        title: title || 'New Notification',
        message: body || '',
        date: response.notification.date ? new Date(response.notification.date).toISOString() : new Date().toISOString(),
        isRead: true,
        data: data,
      });

      if (data?.type) {
        upsertEntityFromNotification(data.type as string, data);
      }

      const actionId = response.actionIdentifier;

      // Handle Quick Actions
      if (actionId === 'mark_read') {
        useNotificationStore.getState().markAsRead(notifId);
        if (notifType === 'announcement' && data.id) {
          const { useAnnouncementStore } = require('../stores/announcement.store');
          useAnnouncementStore.getState().markAsRead(data.id);
        }
        logTelemetry(notifId, notifType, 'opened');
      } else if (actionId === 'reply' && (response as any).userText && data.group_id && user) {
        const replyText = (response as any).userText;
        (supabase as any).from('messages').insert({
          group_id: data.group_id,
          sender_id: user.id,
          content: replyText,
        }).then(({ error }: any) => {
          if (!error) {
            const { useGroupStore } = require('../stores/group.store');
            const group = useGroupStore.getState().groups.find((g: any) => g.id === data.group_id);
            const groupName = group?.name || 'Group Chat';
            const senderName = useAuthStore.getState().profile?.display_name || useAuthStore.getState().profile?.full_name || 'Member';
            const { sendChatMessageNotification } = require('../utils/notifications');
            sendChatMessageNotification(data.group_id, groupName, senderName, replyText, user.id);
          }
        });
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
          // silent — deep link navigation errors don't need user notification
        }
      }
    });

    async function syncDeliveredNotifications() {
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        presented.forEach(notif => {
          const { title, body, data } = notif.request.content;
          const notifId = notif.request.identifier || Math.random().toString(36).substring(2);
          const dateStr = notif.date ? new Date(notif.date).toISOString() : new Date().toISOString();
          const notifType = (data?.type as string) || 'general';
          
          useNotificationStore.getState().addNotification({
            id: notifId,
            type: notifType,
            title: title || 'New Notification',
            message: body || '',
            date: dateStr,
            isRead: false,
            data: data,
          });

          if (data?.type) {
            upsertEntityFromNotification(data.type as string, data);
          }

          // Log telemetry
          logTelemetry(notifId, notifType, 'delivered');
        });
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
      // Token saved successfully
    } catch {
      // silent — push token sync failure doesn't affect core functionality
    }
  }
}

async function configureNotificationCategories() {
  try {
    await Notifications.setNotificationCategoryAsync('chat_actions', [
      {
        identifier: 'reply',
        buttonTitleText: 'Reply',
        textInput: {
          submitButtonTitle: 'Send',
          placeholder: 'Type reply...',
        },
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'mark_read',
        buttonTitleText: 'Mark as Read',
        options: { opensAppToForeground: false },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('announcement_actions', [
      {
        identifier: 'open',
        buttonTitleText: 'Open',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'dismiss',
        buttonTitleText: 'Dismiss',
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('event_actions', [
      {
        identifier: 'join',
        buttonTitleText: 'Join',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'view',
        buttonTitleText: 'View Details',
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('quiz_actions', [
      {
        identifier: 'start_quiz',
        buttonTitleText: 'Start Quiz',
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync('material_actions', [
      {
        identifier: 'open',
        buttonTitleText: 'Open File',
        options: { opensAppToForeground: true },
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
    // High Priority
    await Notifications.setNotificationChannelAsync('default_v2', {
      name: 'Default Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#064e3b',
      bypassDnd: true,
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

  // Ensure we are on a physical device (expo-notifications limitation on simulators)
  // Note: We use Constants.isDevice or check the platform
  // Constants.isDevice was removed in newer Expo SDKs — treat undefined as true
  // so standalone builds still request tokens. Simulators will fail gracefully.
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
      // silent — push token fetch failure is non-critical
    }
  } else {
    // Simulator/emulator — push notifications not available
  }

  return token;
}
