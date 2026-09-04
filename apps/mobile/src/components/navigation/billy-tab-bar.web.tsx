import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BillyLogo } from '@/components/ui/billy-logo';
import { usesDesktopWebLayout } from '@/constants/web-layout';
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
  const { fontScale, width } = useWindowDimensions();
  const desktop = usesDesktopWebLayout(width, fontScale);

  function renderRoute(route: (typeof state.routes)[number], index: number) {
    const options = descriptors[route.key]?.options;
    const focused = state.index === index;
    const central = route.name === SERVICES_ROUTE;
    const label =
      typeof options?.tabBarLabel === 'string'
        ? options.tabBarLabel
        : (options?.title ?? route.name);
    const activeColor = theme.colors.brandDeep;
    const inactiveColor = desktop ? 'rgba(255,255,255,0.72)' : theme.colors.textMuted;
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
      navigation.emit({ target: route.key, type: 'tabLongPress' });
    };

    if (desktop) {
      return (
        <Pressable
          accessibilityHint={`Opens the ${label} section`}
          accessibilityLabel={options?.tabBarAccessibilityLabel ?? `${label} tab`}
          accessibilityRole="tab"
          accessibilityState={{ selected: focused }}
          key={route.key}
          onLongPress={onLongPress}
          onPress={onPress}
          style={({ pressed }) => [
            styles.desktopItem,
            focused && styles.desktopItemActive,
            pressed && styles.pressed,
          ]}
          testID={options?.tabBarButtonTestID}>
          {options?.tabBarIcon?.({ color, focused, size: 19 })}
          <Text
            numberOfLines={1}
            style={[
              styles.desktopLabel,
              { color },
              focused && styles.desktopLabelActive,
            ]}>
            {label}
          </Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        accessibilityHint={`Opens the ${label} section`}
        accessibilityLabel={options?.tabBarAccessibilityLabel ?? `${label} tab`}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        key={route.key}
        onLongPress={onLongPress}
        onPress={onPress}
        style={({ pressed }) => [
          styles.mobileItem,
          central && styles.centralItem,
          pressed && styles.pressed,
        ]}
        testID={options?.tabBarButtonTestID}>
        {central ? (
          <>
            <View style={[styles.launcherRing, { backgroundColor: theme.colors.surfaceRaised }]}>
              <View
                style={[
                  styles.launcher,
                  {
                    backgroundColor: focused ? theme.colors.accent : theme.colors.brand,
                    borderColor: focused ? theme.colors.white : theme.colors.accent,
                  },
                ]}>
                <Ionicons
                  accessible={false}
                  color={focused ? theme.colors.brandDeep : theme.colors.white}
                  name={focused ? 'grid' : 'grid-outline'}
                  size={25}
                />
              </View>
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.centralLabel,
                { color: focused ? theme.colors.accent : theme.colors.textMuted },
              ]}>
              {label}
            </Text>
          </>
        ) : (
          <>
            <View
              style={[
                styles.iconWell,
                focused && { backgroundColor: theme.colors.surfaceMuted },
              ]}>
              {options?.tabBarIcon?.({
                color: focused ? theme.colors.accent : theme.colors.textMuted,
                focused,
                size: 22,
              })}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.mobileLabel,
                { color: focused ? theme.colors.accent : theme.colors.textMuted },
                focused && styles.mobileLabelActive,
              ]}>
              {label}
            </Text>
          </>
        )}
      </Pressable>
    );
  }

  if (desktop) {
    return (
      <View
        accessibilityLabel="Primary navigation"
        accessibilityRole="tablist"
        style={styles.desktopWrap}>
        <View style={styles.desktopBar}>
          <Pressable
            accessibilityLabel="Billy home"
            accessibilityRole="button"
            onPress={() => navigation.navigate('home')}
            style={({ pressed }) => [
              styles.brand,
              pressed && styles.brandInteractive,
            ]}>
            <BillyLogo variant="wordmark" size={92} />
          </Pressable>
          <View style={styles.desktopItems}>
            {state.routes.map(renderRoute)}
          </View>
          <View style={styles.securePill}>
            <Ionicons
              accessible={false}
              color="#B8F3CF"
              name="shield-checkmark"
              size={15}
            />
            <Text style={styles.secureText}>Protected</Text>
          </View>
        </View>
      </View>
    );
  }

  const safeBottom = Math.max(insets.bottom, spacing.xs);
  return (
    <View
      accessibilityLabel="Primary navigation"
      accessibilityRole="tablist"
      style={[
        styles.mobileWrap,
        {
          backgroundColor: theme.colors.canvas,
          paddingBottom: safeBottom,
          pointerEvents: 'box-none',
        },
      ]}>
      <View
        style={[
          styles.mobileBar,
          {
            backgroundColor: theme.colors.surfaceRaised,
            borderColor: 'rgba(133, 227, 173, 0.2)',
          },
        ]}>
        {state.routes.map(renderRoute)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 44,
    justifyContent: 'center',
    width: 112,
  },
  brandInteractive: {
    backgroundColor: 'rgba(255,255,255,0.07)',
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
  desktopBar: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#0B4829',
    borderColor: 'rgba(184,243,207,0.18)',
    borderRadius: radii.xl,
    borderWidth: 1,
    boxShadow: '0 18px 54px rgba(3, 34, 19, 0.22)',
    flexDirection: 'row',
    gap: spacing.lg,
    height: 68,
    maxWidth: 1180,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  desktopItem: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  desktopItemActive: {
    backgroundColor: '#B8F3CF',
  },
  desktopItems: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  desktopLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
  },
  desktopLabelActive: {
    fontWeight: '800',
  },
  desktopWrap: {
    left: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  iconWell: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 31,
    justifyContent: 'center',
    width: 39,
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
  mobileBar: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.26)',
    flexDirection: 'row',
    height: layout.bottomTabBarHeight,
    maxWidth: 640,
    paddingHorizontal: spacing.xxs,
    width: '100%',
  },
  mobileItem: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 0,
  },
  mobileLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '700',
    maxWidth: '100%',
  },
  mobileLabelActive: {
    fontWeight: '800',
  },
  mobileWrap: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    width: '100%',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  securePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(184,243,207,0.1)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  secureText: {
    color: '#D8F9E5',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
});
