import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {  Text, View } from 'react-native';
import { useTheme } from '../../src/stores/theme.store';
import { trackScreen } from '../../src/utils/sentry';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGroupStore } from '../../src/stores/group.store';
import { useAuthStore } from '../../src/stores/auth.store';

export default function TabsLayout() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // ALL hooks must run before any conditional return — React Rules of Hooks.
  const session = useAuthStore(s => s.session);
  const safeBottomOffset = insets.bottom > 0 ? insets.bottom : 12;
  const groups = useGroupStore((state) => state.groups);
  const isBadgeCleared = useGroupStore((state) => state.isBadgeCleared);
  const currentTab = useGroupStore((state) => state.currentTab);

  // SAFETY GUARD: If there's no session, redirect to login immediately.
  // This prevents all tab screens from rendering and making Supabase calls
  // with an expired/missing token, which causes the app to crash.
  if (!session) {
    return <Redirect href="/auth/login" />;
  }

  const unreadGroupsCount = groups.filter((g: any) => g.unread_count > 0).length;
  const showBadge = !isBadgeCleared && unreadGroupsCount > 0 && currentTab !== 'messages';
  const badgeValue = showBadge ? unreadGroupsCount : undefined;

  const TabsComponent = Tabs as any;

  const renderTabIcon = (iconName: string, outlineName: string) => ({ color, focused }: { color: string; focused: boolean }) => (
    <View
      style={{
        width: 52,
        height: 32,
        borderRadius: 16,
        backgroundColor: focused ? (isDark ? colors.actionMint : 'rgba(0, 0, 0, 0.05)') : 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 2,
      }}
    >
      <Ionicons name={(focused ? iconName : outlineName) as any} size={24} color={color} />
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
        tabBarActiveTintColor: isDark ? colors.primary : colors.text,
        tabBarInactiveTintColor: isDark ? '#64748b' : colors.textMuted,
        
        tabBarStyle: {
          height: 60 + safeBottomOffset,
          paddingBottom: safeBottomOffset + 4,
          paddingTop: 4,
          backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: isDark ? '#334155' : '#E2E8F0',
          elevation: isDark ? 0 : 8,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: isDark ? 0 : 0.05,
          shadowRadius: 8,
        },
        tabBarItemStyle: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: 'Inter-Medium',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: renderTabIcon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          tabBarLabel: 'Updates',
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
          tabBarLabel: 'Chat',
          tabBarBadge: badgeValue,
          tabBarIcon: renderTabIcon('chatbubble-ellipses', 'chatbubble-ellipses-outline'),
        }}
      />
      <Tabs.Screen
        name="resources"
        options={{
          tabBarLabel: 'Library',
          tabBarIcon: renderTabIcon('folder', 'folder-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: 'Profile',
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
