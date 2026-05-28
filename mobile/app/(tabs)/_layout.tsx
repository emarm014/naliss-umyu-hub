import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useTheme } from '../../src/stores/theme.store';
import { trackScreen } from '../../src/utils/sentry';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Smart safe area buffer for Android:
  // - Gesture nav (insets.bottom ~15-40): Add 8px buffer to avoid accidental swipe gestures.
  // - 3-Button nav (insets.bottom > 40): No buffer needed, avoid wasting screen space.
  // - Legacy / Non-translucent (insets.bottom = 0): No buffer needed.
  let androidBottomBuffer = 0;
  if (Platform.OS === 'android') {
    if (insets.bottom > 0 && insets.bottom < 40) {
      androidBottomBuffer = 8;
    }
  }

  return (
    <Tabs
      screenListeners={{
        focus: (e) => {
          trackScreen(e.target?.split('-')[0] ?? 'unknown_tab');
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        
        // Let React Navigation natively handle the bottom safe area
        safeAreaInsets: {
          bottom: insets.bottom + androidBottomBuffer,
        },
        
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          minHeight: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'android' ? 6 : 4,
          elevation: 12,
          shadowColor: isDark ? '#000' : '#1B5E20',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: isDark ? 0.4 : 0.08,
          shadowRadius: 12,
        },
        tabBarItemStyle: {
          // paddingVertical ensures items stay centered within their expanded hit-box
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter-SemiBold',
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'HOME',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'UPDATES',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'megaphone' : 'megaphone-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
            href: null,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'CHAT',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="resources"
        options={{
          title: 'RESOURCES',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'folder' : 'folder-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="directory"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
