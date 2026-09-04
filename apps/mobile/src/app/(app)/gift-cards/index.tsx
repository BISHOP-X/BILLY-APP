import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { BuyCardJourney } from '@/features/prestmit/components/buy-card-journey';
import { PrestmitOrderCard } from '@/features/prestmit/components/prestmit-order-card';
import { useCardCatalog, useCardOrders } from '@/features/prestmit/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function GiftCardsScreen() {
  const theme = useBillyTheme();
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const catalog = useCardCatalog('gift_cards');
  const orders = useCardOrders('gift_cards');

  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      onRefresh={() => {
        void catalog.refetch();
        void orders.refetch();
      }}
      refreshing={catalog.isRefetching || orders.isRefetching}
      testID="gift-cards-screen">
      <ScreenHeader title="Gift Cards" />
      <LinearGradient
        colors={['#082F1D', '#11613A', '#36A873']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons color="#11613A" name="gift-outline" size={31} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>CURRENT PRICES · SECURE DELIVERY</Text>
          <Text style={styles.heroTitle}>Gift cards, without guesswork.</Text>
          <Text style={styles.heroBody}>
            Buy digital cards or submit yours for a verified wallet payout.
          </Text>
        </View>
      </LinearGradient>

      <View style={[styles.switcher, { backgroundColor: theme.colors.brandMist }]}>
        <ModeButton
          active={mode === 'buy'}
          icon="bag-handle-outline"
          label="Buy"
          onPress={() => setMode('buy')}
        />
        <ModeButton
          active={mode === 'sell'}
          icon="swap-horizontal-outline"
          label="Sell"
          onPress={() => setMode('sell')}
        />
      </View>

      {mode === 'buy' ? (
        <>
          <View style={styles.heading}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              Choose a gift card
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              The list and price are loaded securely at the time you use them.
            </Text>
          </View>
          {catalog.isLoading ? (
            <>
              <SkeletonBlock style={styles.skeleton} />
              <SkeletonBlock style={styles.skeleton} />
            </>
          ) : catalog.isError || !catalog.data ? (
            <StatePanel
              actionLabel="Try again"
              icon="cloud-offline-outline"
              message={
                catalog.error?.message ??
                'Billy could not load the current gift card catalog.'
              }
              onAction={() => void catalog.refetch()}
              title="Catalog unavailable"
              tone="danger"
            />
          ) : (
            <BuyCardJourney
              catalog={catalog.data}
              onCompleted={(order) =>
                router.push({
                  pathname: '/(app)/card-order/[id]',
                  params: { id: order.id, service: 'gift_cards' },
                })
              }
              service="gift_cards"
            />
          )}
        </>
      ) : (
        <FadeSlide style={styles.sellPanel}>
          <View
            style={[
              styles.sellCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <View style={[styles.sellIcon, { backgroundColor: theme.colors.brandMist }]}>
              <Ionicons
                color={theme.colors.brand}
                name="shield-checkmark-outline"
                size={27}
              />
            </View>
            <Text style={[styles.sellTitle, { color: theme.colors.text }]}>
              Sell into your Billy wallet
            </Text>
            <Text style={[styles.sellBody, { color: theme.colors.textMuted }]}>
              Choose the exact card type, get a current payout quote, submit a
              physical image or eCode, then track review. Verified identity is
              required before submission and again before payout.
            </Text>
            <AppButton
              icon="arrow-forward"
              label="Start secure sale"
              onPress={() => router.push('/(app)/gift-cards/sell')}
            />
          </View>
        </FadeSlide>
      )}

      {orders.data?.length ? (
        <View style={styles.orders}>
          <View style={styles.heading}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              Recent gift card orders
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>
              Pending reviews and delivered cards stay here.
            </Text>
          </View>
          {orders.data.slice(0, 5).map((order) => (
            <PrestmitOrderCard
              key={order.id}
              onPress={() =>
                router.push({
                  pathname: '/(app)/card-order/[id]',
                  params: { id: order.id, service: 'gift_cards' },
                })
              }
              order={order}
            />
          ))}
        </View>
      ) : null}
    </AppScreen>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useBillyTheme();
  return (
    <ScalePressable
      accessibilityLabel={`${label} gift cards`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.mode,
        active && { backgroundColor: theme.colors.brand },
      ]}>
      <Ionicons
        color={active ? '#FFFFFF' : theme.colors.brand}
        name={icon}
        size={18}
      />
      <Text
        style={[
          styles.modeText,
          { color: active ? '#FFFFFF' : theme.colors.brand },
        ]}>
        {label}
      </Text>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  eyebrow: {
    color: '#B9F4D1',
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  heading: {
    gap: 4,
  },
  hero: {
    alignItems: 'center',
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 154,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.73)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  heroCopy: {
    flex: 1,
    gap: 5,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 24,
  },
  mode: {
    alignItems: 'center',
    borderRadius: radii.lg,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
  },
  modeText: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '900',
  },
  orders: {
    gap: spacing.sm,
  },
  sellBody: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  sellCard: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
  },
  sellIcon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  sellPanel: {
    gap: spacing.lg,
  },
  sellTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
    fontWeight: '900',
    textAlign: 'center',
  },
  skeleton: {
    height: 106,
  },
  subtitle: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  switcher: {
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  title: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '900',
  },
});
