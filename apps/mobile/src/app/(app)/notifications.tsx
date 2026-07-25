import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import {
  useMarkNotificationRead,
  useNotificationsQuery,
} from '@/features/main/queries';
import { formatActivityDate } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function NotificationsScreen() {
  const theme = useBillyTheme();
  const query = useNotificationsQuery();
  const markRead = useMarkNotificationRead();

  return (
    <AppScreen
      bottomSafe
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="notifications-screen">
      <ScreenHeader
        subtitle="Account and service updates without sensitive details."
        title="Notifications"
      />
      <DemoDataBanner />
      {markRead.isError ? (
        <FeedbackBanner
          message={
            markRead.error?.message ??
            'Billy could not mark that notification as read.'
          }
          tone="error"
        />
      ) : null}

      {query.isLoading ? (
        <View style={styles.loading}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonBlock key={index} style={styles.skeleton} />
          ))}
        </View>
      ) : query.isError ? (
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error.message}
          onAction={() => void query.refetch()}
          title="Notifications unavailable"
          tone="danger"
        />
      ) : query.data?.length ? (
        <View
          style={[
            styles.list,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}>
          {query.data.map((notification) => {
            const unread = !notification.readAt;
            const actionable = unread || Boolean(notification.route);
            const busy =
              markRead.isPending && markRead.variables === notification.id;
            return (
              <Pressable
                accessible={actionable}
                accessibilityHint={
                  notification.route
                    ? 'Marks this update read when needed, then opens the related Billy screen'
                    : unread
                      ? 'Marks this update as read'
                      : undefined
                }
                accessibilityLabel={
                  actionable
                    ? `${unread ? 'Unread' : 'Read'} notification, ${notification.title}, ${notification.body}`
                    : undefined
                }
                accessibilityRole={actionable ? 'button' : undefined}
                accessibilityState={{ busy, disabled: !actionable }}
                disabled={!actionable || busy}
                key={notification.id}
                onPress={async () => {
                  if (unread) {
                    try {
                      await markRead.mutateAsync(notification.id);
                    } catch {
                      return;
                    }
                  }
                  if (notification.route) {
                    router.push(notification.route);
                  }
                }}
                style={({ pressed }) => [
                  styles.notification,
                  {
                    backgroundColor: unread
                      ? theme.colors.brandMist
                      : theme.colors.surface,
                    borderBottomColor: theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: unread ? theme.colors.brand : theme.colors.surfaceMuted },
                  ]}>
                  <Ionicons
                    accessible={false}
                    color={unread ? theme.colors.white : theme.colors.textMuted}
                    name={
                      notification.type === 'account'
                        ? 'person-outline'
                        : notification.type === 'service'
                          ? 'grid-outline'
                          : 'shield-checkmark-outline'
                    }
                    size={19}
                  />
                </View>
                <View style={styles.copy}>
                  <View style={styles.titleRow}>
                    <Text
                      numberOfLines={2}
                      style={[styles.title, { color: theme.colors.text }]}>
                      {notification.title}
                    </Text>
                    {unread ? (
                      <View
                        accessibilityLabel="Unread"
                        style={[styles.dot, { backgroundColor: theme.colors.brand }]}
                      />
                    ) : null}
                  </View>
                  <Text style={[styles.body, { color: theme.colors.textMuted }]}>
                    {notification.body}
                  </Text>
                  <Text style={[styles.date, { color: theme.colors.textSoft }]}>
                    {formatActivityDate(notification.createdAt)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <StatePanel
          icon="notifications-outline"
          message="Important account and service updates will appear here."
          title="You’re all caught up"
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
  },
  copy: {
    flex: 1,
    gap: 5,
  },
  date: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  dot: {
    borderRadius: radii.pill,
    height: 8,
    width: 8,
  },
  icon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  list: {
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  loading: {
    gap: spacing.sm,
  },
  notification: {
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 104,
    padding: spacing.lg,
  },
  skeleton: {
    height: 104,
  },
  title: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
