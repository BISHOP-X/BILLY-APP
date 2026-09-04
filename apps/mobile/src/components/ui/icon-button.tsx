import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AppIconName } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii } from '@/theme/tokens';

import { ScalePressable } from './motion';

type IconButtonBaseProps = {
  accessibilityLabel: string;
  badge?: ReactNode;
  onPress: () => void;
  testID?: string;
};

type IconButtonProps = IconButtonBaseProps &
  (
    | {
        icon: AppIconName;
        content?: never;
      }
    | {
        icon?: never;
        content: ReactNode;
      }
  );

export function IconButton({
  accessibilityLabel,
  badge,
  content,
  icon,
  onPress,
  testID,
}: IconButtonProps) {
  const theme = useBillyTheme();

  return (
    <ScalePressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      testID={testID}>
      {content ??
        (icon ? (
          <Ionicons
            accessible={false}
            color={theme.colors.text}
            name={icon}
            size={22}
          />
        ) : null)}
      {badge ? <View style={styles.badge}>{badge}</View> : null}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
});
