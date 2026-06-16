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

  useEffect(() => {
    if (user) {
      registerForPushNotificationsAsync().then(token => {
        if (token && !IS_EXPO_GO) {
          // Only save token when running as a standalone/dev-client build.
          // Expo Go tokens are not valid for production FCM delivery.
          saveTokenToDatabase(token);
        }
      });

      // Synchronize any notifications currently sitting in the system tray
      syncDeliveredNotifications();
    }

    // Fired when a notification is received while the app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      const { title, body, data } = notification.request.content;
      const notifId = notification.request.identifier || Math.random().toString(36).substring(2);
      
      useNotificationStore.getState().addNotification({
        id: notifId,
        type: (data?.type as string) || 'general',
        title: title || 'New Notification',
        message: body || '',
        date: new Date().toISOString(),
        isRead: false,
        data: data,
      });

      if (data?.type) {
        upsertEntityFromNotification(data.type as string, data);
      }
    });

    // Fired when user taps a notification (foreground, background, or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const { title, body, data } = response.notification.request.content;
      const notifId = response.notification.request.identifier || Math.random().toString(36).substring(2);
      
      useNotificationStore.getState().addNotification({
        id: notifId,
        type: (data?.type as string) || 'general',
        title: title || 'New Notification',
        message: body || '',
        date: response.notification.date ? new Date(response.notification.date).toISOString() : new Date().toISOString(),
        isRead: true,
        data: data,
      });

      if (data?.type) {
        upsertEntityFromNotification(data.type as string, data);
      }

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
    });

    async function syncDeliveredNotifications() {
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        presented.forEach(notif => {
          const { title, body, data } = notif.request.content;
          const notifId = notif.request.identifier || Math.random().toString(36).substring(2);
          const dateStr = notif.date ? new Date(notif.date).toISOString() : new Date().toISOString();
          
          useNotificationStore.getState().addNotification({
            id: notifId,
            type: (data?.type as string) || 'general',
            title: title || 'New Notification',
            message: body || '',
            date: dateStr,
            isRead: false,
            data: data,
          });

          if (data?.type) {
            upsertEntityFromNotification(data.type as string, data);
          }
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
    };
  }, [user?.id]);

  async function saveTokenToDatabase(token: string) {
    if (!user) return;

    try {
      const { error } = await (supabase as any).from('users')
        .update({ push_token: token } as any)
        .eq('id', user.id);

      if (error) throw error;
      // Token saved successfully
    } catch {
      // silent — push token sync failure doesn't affect core functionality
    }
  }
}

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    try {
      await Notifications.deleteNotificationChannelAsync('default');
    } catch {
      // silent
    }
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
