import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { TextField } from '@/components/ui/text-field';
import { createBillyOperationKey } from '@/features/services/idempotency';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

import type {
  BuyCardCatalog,
  BuyCardProduct,
  BuyCardQuote,
  CardServiceKey,
  PrestmitOrder,
} from '../domain';
import { prestmitRepository } from '../repository';
import { usePrestmitMutation } from '../queries';
import { CardProductTile } from './card-product-tile';

function parseFaceValue(value: string) {
  const normalized = value.trim().replaceAll(',', '');
  if (!/^\d{1,9}(?:\.\d{0,2})?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function faceMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('en-NG', {
    currency,
    maximumFractionDigits: 2,
    style: 'currency',
  }).format(amountMinor / 100);
}

export function BuyCardJourney({
  catalog,
  onCompleted,
  service,
}: {
  catalog: BuyCardCatalog;
  onCompleted: (order: PrestmitOrder) => void;
  service: CardServiceKey;
}) {
  const theme = useBillyTheme();
  const purchase = usePrestmitMutation(service);
  const [product, setProduct] = useState<BuyCardProduct | null>(null);
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [quote, setQuote] = useState<BuyCardQuote | null>(null);
  const [pin, setPin] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseProduct(value: BuyCardProduct) {
    setProduct(value);
    setAmount((value.minimumFaceValueMinor / 100).toString());
    setQuantity(1);
    setQuote(null);
    setPin('');
    setError(null);
  }

  async function createQuote() {
    if (!product) return;
    const faceValueMinor = parseFaceValue(amount);
    if (
      faceValueMinor === null ||
      faceValueMinor < product.minimumFaceValueMinor ||
      faceValueMinor > product.maximumFaceValueMinor
    ) {
      setError(
        `Enter ${faceMoney(
          product.minimumFaceValueMinor,
          product.currencyCode,
        )} to ${faceMoney(product.maximumFaceValueMinor, product.currencyCode)}.`,
      );
      return;
    }
    setQuoting(true);
    setError(null);
    try {
      setQuote(
        await prestmitRepository.quoteBuy({
          faceValueMinor,
          quantity,
          selectionToken: product.selectionToken,
          service,
        }),
      );
    } catch (quoteError) {
      setError(
        quoteError instanceof Error
          ? quoteError.message
          : 'Billy could not load the current card price.',
      );
    } finally {
      setQuoting(false);
    }
  }

  async function confirm() {
    if (!quote) return;
    setError(null);
    try {
      const order = await purchase.mutateAsync({
        idempotencyKey: createBillyOperationKey(
          service === 'prepaid_cards' ? 'prepaid' : 'giftcard-buy',
        ),
        pin,
        quoteId: quote.quoteId,
        service,
      });
      onCompleted(order);
    } catch (purchaseError) {
      setError(
        purchaseError instanceof Error
          ? purchaseError.message
          : 'Billy could not complete this order safely.',
      );
    }
  }

  if (!product) {
    return (
      <FadeSlide style={styles.stack}>
        {catalog.isPreview ? (
          <FeedbackBanner
            message="These are synthetic tester products. Live products and prices will come from the provider when activated."
            tone="warning"
          />
        ) : null}
        {catalog.products.length ? (
          catalog.products.map((entry) => (
            <CardProductTile
              key={entry.selectionToken}
              onPress={() => chooseProduct(entry)}
              product={entry}
            />
          ))
        ) : (
          <FeedbackBanner
            message="No current card products were returned. Billy will not invent a catalog."
            tone="warning"
          />
        )}
      </FadeSlide>
    );
  }

  return (
    <FadeSlide style={styles.stack}>
      <ScalePressable
        accessibilityLabel="Choose a different product"
        accessibilityRole="button"
        onPress={() => setProduct(null)}
        style={styles.back}>
        <Ionicons color={theme.colors.brand} name="arrow-back" size={18} />
        <Text style={[styles.backText, { color: theme.colors.brand }]}>
          All products
        </Text>
      </ScalePressable>

      <View
        style={[
          styles.selected,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}>
        <View style={[styles.brand, { backgroundColor: theme.colors.brandMist }]}>
          <Text style={[styles.brandLetter, { color: theme.colors.brand }]}>
            {product.brand.slice(0, 1)}
          </Text>
        </View>
        <View style={styles.selectedCopy}>
          <Text style={[styles.selectedTitle, { color: theme.colors.text }]}>
            {product.title}
          </Text>
          <Text style={[styles.selectedMeta, { color: theme.colors.textMuted }]}>
            {product.regions[0] ?? 'Provider region'} · {product.currencyCode}
          </Text>
        </View>
      </View>

      {!quote ? (
        <>
          <TextField
            icon="cash-outline"
            keyboardType="decimal-pad"
            label={`Card value (${product.currencyCode})`}
            onChangeText={setAmount}
            placeholder={(product.minimumFaceValueMinor / 100).toString()}
            value={amount}
          />
          <View style={styles.quantityBlock}>
            <Text style={[styles.label, { color: theme.colors.text }]}>Quantity</Text>
            <View style={styles.quantityRow}>
              <ScalePressable
                accessibilityLabel="Decrease quantity"
                accessibilityRole="button"
                disabled={quantity === 1}
                onPress={() => setQuantity((value) => Math.max(1, value - 1))}
                style={[styles.quantityButton, { borderColor: theme.colors.border }]}>
                <Ionicons color={theme.colors.text} name="remove" size={20} />
              </ScalePressable>
              <Text style={[styles.quantity, { color: theme.colors.text }]}>
                {quantity}
              </Text>
              <ScalePressable
                accessibilityLabel="Increase quantity"
                accessibilityRole="button"
                disabled={quantity === 20}
                onPress={() => setQuantity((value) => Math.min(20, value + 1))}
                style={[styles.quantityButton, { borderColor: theme.colors.border }]}>
                <Ionicons color={theme.colors.text} name="add" size={20} />
              </ScalePressable>
            </View>
          </View>
          <AppButton
            icon="arrow-forward"
            label="Get current price"
            loading={quoting}
            onPress={() => void createQuote()}
          />
        </>
      ) : (
        <>
          <View
            style={[
              styles.review,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <Text style={[styles.reviewTitle, { color: theme.colors.text }]}>
              Review order
            </Text>
            <ReviewRow
              label="Card value"
              value={`${faceMoney(quote.faceValueMinor, quote.faceCurrency)} × ${
                quote.quantity
              }`}
            />
            <ReviewRow label="Provider amount" value={formatMinorUnits(quote.amountMinor)} />
            <ReviewRow label="Billy fee" value={formatMinorUnits(quote.feeMinor)} />
            <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
            <ReviewRow label="Total" strong value={formatMinorUnits(quote.totalMinor)} />
          </View>
          <TextField
            error={pin && !/^\d{0,6}$/.test(pin) ? 'Use digits only.' : undefined}
            icon="keypad-outline"
            keyboardType="number-pad"
            label="Transaction PIN"
            maxLength={6}
            onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 digits"
            secureTextEntry
            value={pin}
          />
          <FeedbackBanner
            message="Billy reserves the total first. A failed order releases it; an uncertain provider result remains pending for reconciliation."
            tone="info"
          />
          <AppButton
            disabled={pin.length !== 6}
            icon="shield-checkmark-outline"
            label="Confirm secure purchase"
            loading={purchase.isPending}
            onPress={() => void confirm()}
          />
          <AppButton
            label="Change amount"
            onPress={() => {
              setQuote(null);
              setPin('');
            }}
            variant="ghost"
          />
        </>
      )}
      {error ? <FeedbackBanner message={error} tone="error" /> : null}
    </FadeSlide>
  );
}

function ReviewRow({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  const theme = useBillyTheme();
  return (
    <View style={styles.reviewRow}>
      <Text style={[styles.reviewLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text
        style={[
          styles.reviewValue,
          { color: strong ? theme.colors.brand : theme.colors.text },
        ]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  backText: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  brand: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  brandLetter: {
    fontFamily: typography.familyRounded,
    fontSize: 24,
    fontWeight: '900',
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
  },
  quantity: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
    fontWeight: '900',
    minWidth: 36,
    textAlign: 'center',
  },
  quantityBlock: {
    gap: spacing.sm,
  },
  quantityButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 48,
  },
  quantityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  review: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  reviewLabel: {
    fontFamily: typography.family,
    fontSize: 13,
  },
  reviewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  reviewTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '900',
  },
  reviewValue: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  rule: {
    height: 1,
  },
  selected: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  selectedCopy: {
    flex: 1,
    gap: 4,
  },
  selectedMeta: {
    fontFamily: typography.family,
    fontSize: 11,
  },
  selectedTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '900',
  },
  stack: {
    gap: spacing.lg,
  },
});
