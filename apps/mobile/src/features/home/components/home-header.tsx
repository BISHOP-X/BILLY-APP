import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import type { ProfileSummary } from '@/features/main/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type HomeHeaderProps = {
  onAccount: () => void;
  onNotifications: () => void;
  profile: ProfileSummary;
  unreadCount: number;
};

function dayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function initials(profile: ProfileSummary) {
  const source = profile.displayName || profile.firstName;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function HomeHeader({
  onAccount,
  onNotifications,
  profile,
  unreadCount,
}: HomeHeaderProps) {
  const theme = useBillyTheme();

  return (
    <View style={styles.header}>
      <View style={styles.identity}>
        <IconButton
          accessibilityLabel="Open account"
          badge={
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.avatarBadge, { backgroundColor: theme.colors.brand }]}>
              <Text style={styles.avatarText}>{initials(profile)}</Text>
            </View>
          }
          icon="person-outline"
          onPress={onAccount}
          testID="home-account"
        />
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.greeting, { color: theme.colors.text }]}>
            Hello, {profile.firstName} <Text accessible={false}>👋</Text>
          </Text>
          <Text style={[styles.timeGreeting, { color: theme.colors.textMuted }]}>
            {dayGreeting()}
          </Text>
        </View>
      </View>
      <IconButton
        accessibilityLabel={
          unreadCount
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications, none unread'
        }
        badge={
          unreadCount ? (
            <View style={[styles.notificationBadge, { backgroundColor: theme.colors.danger }]}>
              <Text style={styles.notificationText}>{Math.min(unreadCount, 9)}</Text>
            </View>
          ) : undefined
        }
        icon="notifications-outline"
        onPress={onNotifications}
        testID="home-notifications"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  avatarBadge: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  greeting: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  identity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  notificationBadge: {
    alignItems: 'center',
    borderRadius: radii.pill,
    minHeight: 18,
    minWidth: 18,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
  },
  timeGreeting: {
    fontFamily: typography.family,
    fontSize: 13,
  },
});
