import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { SectionHeader } from '@/components/ui/section-header';
import { DashboardSkeleton } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { WEB_CONTENT_MAX_WIDTH } from '@/constants/web-layout';
import { useDashboardQuery } from '@/features/main/queries';
import { ServiceTile } from '@/features/services/components/service-tile';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function ServicesScreen() {
  const theme = useBillyTheme();
  const query = useDashboardQuery();
  const [search, setSearch] = useState('');
  const { fontScale, width } = useWindowDimensions();
  const columns =
    fontScale > 1.2 ? 1 : width >= 1040 ? 3 : width < 560 ? 1 : 2;
  const contentWidth = Math.min(
    width - spacing.lg * 2,
    WEB_CONTENT_MAX_WIDTH - spacing.xxl * 2,
  );
  const tileWidth =
    columns === 1 ? contentWidth : (contentWidth - spacing.sm) / columns;
  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return query.data?.services ?? [];
    return (query.data?.services ?? []).filter((service) =>
      `${service.label} ${service.description}`.toLowerCase().includes(normalized),
    );
  }, [query.data?.services, search]);

  if (query.isLoading) {
    return (
      <AppScreen>
        <DemoDataBanner />
        <DashboardSkeleton />
      </AppScreen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <AppScreen>
        <DemoDataBanner />
        <SectionHeader subtitle="Discover everything available in Billy." title="Services" />
        <StatePanel
          actionLabel="Try again"
          icon="grid-outline"
          message={query.error?.message ?? 'Billy could not load service availability.'}
          onAction={() => void query.refetch()}
          title="Services are unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="services-screen">
      <DemoDataBanner />
      <SectionHeader
        subtitle="Availability is checked before you start."
        title="Services"
      />

      <View
        style={[
          styles.search,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <Ionicons accessible={false} color={theme.colors.textSoft} name="search" size={20} />
        <TextInput
          accessibilityLabel="Search services"
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search Billy services"
          placeholderTextColor={theme.colors.textSoft}
          returnKeyType="search"
          style={[styles.searchInput, { color: theme.colors.text }]}
          value={search}
        />
      </View>

      {filtered.length ? (
        <View style={styles.grid}>
          {filtered.map((service) => (
            <ServiceTile
              key={service.key}
              onPress={() => {
                if (service.key === 'bills') {
                  router.push('/(app)/bills');
                  return;
                }
                if (service.key === 'social_boost' && service.canTransact) {
                  router.push('/(app)/social-boost');
                  return;
                }
                router.push({
                  pathname: '/(app)/service/[slug]',
                  params: { slug: service.key },
                });
              }}
              service={service}
              width={tileWidth}
            />
          ))}
        </View>
      ) : (
        <StatePanel
          compact
          icon="search-outline"
          message="Try another service name or clear your search."
          title="No service found"
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  search: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 15,
    minHeight: 52,
  },
});
