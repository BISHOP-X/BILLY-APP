import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Platform, type ColorValue, useWindowDimensions } from 'react-native';

import { BillyTabBar } from '@/components/navigation/billy-tab-bar';
import { usesDesktopWebLayout, WEB_NAV_HEIGHT } from '@/constants/web-layout';
import type { AppIconName } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';

function tabIcon(
  focused: boolean,
  color: ColorValue,
  selected: AppIconName,
  unselected: AppIconName,
  size: number,
) {
  return (
    <Ionicons
      accessible={false}
      color={color}
      name={focused ? selected : unselected}
      size={size}
    />
  );
}

export default function MainTabsLayout() {
  const theme = useBillyTheme();
  const { fontScale, width } = useWindowDimensions();
  const desktopWeb =
    Platform.OS === 'web' && usesDesktopWebLayout(width, fontScale);

  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <BillyTabBar {...props} />}
      screenOptions={{
        animation: 'fade',
        headerShown: false,
        sceneStyle: {
          backgroundColor: theme.colors.canvas,
          paddingTop: desktopWeb ? WEB_NAV_HEIGHT : 0,
        },
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen
        name="home"
        options={{
          tabBarAccessibilityLabel: 'Home tab',
          tabBarIcon: ({ color, focused, size }) =>
            tabIcon(focused, color, 'home', 'home-outline', size),
          title: 'Home',
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          tabBarAccessibilityLabel: 'Activity tab',
          tabBarIcon: ({ color, focused, size }) =>
            tabIcon(focused, color, 'receipt', 'receipt-outline', size),
          title: 'Activity',
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          tabBarAccessibilityLabel: 'Services tab',
          tabBarIcon: ({ color, focused, size }) =>
            tabIcon(focused, color, 'grid', 'grid-outline', size),
          title: 'Services',
        }}
      />
      <Tabs.Screen
        name="cards"
        options={{
          tabBarAccessibilityLabel: 'Cards tab',
          tabBarIcon: ({ color, focused, size }) =>
            tabIcon(focused, color, 'card', 'card-outline', size),
          title: 'Cards',
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          tabBarAccessibilityLabel: 'Account tab',
          tabBarIcon: ({ color, focused, size }) =>
            tabIcon(
              focused,
              color,
              'person-circle',
              'person-circle-outline',
              size,
            ),
          title: 'Account',
        }}
      />
    </Tabs>
  );
}
