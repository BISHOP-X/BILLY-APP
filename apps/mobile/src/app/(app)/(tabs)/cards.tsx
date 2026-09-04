import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { BillyLogo } from '@/components/ui/billy-logo';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { SectionHeader } from '@/components/ui/section-header';
import { DashboardSkeleton } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusChip } from '@/components/ui/status-chip';
import type { AppIconName } from '@/features/main/domain';
import { useDashboardQuery } from '@/features/main/queries';
import { BuyCardJourney } from '@/features/prestmit/components/buy-card-journey';
import { PrestmitOrderCard } from '@/features/prestmit/components/prestmit-order-card';
import { useCardCatalog, useCardOrders } from '@/features/prestmit/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

const maskedCardNumber =
  '\u2022\u2022\u2022\u2022  \u2022\u2022\u2022\u2022  \u2022\u2022\u2022\u2022  \u2022\u2022\u2022\u2022';

export default function CardsScreen() {
  const theme = useBillyTheme();
  const query = useDashboardQuery();
  const catalog = useCardCatalog('prepaid_cards');
  const orders = useCardOrders('prepaid_cards');

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
        <SectionHeader subtitle="Secure prepaid virtual cards." title="Cards" />
        <StatePanel
          actionLabel="Try again"
          icon="card-outline"
          message={query.error?.message ?? 'Billy could not load card availability.'}
          onAction={() => void query.refetch()}
          title="Cards are unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  const service = query.data.services.find(
    (candidate) => candidate.key === 'prepaid_cards',
  );

  return (
    <AppScreen
      contentStyle={styles.content}
      onRefresh={() => {
        void query.refetch();
        void catalog.refetch();
        void orders.refetch();
      }}
      refreshing={
        query.isRefetching || catalog.isRefetching || orders.isRefetching
      }
      testID="cards-screen">
      <DemoDataBanner />
      <SectionHeader
        subtitle="Your card space stays ready while Billy confirms service access."
        title="Cards"
      />

      <FadeSlide>
        <View style={styles.cardStage}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.backCard, styles.backCardFar]}
          />
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.backCard, styles.backCardNear]}
          />
          <LinearGradient
            accessible
            accessibilityLabel="Billy prepaid card preview. No card has been issued."
            accessibilityRole="image"
            colors={['#0A3D25', '#146237', '#2B9463']}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={[styles.cardPreview, shadows.card]}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.cardGlow}
            />
            <View style={styles.cardTop}>
              <View style={styles.brandLockup}>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.brandMark}>
                  <BillyLogo size={29} tintColor="#FFFFFF" />
                </View>
                <View>
                  <Text style={styles.brandName}>Billy</Text>
                  <Text style={styles.cardType}>PREPAID VIRTUAL</Text>
                </View>
              </View>
              <Ionicons accessible={false} color="#FFFFFF" name="wifi" size={21} />
            </View>
            <Text
              accessibilityLabel="Card number unavailable"
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              numberOfLines={1}
              style={styles.cardNumber}>
              {maskedCardNumber}
            </Text>
            <View style={styles.cardBottom}>
              <View>
                <Text style={styles.cardMetaLabel}>CARD STATUS</Text>
                <Text style={styles.cardMeta}>NOT ISSUED</Text>
              </View>
              <View style={styles.previewPill}>
                <View style={styles.previewDot} />
                <Text style={styles.previewText}>PREVIEW</Text>
              </View>
            </View>
          </LinearGradient>
        </View>
      </FadeSlide>

      <FadeSlide delay={45} style={styles.section}>
        <SectionHeader
          subtitle="Choose a provider-current prepaid product, value, and secure delivery."
          title="Get a prepaid card"
        />
        {catalog.isLoading ? (
          <DashboardSkeleton />
        ) : catalog.isError || !catalog.data ? (
          <StatePanel
            actionLabel="Try again"
            icon="cloud-offline-outline"
            message={
              catalog.error?.message ??
              'Billy could not load current prepaid card products.'
            }
            onAction={() => void catalog.refetch()}
            title="Prepaid products unavailable"
            tone="danger"
          />
        ) : (
          <BuyCardJourney
            catalog={catalog.data}
            onCompleted={(order) =>
              router.push({
                pathname: '/(app)/card-order/[id]',
                params: { id: order.id, service: 'prepaid_cards' },
              })
            }
            service="prepaid_cards"
          />
        )}
      </FadeSlide>

      {orders.data?.length ? (
        <FadeSlide delay={80} style={styles.section}>
          <SectionHeader
            subtitle="Delivered details remain encrypted until you enter your PIN."
            title="Your prepaid orders"
          />
          {orders.data.slice(0, 5).map((order) => (
            <PrestmitOrderCard
              key={order.id}
              onPress={() =>
                router.push({
                  pathname: '/(app)/card-order/[id]',
                  params: { id: order.id, service: 'prepaid_cards' },
                })
              }
              order={order}
            />
          ))}
        </FadeSlide>
      ) : null}

      <FadeSlide delay={60} style={styles.section}>
        <SectionHeader title="Card tools" />
        <View style={styles.actionGrid}>
          <CardAction
            hint="Opens the current prepaid card service status"
            icon="pulse-outline"
            label="Availability"
            onPress={() =>
              router.push({
                pathname: '/(app)/service/[slug]',
                params: { slug: 'prepaid_cards' },
              })
            }
            testID="card-action-availability"
          />
          <CardAction
            hint="Opens Billy security settings"
            icon="shield-checkmark-outline"
            label="Security"
            onPress={() => router.push('/(app)/security')}
            testID="card-action-security"
          />
          <CardAction
            hint="Opens your Billy activity"
            icon="receipt-outline"
            label="Activity"
            onPress={() => router.push('/(app)/(tabs)/activity')}
            testID="card-action-activity"
          />
        </View>
      </FadeSlide>

      <FadeSlide delay={110} style={styles.section}>
        <View
          style={[
            styles.availabilityCard,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}>
          <View style={styles.availabilityTop}>
            <View style={styles.availabilityCopy}>
              <Text
                accessibilityRole="header"
                style={[styles.availabilityTitle, { color: theme.colors.text }]}>
                No active card
              </Text>
              <Text style={[styles.availabilityBody, { color: theme.colors.textMuted }]}>
                {service?.message ??
                  'Billy could not confirm prepaid card access, so requests remain unavailable.'}
              </Text>
            </View>
            <StatusChip status={service?.state ?? 'unavailable'} />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <InfoRow
            icon="person-circle-outline"
            label="Verification"
            value={query.data.kyc.status.replaceAll('_', ' ')}
          />
          <InfoRow
            icon="lock-closed-outline"
            label="Card details"
            value="Unavailable until issuance"
          />
          <InfoRow
            icon="notifications-outline"
            label="Updates"
            value="Shown in Billy notifications"
          />
        </View>
      </FadeSlide>
    </AppScreen>
  );
}

function CardAction({
  hint,
  icon,
  label,
  onPress,
  testID,
}: {
  hint: string;
  icon: AppIconName;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <ScalePressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.actionTile}
      testID={testID}>
      <View style={styles.actionIcon}>
        <Ionicons accessible={false} color="#B8F3CF" name={icon} size={20} />
      </View>
      <Text numberOfLines={2} style={styles.actionLabel}>
        {label}
      </Text>
      <Ionicons
        accessible={false}
        color="rgba(255,255,255,0.52)"
        name="arrow-forward"
        size={14}
      />
    </ScalePressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: AppIconName;
  label: string;
  value: string;
}) {
  const theme = useBillyTheme();
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons accessible={false} color={theme.colors.brand} name={icon} size={17} />
      </View>
      <Text style={[styles.infoLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text
        numberOfLines={2}
        style={[styles.infoValue, { color: theme.colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(184,243,207,0.12)',
    borderRadius: radii.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  actionLabel: {
    color: '#FFFFFF',
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  actionTile: {
    backgroundColor: '#102119',
    borderColor: 'rgba(184,243,207,0.12)',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    minHeight: 112,
    minWidth: 0,
    padding: spacing.sm,
  },
  availabilityBody: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
  },
  availabilityCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  availabilityCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  availabilityTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
  },
  availabilityTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  backCard: {
    aspectRatio: 1.62,
    borderRadius: radii.xl,
    left: '6%',
    position: 'absolute',
    width: '88%',
  },
  backCardFar: {
    backgroundColor: '#A9E8C1',
    opacity: 0.38,
    top: 0,
    transform: [{ rotate: '-4deg' }],
  },
  backCardNear: {
    backgroundColor: '#2A8B5C',
    opacity: 0.72,
    top: 10,
    transform: [{ rotate: '3deg' }],
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  brandName: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
  },
  cardBottom: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardGlow: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radii.pill,
    height: 190,
    position: 'absolute',
    right: -70,
    top: -86,
    width: 190,
  },
  cardMeta: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 3,
  },
  cardMetaLabel: {
    color: 'rgba(255,255,255,0.58)',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  cardNumber: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  cardPreview: {
    alignSelf: 'center',
    aspectRatio: 1.62,
    borderRadius: radii.xl,
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
    maxWidth: 500,
    overflow: 'hidden',
    padding: spacing.lg,
    width: '94%',
  },
  cardStage: {
    alignSelf: 'center',
    maxWidth: 530,
    width: '100%',
  },
  cardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardType: {
    color: 'rgba(255,255,255,0.58)',
    fontFamily: typography.familyRounded,
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  content: {
    gap: spacing.lg,
  },
  divider: {
    height: 1,
  },
  infoIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  infoLabel: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 38,
  },
  infoValue: {
    flex: 1.2,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  previewDot: {
    backgroundColor: '#B8F3CF',
    borderRadius: radii.pill,
    height: 6,
    width: 6,
  },
  previewPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
  previewText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  section: {
    gap: spacing.sm,
  },
});
