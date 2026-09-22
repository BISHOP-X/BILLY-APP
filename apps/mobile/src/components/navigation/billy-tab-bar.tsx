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
import { layout, spacing, typography } from '@/theme/tokens';

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
          backgroundColor: 'transparent',
          paddingBottom: safeBottom,
        },
      ]}
    >
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
        ]}
      >
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          const focused = state.index === index;
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
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              testID={options?.tabBarButtonTestID}
            >
              <View
                style={[
                  styles.iconWell,
                  focused && { backgroundColor: theme.colors.brandMist },
                ]}
              >
                {options?.tabBarIcon?.({ color, focused, size: 22 })}
              </View>
              <Text
                allowFontScaling
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={[
                  styles.label,
                  { color },
                  focused && { fontWeight: '700' },
                ]}
              >
                {label}
              </Text>
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
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    height: layout.bottomTabBarHeight,
    maxWidth: 640,
    paddingHorizontal: spacing.xxs,
    width: '100%',
  },
  floatingShadow: Platform.select({
    web: {
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    },
    default: {
      elevation: 3,
      shadowColor: '#000000',
      shadowOffset: { height: 3, width: 0 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
    },
  }),
  iconWell: {
    alignItems: 'center',
    borderRadius: 12,
    height: 32,
    justifyContent: 'center',
    width: 42,
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
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '500',
    maxWidth: '100%',
  },
  pressed: {
    opacity: 0.68,
    transform: [{ scale: 0.96 }],
  },
  safeWrap: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    width: '100%',
  },
});
