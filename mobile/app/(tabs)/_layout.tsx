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
  
  // Calculate the absolute baseline safety threshold for the device's navigation style
  const safeBottomOffset = insets.bottom > 0 ? insets.bottom : 12;
  const safeTopOffset = insets.top > 0 ? insets.top : 24;

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
      allowFontScaling={false}
      style={{
        color,
        fontSize: 10,
        fontWeight: '600',
        fontFamily: 'Inter-SemiBold',
        textAlign: 'center',
        letterSpacing: -0.2,
        marginTop: 2,
        width: '100%',
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
        paddingBottom: safeBottomOffset + 76,
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? '#2ea6ff' : colors.primary,
        tabBarInactiveTintColor: isDark ? '#64748b' : colors.textMuted,
        
        tabBarStyle: {
          position: 'absolute',
          bottom: safeBottomOffset,
          left: 16,
          right: 16,
          height: 64,
          borderRadius: 16,
          backgroundColor: '#FFFFFF',
          elevation: 8,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 10,
          borderTopWidth: 0,
        },
        tabBarItemStyle: {
          flex: 1,
          marginVertical: 8,
          paddingHorizontal: 10,
          paddingVertical: 4,
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: 'Inter-SemiBold',
          letterSpacing: -0.2, // Gives micro-clearance to long words
          width: '100%',       // Guaranteed to prevent truncation like RESOUR...
        },
        tabBarShowLabel: true,
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
