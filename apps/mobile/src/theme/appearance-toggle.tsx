import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { useAppearance } from './appearance-provider';

/** A compact, keyboard-accessible day/night switch. System mode remains in Account. */
export function AppearanceToggle() {
  const theme = useBillyTheme();
  const { setPreference } = useAppearance();
  const reducedMotion = useReducedMotion();
  const [position] = useState(() => new Animated.Value(theme.dark ? 1 : 0));
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: theme.dark ? 1 : 0,
      duration: reducedMotion ? 0 : 280,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [position, reducedMotion, theme.dark]);

  return (
    <Pressable
      accessibilityRole='switch'
      accessibilityLabel='Dark mode'
      accessibilityHint='Switch between day and night appearance'
      accessibilityState={{ checked: theme.dark }}
      onPress={() => {
        setPreference(theme.dark ? 'light' : 'dark');
        if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
      }}
      style={styles.touchTarget}
      testID='appearance-toggle'
    >
      <View
        style={[styles.track, {
          backgroundColor: theme.dark ? '#1D2943' : '#E2EDF4',
          borderColor: theme.dark ? '#3A4866' : '#CBDCE8',
        }]}
      >
        <Ionicons
          name='sunny'
          size={16}
          color={theme.dark ? '#8291AE' : '#9B650C'}
          style={styles.sun}
        />
        <View style={styles.stars} pointerEvents='none'>
          <View style={styles.star} />
          <View style={[styles.star, { marginLeft: 5, marginTop: 4 }]} />
        </View>
        <Ionicons
          name='moon'
          size={15}
          color={theme.dark ? '#C8D7FC' : '#778A9D'}
          style={styles.moon}
        />
        <Animated.View
          style={[styles.thumb, {
            backgroundColor: theme.dark ? '#DDE8FF' : '#FFFFFF',
            transform: [{
              translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }),
            }],
          }]}
        >
          <Animated.View
            style={{
              transform: [{
                rotate: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '-20deg'],
                }),
              }],
            }}
          >
            <Ionicons
              name={theme.dark ? 'moon' : 'sunny'}
              size={19}
              color={theme.dark ? '#364C7B' : '#C38112'}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchTarget: {
    minHeight: 44,
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  track: {
    width: 68,
    height: 36,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    left: 3,
    width: 28,
    height: 28,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#12203A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 2,
  },
  sun: { position: 'absolute', left: 9 },
  moon: { position: 'absolute', right: 9 },
  stars: { position: 'absolute', left: 22, top: 7 },
  star: { width: 2, height: 2, backgroundColor: '#A9BDDA', borderRadius: 1 },
});
