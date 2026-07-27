import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusChip } from '@/components/ui/status-chip';
import { TextField } from '@/components/ui/text-field';
import type {
  CardFulfilment,
  CardServiceKey,
  PrestmitOrder,
} from '@/features/prestmit/domain';
import { prestmitRepository } from '@/features/prestmit/repository';
import {
  formatFullDate,
  formatMinorUnits,
} from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

function validService(value: string | undefined): CardServiceKey {
  return value === 'prepaid_cards' ? 'prepaid_cards' : 'gift_cards';
}

export default function CardOrderScreen() {
  const theme = useBillyTheme();
  const params = useLocalSearchParams<{ id?: string; service?: string }>();
  const orderId = typeof params.id === 'string' ? params.id : '';
  const service = validService(
    typeof params.service === 'string' ? params.service : undefined,
  );
  const [order, setOrder] = useState<PrestmitOrder | null>(null);
  const [fulfilment, setFulfilment] = useState<CardFulfilment | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void prestmitRepository
      .getOrder(orderId, service)
      .then((value) => {
        if (active) setOrder(value);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Billy could not load this card order.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId, service]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      setOrder(await prestmitRepository.refreshOrder(orderId, service));
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Billy could not refresh this order.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function reveal() {
    setRevealing(true);
    setError(null);
    try {
      setFulfilment(await prestmitRepository.reveal(orderId, pin, service));
      setPin('');
    } catch (revealError) {
      setError(
        revealError instanceof Error
          ? revealError.message
          : 'Billy could not reveal these card details safely.',
      );
    } finally {
      setRevealing(false);
    }
  }

  async function copy(value: string, label: string) {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  }

  if (loading) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Card Order" />
        <SkeletonBlock style={styles.heroSkeleton} />
        <SkeletonBlock style={styles.bodySkeleton} />
      </AppScreen>
    );
  }

  if (!order) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Card Order" />
        <StatePanel
          actionLabel="Go back"
          icon="receipt-outline"
          message={error ?? 'This card order could not be found.'}
          onAction={() => router.back()}
          title="Order unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  const isSell = order.tradeType === 'gift_card_sell';
  const isPending = ['pending', 'processing', 'reserved'].includes(order.status);

  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      testID="card-order-screen">
      <ScreenHeader title={isSell ? 'Gift Card Sale' : 'Card Order'} />
      <FadeSlide
        style={[
          styles.hero,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <View style={[styles.heroIcon, { backgroundColor: theme.colors.brandMist }]}>
          <Ionicons
            color={theme.colors.brand}
            name={isSell ? 'swap-horizontal-outline' : 'gift-outline'}
            size={28}
          />
        </View>
        <StatusChip status={order.status} />
        <Text style={[styles.heroTitle, { color: theme.colors.text }]}>
          {order.productTitle}
        </Text>
        <Text style={[styles.heroMessage, { color: theme.colors.textMuted }]}>
          {order.statusMessage}
        </Text>
        {order.isPreview ? (
          <View style={[styles.preview, { backgroundColor: theme.colors.brandMist }]}>
            <Ionicons color={theme.colors.brand} name="flask-outline" size={14} />
            <Text style={[styles.previewText, { color: theme.colors.brand }]}>
              TESTER PREVIEW
            </Text>
          </View>
        ) : null}
      </FadeSlide>

      <View
        style={[
          styles.details,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <DetailRow label="Created" value={formatFullDate(order.createdAt)} />
        <DetailRow
          label={isSell ? 'Wallet payout' : 'Provider amount'}
          value={formatMinorUnits(order.amountMinor)}
        />
        <DetailRow label="Billy fee" value={formatMinorUnits(order.feeMinor)} />
        <DetailRow
          label="Card value"
          value={`${(order.faceValueMinor / 100).toLocaleString('en-NG')} ${
            order.faceCurrency
          }${order.quantity > 1 ? ` × ${order.quantity}` : ''}`}
        />
        <DetailRow
          label="Delivery"
          value={
            isSell
              ? 'Wallet after approval'
              : order.fulfilmentAvailable
                ? 'Ready securely'
                : 'Waiting for provider'
          }
        />
      </View>

      {isPending ? (
        <View style={styles.stack}>
          <FeedbackBanner
            message={
              isSell
                ? 'No payout is created until provider approval. Refreshing checks the original order; it does not submit another card.'
                : 'Reserved funds stay protected while Billy reconciles the original provider order.'
            }
            tone="warning"
          />
          <AppButton
            icon="refresh"
            label="Check latest status"
            loading={refreshing}
            onPress={() => void refresh()}
          />
        </View>
      ) : null}

      {order.fulfilmentAvailable && !fulfilment ? (
        <View style={styles.stack}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Secure card details
          </Text>
          <Text style={[styles.sectionBody, { color: theme.colors.textMuted }]}>
            Enter your transaction PIN to decrypt the delivered code. Billy never
            stores these details in an owner-readable table.
          </Text>
          <TextField
            icon="keypad-outline"
            keyboardType="number-pad"
            label="Transaction PIN"
            maxLength={6}
            onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 digits"
            secureTextEntry
            value={pin}
          />
          <AppButton
            disabled={pin.length !== 6}
            icon="lock-open-outline"
            label="Reveal card details"
            loading={revealing}
            onPress={() => void reveal()}
          />
        </View>
      ) : null}

      {fulfilment ? (
        <FadeSlide style={styles.stack}>
          <View style={styles.revealHeading}>
            <View>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                Delivered details
              </Text>
              <Text style={[styles.sectionBody, { color: theme.colors.textMuted }]}>
                Keep these private.
              </Text>
            </View>
            <Ionicons color={theme.colors.success} name="shield-checkmark" size={24} />
          </View>
          {fulfilment.codes.map((code, index) => (
            <View
              key={`${code.cardNumber ?? code.claimUrl ?? 'code'}-${index}`}
              style={[
                styles.codeCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}>
              <Text style={[styles.codeTitle, { color: theme.colors.text }]}>
                Card {index + 1}
              </Text>
              {code.cardNumber ? (
                <SecretRow
                  label="Card number / code"
                  onCopy={() => void copy(code.cardNumber!, 'Card number')}
                  value={code.cardNumber}
                />
              ) : null}
              {code.pin ? (
                <SecretRow
                  label="PIN"
                  onCopy={() => void copy(code.pin!, 'PIN')}
                  value={code.pin}
                />
              ) : null}
              {code.claimUrl ? (
                <SecretRow
                  label="Claim link"
                  onCopy={() => void copy(code.claimUrl!, 'Claim link')}
                  value={code.claimUrl}
                />
              ) : null}
              {code.expiresAt ? (
                <DetailRow label="Expires" value={code.expiresAt} />
              ) : null}
            </View>
          ))}
          {copied ? (
            <FeedbackBanner message={`${copied} copied securely.`} tone="success" />
          ) : null}
        </FadeSlide>
      ) : null}

      {order.transactionId ? (
        <AppButton
          icon="receipt-outline"
          label="Open wallet transaction"
          onPress={() =>
            router.push({
              pathname: '/(app)/transaction/[id]',
              params: { id: order.transactionId! },
            })
          }
          variant="ghost"
        />
      ) : null}
      {error ? <FeedbackBanner message={error} tone="error" /> : null}
    </AppScreen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: theme.colors.text }]}>{value}</Text>
    </View>
  );
}

function SecretRow({
  label,
  onCopy,
  value,
}: {
  label: string;
  onCopy: () => void;
  value: string;
}) {
  const theme = useBillyTheme();
  return (
    <View style={styles.secret}>
      <View style={styles.secretCopy}>
        <Text style={[styles.secretLabel, { color: theme.colors.textMuted }]}>
          {label}
        </Text>
        <Text selectable style={[styles.secretValue, { color: theme.colors.text }]}>
          {value}
        </Text>
      </View>
      <ScalePressable
        accessibilityLabel={`Copy ${label}`}
        accessibilityRole="button"
        onPress={onCopy}
        style={[styles.copyButton, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name="copy-outline" size={18} />
      </ScalePressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bodySkeleton: {
    height: 300,
  },
  codeCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  codeTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '900',
  },
  content: {
    gap: spacing.lg,
  },
  copyButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  detailLabel: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  detailValue: {
    flex: 1.4,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  details: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  heroMessage: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 420,
    textAlign: 'center',
  },
  heroSkeleton: {
    height: 230,
  },
  heroTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  preview: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  previewText: {
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  revealHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  secret: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secretCopy: {
    flex: 1,
    gap: 4,
  },
  secretLabel: {
    fontFamily: typography.family,
    fontSize: 10,
  },
  secretValue: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionBody: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '900',
  },
  stack: {
    gap: spacing.md,
  },
});
