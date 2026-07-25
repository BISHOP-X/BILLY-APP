import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import {
  authenticateForBilly,
  describeAuthenticationFailure,
  inspectBiometricAvailability,
} from '@/features/security/biometric-auth';
import { useAppLock } from '@/features/security/app-lock';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function SecurityScreen() {
  const theme = useBillyTheme();
  const {
    disableBiometricLock,
    enableBiometricLock,
    initializationError,
    isBiometricLockEnabled,
    lockNow,
  } = useAppLock();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void inspectBiometricAvailability()
      .then((result) => {
        if (active) setAvailable(result.available);
      })
      .catch(() => {
        if (active) setError('Billy could not inspect biometric availability.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function toggleBiometric(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      if (!available || Platform.OS === 'web') {
        setError('Biometric app lock is available only on an enrolled Android or iOS device.');
        return;
      }
      const result = await authenticateForBilly(
        enabled ? 'Enable Billy biometric lock' : 'Disable Billy biometric lock',
      );
      if (!result.success) {
        setError(describeAuthenticationFailure(result.error));
        return;
      }
      if (enabled) await enableBiometricLock();
      else await disableBiometricLock();
    } catch {
      setError('Billy could not update biometric lock. Your previous setting remains active.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen bottomSafe testID="security-screen">
      <ScreenHeader
        subtitle="Controls that protect access to Billy on this device."
        title="Security"
      />

      {error || initializationError ? (
        <FeedbackBanner message={error || initializationError || ''} tone="error" />
      ) : null}

      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <View style={styles.setting}>
          <View style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}>
            <Ionicons
              accessible={false}
              color={theme.colors.brand}
              name={Platform.OS === 'ios' ? 'scan-outline' : 'finger-print-outline'}
              size={23}
            />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              Biometric app lock
            </Text>
            <Text style={[styles.body, { color: theme.colors.textMuted }]}>
              Unlock an existing Billy session with device biometrics. This never replaces
              transaction authorization.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Biometric app lock"
            accessibilityState={{ checked: isBiometricLockEnabled, disabled: busy }}
            disabled={busy}
            onValueChange={(enabled) => void toggleBiometric(enabled)}
            thumbColor={
              isBiometricLockEnabled ? theme.colors.brand : theme.colors.textSoft
            }
            trackColor={{
              false: theme.colors.border,
              true: theme.colors.brandMist,
            }}
            value={isBiometricLockEnabled}
          />
        </View>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <SecurityRow
          icon="keypad-outline"
          label="Transaction PIN"
          note="Configured during setup. Changing it requires a dedicated recent-auth flow."
          value="Set"
        />
        <SecurityRow
          icon="phone-portrait-outline"
          label="Device sessions"
          note="Remote session management will be added after secure session inventory is available."
          value="Current device"
        />
        <SecurityRow
          icon="notifications-outline"
          label="Security alerts"
          note="Important access and account changes appear in Billy notifications."
          value="On"
        />
      </View>

      {isBiometricLockEnabled ? (
        <AppButton
          icon="lock-closed-outline"
          label="Lock Billy now"
          onPress={lockNow}
          variant="secondary"
        />
      ) : null}

      <View style={[styles.notice, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons
          accessible={false}
          color={theme.colors.textMuted}
          name="information-circle-outline"
          size={20}
        />
        <Text style={[styles.noticeText, { color: theme.colors.textMuted }]}>
          Billy will never ask you to share a password, verification link, or transaction
          PIN with support.
        </Text>
      </View>
    </AppScreen>
  );
}

function SecurityRow({
  icon,
  label,
  note,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  note: string;
  value: string;
}) {
  const theme = useBillyTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <Ionicons accessible={false} color={theme.colors.brand} name={icon} size={20} />
      <View style={styles.copy}>
        <View style={styles.rowTitle}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{label}</Text>
          <Text style={[styles.value, { color: theme.colors.brand }]}>{value}</Text>
        </View>
        <Text style={[styles.body, { color: theme.colors.textMuted }]}>{note}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  notice: {
    alignItems: 'flex-start',
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  noticeText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 92,
    paddingVertical: spacing.lg,
  },
  rowTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  setting: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 110,
    paddingVertical: spacing.lg,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  value: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
