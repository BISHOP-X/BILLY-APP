import Ionicons from '@expo/vector-icons/Ionicons';
import { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeSlide } from '@/components/ui/motion';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type SetupShellProps = PropsWithChildren<{
  step: number;
  totalSteps?: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  onBack?: () => void;
  footer?: ReactNode;
}>;

export function SetupShell({
  children,
  step,
  totalSteps = 3,
  eyebrow,
  title,
  subtitle,
  onBack,
  footer,
}: SetupShellProps) {
  const theme = useBillyTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            {onBack ? (
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={10}
                onPress={onBack}
                style={[styles.backButton, { backgroundColor: theme.colors.surface }]}>
                <Ionicons color={theme.colors.text} name="chevron-back" size={22} />
              </Pressable>
            ) : (
              <View style={styles.backButton} />
            )}
            <Text style={[styles.stepLabel, { color: theme.colors.textMuted }]}>
              Step {step} of {totalSteps}
            </Text>
          </View>

          <View style={styles.progressTrack}>
            {Array.from({ length: totalSteps }).map((_, index) => (
              <View
                key={index}
                style={[
                  styles.progressSegment,
                  {
                    backgroundColor:
                      index < step ? theme.colors.brand : theme.colors.border,
                  },
                ]}
              />
            ))}
          </View>

          <FadeSlide>
            <View style={styles.heading}>
              <Text style={[styles.eyebrow, { color: theme.colors.brand }]}>{eyebrow}</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.text }]}>
                {title}
              </Text>
              <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
            </View>
          </FadeSlide>

          <FadeSlide delay={90} style={styles.content}>
            {children}
          </FadeSlide>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignSelf: 'center',
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    width: '100%',
    maxWidth: 540,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 62,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  stepLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    borderRadius: radii.pill,
    flex: 1,
    height: 4,
  },
  heading: {
    gap: spacing.xs,
    paddingBottom: spacing.xl,
    paddingTop: spacing.xxl,
  },
  eyebrow: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: -0.9,
    lineHeight: 38,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 23,
  },
  content: {
    gap: spacing.lg,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
});
