import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type ScreenHeaderProps = {
  backLabel?: string;
  onBack?: () => void;
  subtitle?: string;
  title: string;
};

export function ScreenHeader({
  backLabel = 'Go back',
  onBack,
  subtitle,
  title,
}: ScreenHeaderProps) {
  const theme = useBillyTheme();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={backLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack ?? (() => router.back())}
        style={({ pressed }) => [
          styles.back,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.65 : 1,
          },
        ]}>
        <Ionicons accessible={false} color={theme.colors.text} name="chevron-back" size={22} />
      </Pressable>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={[styles.subtitle, { color: theme.colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.placeholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 58,
  },
  copy: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
  },
  placeholder: {
    height: 44,
    width: 44,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 11,
    textAlign: 'center',
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
});
