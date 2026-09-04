import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { billyDataSource, billyDemoScenario } from '@/features/main/repository';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export function DemoDataBanner() {
  const theme = useBillyTheme();
  if (billyDataSource !== 'demo') return null;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        {
          backgroundColor: `${theme.colors.warning}18`,
          borderColor: `${theme.colors.warning}44`,
        },
      ]}>
      <Ionicons accessible={false} color={theme.colors.warning} name="flask" size={17} />
      <Text style={[styles.text, { color: theme.colors.text }]}>
        Demo data · {billyDemoScenario.replace('-', ' ')} · no live transaction
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    textTransform: 'capitalize',
  },
});
