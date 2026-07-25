import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { SectionHeader } from '@/components/ui/section-header';
import { DashboardSkeleton } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { AccountRow } from '@/features/account/components/account-row';
import { useAuth } from '@/features/auth/auth-provider';
import { useDashboardQuery } from '@/features/main/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function AccountScreen() {
  const theme = useBillyTheme();
  const dashboard = useDashboardQuery();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  async function performSignOut() {
    await signOut();
    queryClient.clear();
    router.replace('/(auth)/sign-in');
  }

  function confirmSignOut() {
    if (Platform.OS === 'web') {
      void performSignOut();
      return;
    }
    Alert.alert('Sign out of Billy?', 'You will need to sign in again on this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => void performSignOut(), style: 'destructive', text: 'Sign out' },
    ]);
  }

  if (dashboard.isLoading) {
    return (
      <AppScreen>
        <DemoDataBanner />
        <DashboardSkeleton />
      </AppScreen>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <AppScreen>
        <DemoDataBanner />
        <SectionHeader subtitle="Profile, privacy, and support." title="Account" />
        <StatePanel
          actionLabel="Try again"
          icon="person-circle-outline"
          message={dashboard.error?.message ?? 'Billy could not load your account.'}
          onAction={() => void dashboard.refetch()}
          title="Account is unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  const { kyc, profile } = dashboard.data;
  const initials = profile.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <AppScreen
      onRefresh={() => void dashboard.refetch()}
      refreshing={dashboard.isRefetching}
      testID="account-screen">
      <DemoDataBanner />
      <SectionHeader subtitle="Profile, privacy, security, and support." title="Account" />

      <View
        style={[
          styles.profile,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <View style={[styles.avatar, { backgroundColor: theme.colors.brand }]}>
          <Text style={styles.initials}>{initials || 'B'}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={[styles.name, { color: theme.colors.text }]}>{profile.displayName}</Text>
          <View style={styles.tier}>
            <Ionicons
              accessible={false}
              color={theme.colors.brand}
              name="shield-checkmark-outline"
              size={15}
            />
            <Text style={[styles.tierText, { color: theme.colors.textMuted }]}>
              Tier {kyc.tier} · {kyc.status.replace('_', ' ')}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.menu,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <AccountRow
          icon="person-outline"
          label="Profile"
          onPress={() => router.push('/(app)/account/profile')}
          subtitle="Name, phone, and personal details"
        />
        <AccountRow
          icon="shield-checkmark-outline"
          label="Verification"
          onPress={() => router.push('/(app)/kyc')}
          value={kyc.status.replace('_', ' ')}
        />
        <AccountRow
          icon="lock-closed-outline"
          label="Security"
          onPress={() => router.push('/(app)/security')}
          subtitle="PIN, biometrics, and protected access"
        />
        <AccountRow
          icon="notifications-outline"
          label="Notifications"
          onPress={() => router.push('/(app)/notifications')}
          subtitle="Updates about your account and services"
        />
      </View>

      <View
        style={[
          styles.menu,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <AccountRow
          icon="help-buoy-outline"
          label="Help and support"
          onPress={() => router.push('/(app)/support')}
          subtitle="Guidance and support requests"
        />
        <AccountRow
          icon="document-text-outline"
          label="Legal and privacy"
          onPress={() => router.push('/(app)/account/legal')}
          subtitle="Terms, privacy, and accepted versions"
        />
      </View>

      <AppButton label="Sign out" onPress={confirmSignOut} variant="ghost" />
      <Text style={[styles.version, { color: theme.colors.textSoft }]}>
        Billy mobile · secure preview
      </Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  initials: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
  menu: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
  },
  name: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
  profile: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  profileCopy: {
    flex: 1,
    gap: 5,
  },
  tier: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  tierText: {
    fontFamily: typography.family,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  version: {
    fontFamily: typography.family,
    fontSize: 11,
    textAlign: 'center',
  },
});
