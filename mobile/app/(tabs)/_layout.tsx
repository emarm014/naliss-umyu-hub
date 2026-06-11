import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Text, View } from 'react-native';
import { useTheme } from '../../src/stores/theme.store';
import { trackScreen } from '../../src/utils/sentry';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGroupStore } from '../../src/stores/group.store';

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

  const groups = useGroupStore((state) => state.groups);
  const isBadgeCleared = useGroupStore((state) => state.isBadgeCleared);
  const currentTab = useGroupStore((state) => state.currentTab);

  const unreadGroupsCount = groups.filter((g: any) => g.unread_count > 0).length;
  const showBadge = !isBadgeCleared && unreadGroupsCount > 0 && currentTab !== 'messages';
  const badgeValue = showBadge ? unreadGroupsCount : undefined;

  const TabsComponent = Tabs as any;

  const renderTabLabel = (text: string) => ({ color, focused }: { color: string; focused: boolean }) => (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit={true}
      minimumFontScale={0.8}
      style={{
        color,
        fontSize: 10,
        fontWeight: focused ? '600' : '400',
        fontFamily: 'Inter-SemiBold',
        textAlign: 'center',
        letterSpacing: -0.2, // Slightly squeezes letters to fit within boundary
        marginTop: 2,
      }}
    >
      {text}
    </Text>
  );

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
        paddingBottom: Platform.OS === 'ios' ? (insets.bottom > 0 ? 104 : 88) : 88,
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? '#2ea6ff' : colors.primary,
        tabBarInactiveTintColor: isDark ? '#64748b' : colors.textMuted,
        
        tabBarStyle: {
          position: 'absolute',
          bottom: Platform.OS === 'ios' ? (insets.bottom > 0 ? insets.bottom - 4 : 12) : 12,
          left: 16,
          right: 16,
          height: 72,
          borderRadius: 36,
          backgroundColor: isDark ? '#131f28' : '#ffffff',
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.4 : 0.12,
          shadowRadius: 8,
          borderWidth: 1,
          borderColor: isDark ? '#1c2d3a' : '#e2e8f0',
          paddingBottom: 0,
          paddingTop: 0,
        },
        tabBarItemStyle: {
          marginVertical: 8,
          marginHorizontal: 6,
          paddingVertical: 4,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter-SemiBold',
          fontSize: 10,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: renderTabLabel('HOME'),
          tabBarIcon: renderTabIcon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          tabBarLabel: renderTabLabel('UPDATES'),
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
          tabBarLabel: renderTabLabel('CHAT'),
          tabBarBadge: badgeValue,
          tabBarIcon: renderTabIcon('chatbubble-ellipses', 'chatbubble-ellipses-outline'),
        }}
      />
      <Tabs.Screen
        name="resources"
        options={{
          tabBarIcon: renderTabIcon('folder', 'folder-outline'),
          tabBarLabel: renderTabLabel('RESOURCES'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: renderTabLabel('PROFILE'),
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
