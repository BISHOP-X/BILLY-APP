import { StyleSheet, Text, View } from 'react-native';

import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

const labels = ['Details', 'Review', 'Confirm', 'Status'];

export function BillStepper({ step }: { step: number }) {
  const theme = useBillyTheme();

  return (
    <View
      accessibilityLabel={`Step ${step + 1} of ${labels.length}, ${labels[step]}`}
      style={styles.wrapper}>
      <View style={styles.track}>
        {labels.map((label, index) => (
          <View key={label} style={styles.segmentWrap}>
            <View
              style={[
                styles.segment,
                {
                  backgroundColor:
                    index <= step
                      ? theme.colors.brand
                      : theme.colors.surfaceMuted,
                },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  color:
                    index === step
                      ? theme.colors.text
                      : theme.colors.textSoft,
                },
              ]}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  segment: {
    borderRadius: radii.pill,
    height: 4,
    width: '100%',
  },
  segmentWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  track: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  wrapper: {
    gap: spacing.xs,
  },
});
