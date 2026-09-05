import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { SetupShell } from '@/components/ui/setup-shell';
import { updateOnboardingStep } from '@/features/auth/auth-api';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { replaceSetupRoute } from '@/features/auth/setup-navigation';
import { useAppLock } from '@/features/security/app-lock';
import {
  authenticateForBilly,
  inspectBiometricAvailability,
} from '@/features/security/biometric-auth';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function BiometricsSetupScreen() {
  const theme = useBillyTheme();
  const { disableBiometricLock, enableBiometricLock } = useAppLock();
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    async function inspectDevice() {
      if (Platform.OS === 'web') {
        if (active) {
          setAvailable(false);
          setChecking(false);
        }
        return;
      }
      try {
        const result = await inspectBiometricAvailability();
        if (active) {
          setAvailable(result.available);
        }
      } catch {
        if (active) {
          setAvailable(false);
          setFeedback(
            'Billy could not check this device right now. You can retry by reopening this step, or choose Not now.',
          );
        }
      } finally {
        if (active) {
          setChecking(false);
        }
      }
    }
    void inspectDevice();
    return () => {
      active = false;
    };
  }, []);

  async function complete(enabled: boolean) {
    setLoading(true);
    setFeedback('');
    try {
      if (enabled) {
        const result = await authenticateForBilly(
          'Enable biometric unlock for Billy',
        );
        if (!result.success) {
          setFeedback('Biometric setup was cancelled. You can try again or choose Not now.');
          return;
        }
        await enableBiometricLock();
      } else {
        await disableBiometricLock();
      }

      try {
        await updateOnboardingStep('complete');
      } catch (error) {
        if (enabled) {
          await disableBiometricLock();
        }
        throw error;
      }
      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.replace('/(app)/home');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SetupShell
      eyebrow="QUICK, SECURE ACCESS"
      onBack={() => replaceSetupRoute('/(setup)/pin', '/pin')}
      step={3}
      subtitle="Use your device’s secure biometrics to unlock Billy. Your biometric data never leaves your device."
      title="Unlock with a touch">
      <View style={styles.hero}>
        <View style={[styles.halo, { backgroundColor: theme.colors.brandMist }]}>
          <View style={[styles.iconCore, { backgroundColor: theme.colors.surface }]}>
            <Ionicons
              color={theme.colors.brand}
              name={Platform.OS === 'ios' ? 'scan-outline' : 'finger-print-outline'}
              size={58}
            />
          </View>
        </View>
        <Text accessible={false} style={styles.sparkle}>
          ✨
        </Text>
      </View>

      {feedback ? <FeedbackBanner message={feedback} tone="info" /> : null}
      {!checking && !available ? (
        <FeedbackBanner
          message="Biometrics are not available in this preview or are not enrolled on this device. You can enable them later."
          tone="info"
        />
      ) : null}

      <View style={styles.benefits}>
        {[
          ['flash-outline', 'Open Billy faster'],
          ['phone-portrait-outline', 'Protected by your device'],
          ['settings-outline', 'Change it anytime'],
        ].map(([icon, label]) => (
          <View key={label} style={styles.benefit}>
            <View style={[styles.benefitIcon, { backgroundColor: theme.colors.brandMist }]}>
              <Ionicons
                color={theme.colors.brand}
                name={icon as keyof typeof Ionicons.glyphMap}
                size={18}
              />
            </View>
            <Text style={[styles.benefitText, { color: theme.colors.text }]}>{label}</Text>
          </View>
        ))}
      </View>

      <AppButton
        disabled={!available || checking}
        icon="finger-print-outline"
        label={checking ? 'Checking device…' : 'Enable biometric unlock'}
        loading={loading}
        onPress={() => complete(true)}
        testID="biometrics-enable"
      />
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        onPress={() => complete(false)}
        style={styles.notNow}
        testID="biometrics-skip">
        <Text style={[styles.notNowText, { color: theme.colors.textMuted }]}>Not now</Text>
      </Pressable>
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    alignSelf: 'center',
    height: 180,
    justifyContent: 'center',
    position: 'relative',
    width: 180,
  },
  halo: {
    alignItems: 'center',
    borderRadius: 76,
    height: 152,
    justifyContent: 'center',
    width: 152,
  },
  iconCore: {
    alignItems: 'center',
    borderRadius: 56,
    height: 112,
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 10px 36px rgba(11, 72, 41, 0.13)' },
      default: {
        shadowColor: '#0B4829',
        shadowOffset: { height: 10, width: 0 },
        shadowOpacity: 0.13,
        shadowRadius: 18,
      },
    }),
    width: 112,
  },
  sparkle: {
    fontSize: 27,
    position: 'absolute',
    right: 3,
    top: 12,
  },
  benefits: {
    gap: spacing.sm,
  },
  benefit: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  benefitIcon: {
    alignItems: 'center',
    borderRadius: radii.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  benefitText: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
  notNow: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  notNowText: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
});
