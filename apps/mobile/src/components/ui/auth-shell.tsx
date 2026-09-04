import Ionicons from '@expo/vector-icons/Ionicons';
import { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { FadeSlide } from '@/components/ui/motion';
import { BillyLogo } from '@/components/ui/billy-logo';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type AuthShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  eyebrow?: string;
  onBack?: () => void;
  footer?: ReactNode;
  compact?: boolean;
}>;

export function AuthShell({
  children,
  title,
  subtitle,
  eyebrow = 'BILLY',
  onBack,
  footer,
  compact = false,
}: AuthShellProps) {
  const { height, width } = useWindowDimensions();
  const isNarrow = width < 370;
  const isShort = height < 760;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[
            styles.scrollContent,
            isNarrow && styles.scrollContentNarrow,
            (compact || isShort) && styles.scrollContentCompact,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            {onBack ? (
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={10}
                onPress={onBack}
                style={styles.backButton}>
                <Ionicons color="#F5FAF7" name="chevron-back" size={22} />
              </Pressable>
            ) : (
              <View style={styles.backPlaceholder} />
            )}
            <View pointerEvents="none" style={styles.centerLogo}>
              <BillyLogo size={86} tintColor="#FFFFFF" variant="wordmark" />
            </View>
            <View style={styles.securePill}>
              <Ionicons color="#80DFA7" name="shield-checkmark" size={14} />
              <Text style={styles.secureText}>Secure</Text>
            </View>
          </View>

          <FadeSlide>
            <View style={[styles.heading, (compact || isShort) && styles.headingCompact]}>
              <Text style={styles.eyebrow}>{eyebrow}</Text>
              <Text
                accessibilityRole="header"
                style={[styles.title, isNarrow && styles.titleNarrow]}>
                {title}
              </Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
          </FadeSlide>

          <FadeSlide delay={90} style={styles.cardWrap}>
            <View
              style={[
                styles.card,
                (compact || isShort) && styles.cardCompact,
                shadows.card,
                {
                  backgroundColor: '#F7FAF8',
                  borderColor: 'rgba(255, 255, 255, 0.72)',
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
    backgroundColor: '#07160D',
    flex: 1,
    overflow: 'hidden',
  },
  glowTop: {
    backgroundColor: 'rgba(37, 143, 98, 0.2)',
    borderRadius: 260,
    height: 440,
    position: 'absolute',
    right: -250,
    top: -220,
    width: 440,
  },
  glowBottom: {
    backgroundColor: 'rgba(184, 243, 207, 0.06)',
    borderRadius: 220,
    bottom: -250,
    height: 420,
    left: -230,
    position: 'absolute',
    width: 420,
  },
  scrollContent: {
    alignSelf: 'center',
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    width: '100%',
    maxWidth: 540,
  },
  scrollContentNarrow: {
    paddingHorizontal: spacing.md,
  },
  scrollContentCompact: {
    paddingBottom: spacing.lg,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    position: 'relative',
  },
  centerLogo: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: radii.pill,
    borderWidth: 1,
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
    backgroundColor: 'rgba(128, 223, 167, 0.12)',
    borderColor: 'rgba(128, 223, 167, 0.18)',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  secureText: {
    color: '#9AE7B9',
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  heading: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  headingCompact: {
    paddingBottom: spacing.lg,
    paddingTop: spacing.xxs,
  },
  eyebrow: {
    color: '#80DFA7',
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.1,
  },
  title: {
    color: '#F8FBF9',
    fontFamily: typography.familyRounded,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1.1,
    lineHeight: 42,
    textAlign: 'center',
  },
  titleNarrow: {
    fontSize: 30,
    letterSpacing: -0.8,
    lineHeight: 39,
  },
  subtitle: {
    color: '#AEBBB3',
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 440,
    textAlign: 'center',
  },
  cardWrap: {
    width: '100%',
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  cardCompact: {
    gap: spacing.md,
    padding: spacing.lg,
  },
});
