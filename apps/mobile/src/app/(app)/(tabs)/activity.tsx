import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { ActivityRow } from '@/features/activity/components/activity-row';
import type { ActivityItem } from '@/features/main/domain';
import { useActivityQuery } from '@/features/main/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type Filter = 'all' | 'money-in' | 'payments' | 'pending';

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'money-in', label: 'Money in' },
  { key: 'payments', label: 'Payments' },
  { key: 'pending', label: 'Pending' },
];

function matchesFilter(item: ActivityItem, filter: Filter) {
  if (filter === 'money-in') return item.direction === 'credit';
  if (filter === 'payments') return item.direction === 'debit';
  if (filter === 'pending') {
    return ['created', 'pending', 'processing', 'reserved'].includes(item.status);
  }
  return true;
}

export default function ActivityScreen() {
  const theme = useBillyTheme();
  const query = useActivityQuery();
  const [filter, setFilter] = useState<Filter>('all');
  const activity = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const filtered = useMemo(
    () => activity.filter((item) => matchesFilter(item, filter)),
    [activity, filter],
  );

  if (query.isError && !query.data) {
    return (
      <AppScreen testID="activity-error">
        <DemoDataBanner />
        <SectionHeader
          subtitle="Transactions, orders, refunds, and receipts."
          title="Activity"
        />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message={query.error.message}
          onAction={() => void query.refetch()}
          title="Activity is unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll={false} testID="activity-screen">
      <FlatList
        contentContainerStyle={styles.content}
        data={query.isLoading ? [] : filtered}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={styles.skeletons}>
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonBlock key={index} style={styles.skeletonRow} />
              ))}
            </View>
          ) : (
            <StatePanel
              compact
              icon="receipt-outline"
              message={
                activity.length
                  ? 'No activity matches this filter.'
                  : 'Transactions and service orders will appear here with clear status updates.'
              }
              title={activity.length ? 'Nothing in this view' : 'No activity yet'}
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.colors.brand} />
              <Text style={[styles.footerText, { color: theme.colors.textMuted }]}>
                Loading more activity
              </Text>
            </View>
          ) : query.isFetchNextPageError ? (
            <Pressable
              accessibilityHint="Retries loading older activity"
              accessibilityRole="button"
              onPress={() => void query.fetchNextPage()}
              style={styles.footer}>
              <Text style={[styles.footerAction, { color: theme.colors.brand }]}>
                Could not load older activity. Try again
              </Text>
            </Pressable>
          ) : query.hasNextPage ? (
            <Pressable
              accessibilityHint="Loads older activity"
              accessibilityRole="button"
              onPress={() => void query.fetchNextPage()}
              style={styles.footer}>
              <Text style={[styles.footerAction, { color: theme.colors.brand }]}>
                Load older activity
              </Text>
            </Pressable>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <DemoDataBanner />
            <SectionHeader
              subtitle="Transactions, orders, refunds, and receipts."
              title="Activity"
            />
            <View accessibilityRole="tablist" style={styles.filters}>
              {filters.map((item) => {
                const selected = item.key === filter;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    key={item.key}
                    onPress={() => setFilter(item.key)}
                    style={[
                      styles.filter,
                      {
                        backgroundColor: selected
                          ? theme.colors.brand
                          : theme.colors.surface,
                        borderColor: selected
                          ? theme.colors.brand
                          : theme.colors.border,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.filterText,
                        {
                          color: selected ? theme.colors.white : theme.colors.textMuted,
                        },
                      ]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.35}
        onRefresh={() => void query.refetch()}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        renderItem={({ item }) => (
          <ActivityRow
            item={item}
            onPress={() =>
              router.push({
                pathname: '/(app)/transaction/[id]',
                params: { id: item.id },
              })
            }
            showStatus
          />
        )}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    paddingBottom: spacing.xxxl,
    paddingHorizontal: spacing.lg,
    width: '100%',
  },
  filter: {
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  filterText: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 64,
    paddingVertical: spacing.md,
  },
  footerAction: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  footerText: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  header: {
    gap: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  list: {
    alignSelf: 'center',
    maxWidth: 720,
    width: '100%',
  },
  skeletonRow: {
    height: 76,
  },
  skeletons: {
    gap: spacing.xs,
  },
});
