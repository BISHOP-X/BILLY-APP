import { Ionicons } from '@expo/vector-icons';
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
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type AuthShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  eyebrow?: string;
  onBack?: () => void;
  footer?: ReactNode;
}>;

export function AuthShell({
  children,
  title,
  subtitle,
  eyebrow = 'BILLY',
  onBack,
  footer,
}: AuthShellProps) {
  const theme = useBillyTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          bounces={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
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
              <View style={styles.backPlaceholder} />
            )}
            <View style={[styles.securePill, { backgroundColor: theme.colors.brandMist }]}>
              <Ionicons color={theme.colors.brand} name="shield-checkmark" size={14} />
              <Text style={[styles.secureText, { color: theme.colors.brand }]}>Secure</Text>
            </View>
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

          <FadeSlide delay={90} style={styles.cardWrap}>
            <View
              style={[
                styles.card,
                shadows.card,
                {
                  backgroundColor: theme.colors.surfaceRaised,
                  borderColor: theme.colors.border,
                },
              ]}>
              {children}
            </View>
          </FadeSlide>

          {footer ? <FadeSlide delay={160}>{footer}</FadeSlide> : null}
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
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  backPlaceholder: {
    height: 42,
    width: 42,
  },
  securePill: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  secureText: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  heading: {
    gap: spacing.xs,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  eyebrow: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.1,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.1,
    lineHeight: 40,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 440,
  },
  cardWrap: {
    width: '100%',
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
});
