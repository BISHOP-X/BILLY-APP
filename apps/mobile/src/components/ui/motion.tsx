import { PropsWithChildren, ReactNode, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

import { motion } from '@/theme/tokens';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

type FadeSlideProps = PropsWithChildren<{
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}>;

export function FadeSlide({ children, delay = 0, distance = 18, style }: FadeSlideProps) {
  const reducedMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(distance));

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.relaxed,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.relaxed,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [delay, distance, opacity, reducedMotion, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

type ScalePressableProps = Omit<PressableProps, 'children' | 'style'> & {
  children?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  pressedScale?: number;
};

export function ScalePressable({
  children,
  containerStyle,
  onPressIn,
  onPressOut,
  pressedScale = 0.975,
  style,
  ...props
}: ScalePressableProps) {
  const reducedMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  function animate(toValue: number) {
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, {
      toValue,
      damping: 18,
      mass: 0.65,
      stiffness: 260,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }

  return (
    <Pressable
      {...props}
      style={containerStyle}
      onPressIn={(event) => {
        animate(pressedScale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        onPressOut?.(event);
      }}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
