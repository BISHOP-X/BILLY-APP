import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { layout, radii, spacing, typography } from '@/theme/tokens';

const SERVICES_ROUTE = 'services';

export function BillyTabBar({
  descriptors,
  insets,
  navigation,
  state,
}: BottomTabBarProps) {
  const theme = useBillyTheme();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (keyboardVisible) return null;

  const barBackground = theme.dark ? theme.colors.surfaceRaised : '#F7F9EF';
  const activeColor = theme.dark ? theme.colors.accent : theme.colors.brandDeep;
  const inactiveColor = theme.colors.textMuted;
  const safeBottom = Math.max(insets.bottom, spacing.xs);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.safeWrap,
        {
          backgroundColor: theme.colors.canvas,
          paddingBottom: safeBottom,
        },
      ]}>
      <View
        accessibilityLabel={
          Platform.OS === 'web' ? 'Primary navigation' : undefined
        }
        accessibilityRole={Platform.OS === 'web' ? 'tablist' : undefined}
        style={[
          styles.bar,
          styles.floatingShadow,
          {
            backgroundColor: barBackground,
            borderColor: theme.dark
              ? 'rgba(184, 243, 207, 0.18)'
              : 'rgba(20, 98, 55, 0.13)',
          },
        ]}>
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          const focused = state.index === index;
          const central = route.name === SERVICES_ROUTE;
          const label =
            typeof options?.tabBarLabel === 'string'
              ? options.tabBarLabel
              : (options?.title ?? route.name);
          const color = focused ? activeColor : inactiveColor;

          const onPress = () => {
            const event = navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: 'tabPress',
            });

            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              target: route.key,
              type: 'tabLongPress',
            });
          };

          return (
            <Pressable
              accessibilityHint={`Opens the ${label} section`}
              accessibilityLabel={
                options?.tabBarAccessibilityLabel ?? `${label} tab`
              }
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onLongPress={onLongPress}
              onPress={onPress}
              style={({ pressed }) => [
                styles.item,
                central && styles.centralItem,
                pressed && styles.pressed,
              ]}
              testID={options?.tabBarButtonTestID}>
              {central ? (
                <>
                  <View
                    style={[
                      styles.launcherRing,
                      { backgroundColor: barBackground },
                    ]}>
                    <View
                      style={[
                        styles.launcher,
                        {
                          backgroundColor: focused
                            ? theme.colors.accent
                            : theme.colors.brand,
                          borderColor: focused
                            ? theme.colors.white
                            : theme.colors.accent,
                        },
                      ]}>
                      <Ionicons
                        accessible={false}
                        color={
                          focused
                            ? theme.colors.brandDeep
                            : theme.colors.white
                        }
                        name={focused ? 'grid' : 'grid-outline'}
                        size={25}
                      />
                    </View>
                  </View>
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={[
                      styles.centralLabel,
                      { color: focused ? activeColor : inactiveColor },
                    ]}>
                    {label}
                  </Text>
                </>
              ) : (
                <>
                  <View
                    style={[
                      styles.iconWell,
                      focused && {
                        backgroundColor: theme.dark
                          ? theme.colors.surfaceMuted
                          : theme.colors.brandMist,
                      },
                    ]}>
                    {options?.tabBarIcon?.({
                      color,
                      focused,
                      size: 22,
                    })}
                  </View>
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={[
                      styles.label,
                      { color },
                      focused && styles.focusedLabel,
                    ]}>
                    {label}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    height: layout.bottomTabBarHeight,
    maxWidth: 640,
    paddingHorizontal: spacing.xxs,
    width: '100%',
  },
  centralItem: {
    overflow: 'visible',
  },
  centralLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    marginTop: -13,
    maxWidth: '100%',
  },
  focusedLabel: {
    fontWeight: '800',
  },
  floatingShadow: Platform.select({
    web: {
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.26)',
    },
    default: {
      elevation: 12,
      shadowColor: '#000000',
      shadowOffset: { height: 10, width: 0 },
      shadowOpacity: 0.28,
      shadowRadius: 18,
    },
  }),
  iconWell: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 31,
    justifyContent: 'center',
    width: 39,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 0,
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '700',
    maxWidth: '100%',
  },
  launcher: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  launcherRing: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 64,
    justifyContent: 'center',
    transform: [{ translateY: -15 }],
    width: 64,
  },
  pressed: {
    opacity: 0.68,
    transform: [{ scale: 0.96 }],
  },
  safeWrap: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    width: '100%',
  },
});
