import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {  Text, View } from 'react-native';
import { useTheme } from '../../src/stores/theme.store';
import { trackScreen } from '../../src/utils/sentry';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGroupStore } from '../../src/stores/group.store';

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  
  // Calculate the absolute baseline safety threshold for the device's navigation style
  const safeBottomOffset = insets.bottom > 0 ? insets.bottom : 12;

  const groups = useGroupStore((state) => state.groups);
  const isBadgeCleared = useGroupStore((state) => state.isBadgeCleared);
  const currentTab = useGroupStore((state) => state.currentTab);

  const unreadGroupsCount = groups.filter((g: any) => g.unread_count > 0).length;
  const showBadge = !isBadgeCleared && unreadGroupsCount > 0 && currentTab !== 'messages';
  const badgeValue = showBadge ? unreadGroupsCount : undefined;

  const TabsComponent = Tabs as any;

  const renderTabIcon = (iconName: string, outlineName: string) => ({ color, focused }: { color: string; focused: boolean }) => (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: focused ? (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)') : 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <Ionicons name={(focused ? iconName : outlineName) as any} size={26} color={color} />
    </View>
  );

  return (
    <TabsComponent
      screenListeners={{
        focus: (e: any) => {
          const tabName = e.target?.split('-')[0] ?? 'unknown_tab';
          trackScreen(tabName);
          useGroupStore.getState().setCurrentTab(tabName);
        },
      }}
      sceneContainerStyle={{
        backgroundColor: colors.background,
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? '#2ea6ff' : colors.primary,
        tabBarInactiveTintColor: isDark ? '#64748b' : colors.textMuted,
        
        tabBarStyle: {
          height: 60 + safeBottomOffset,
          paddingBottom: safeBottomOffset,
          paddingTop: 8,
          backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: isDark ? '#334155' : '#E2E8F0',
          elevation: 8,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
        },
        tabBarItemStyle: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: renderTabIcon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          tabBarIcon: renderTabIcon('megaphone', 'megaphone-outline'),
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
          tabBarBadge: badgeValue,
          tabBarIcon: renderTabIcon('chatbubble-ellipses', 'chatbubble-ellipses-outline'),
        }}
      />
      <Tabs.Screen
        name="resources"
        options={{
          tabBarIcon: renderTabIcon('folder', 'folder-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: renderTabIcon('person', 'person-outline'),
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
    </TabsComponent>
  );
}
