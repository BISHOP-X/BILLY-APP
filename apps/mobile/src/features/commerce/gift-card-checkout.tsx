import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/button';
import { CountryFlag } from '@/components/ui/country-flag';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { useDashboardQuery } from '@/features/main/queries';
import { createBillyOperationKey } from '@/features/services/idempotency';
import { invokeAction } from '@/features/services/supabase-service-repository';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';
import type { CommerceOrder, CommerceProduct, CommerceQuote } from './domain';

const PAGE_SIZE = 6;
type PricePreview = { value: string; totalMinor: number };
export function GiftCardCheckout({ product, onBack, onPurchased }: {
  product: CommerceProduct;
  onBack: () => void;
  onPurchased: (order: CommerceOrder) => void;
}) {
  const theme = useBillyTheme();
  const insets = useSafeAreaInsets();
  const dashboard = useDashboardQuery();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [customValue, setCustomValue] = useState('');
  const [debouncedValue, setDebouncedValue] = useState('');
  const [selected, setSelected] = useState('');
  const [recipient, setRecipient] = useState('');
  const [open, setOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [quote, setQuote] = useState<CommerceQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const operationKey = useRef('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(customValue.trim()), 350);
    return () => clearTimeout(timer);
  }, [customValue]);
  useEffect(() => {
    if (!quote || !open) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [quote, open]);
  const validCustom = /^\d+(?:\.\d{1,6})?$/.test(debouncedValue) &&
    Number(debouncedValue) >= Number(product.min) &&
    Number(debouncedValue) <= Number(product.max);
  const customPrice = useQuery({
    queryKey: [
      'commerce',
      'gift-value-price',
      product.selectionToken,
      debouncedValue,
    ],
    queryFn: () =>
      invokeAction<PricePreview>('commerce.price', {
        selectionToken: product.selectionToken,
        value: debouncedValue,
      }),
    enabled: !product.values.length && validCustom,
    staleTime: 30_000,
    retry: 1,
  });
  const currentCustomPrice = customValue.trim() === debouncedValue && validCustom
    ? customPrice.data
    : undefined;
  const filtered = product.values.filter((v) =>
    `${product.currency} ${v.value}`.toLowerCase().includes(
      search.trim().toLowerCase(),
    )
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const prices = new Map(
    product.valuePrices?.map((v) => [v.value, v.totalMinor]),
  );
  const previewTotal = prices.get(selected) ??
    (currentCustomPrice?.value === selected ? currentCustomPrice.totalMinor : undefined);
  const balance = dashboard.data?.wallet?.availableMinor;
  const total = quote?.totalMinor ?? previewTotal;
  const insufficient = balance !== undefined && total !== undefined &&
    balance < total;
  const expired = !!quote && now >= Date.parse(quote.expiresAt);
  const text = { color: theme.colors.text };
  const muted = { color: theme.colors.textMuted };
  const panel = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  };

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function prepare(value: string, playerId: string) {
    await run(async () => {
      const result = await invokeAction<CommerceQuote>('commerce.quote', {
        selectionToken: product.selectionToken,
        value,
        recipient: playerId,
        invoice: '',
      });
      if (!mounted.current) return;
      operationKey.current = createBillyOperationKey('commerce');
      setQuote(result);
      setNow(Date.now());
    });
  }
  function choose(value: string) {
    if (inFlight.current) return;
    // A lost purchase response must reuse its original quote/key, never start a second payment.
    if (attempted) {
      setOpen(true);
      return;
    }
    setSelected(value);
    setQuote(null);
    setError('');
    setOpen(true);
    if (!product.userIdRequired) void prepare(value, '');
  }
  function close() {
    if (!inFlight.current) setOpen(false);
  }
  function pay() {
    if (!quote || inFlight.current || insufficient) return;
    if (expired && !attempted) {
      void prepare(selected, recipient);
      return;
    }
    setAttempted(true);
    void run(async () => {
      const result = await invokeAction<CommerceOrder>('commerce.purchase', {
        quoteToken: quote.quoteToken,
        idempotencyKey: operationKey.current,
      });
      if (mounted.current) {
        setOpen(false);
        onPurchased(result);
      }
    });
  }
  return (
    <View style={styles.stack}>
      <AppButton
        variant='ghost'
        icon='arrow-back'
        label='Back to gift cards'
        disabled={busy}
        onPress={onBack}
      />
      <View style={[styles.product, panel]}>
        {product.image
          ? (
            <Image
              source={{ uri: product.image }}
              contentFit='contain'
              style={styles.logo}
              accessibilityLabel={`${product.name} logo`}
            />
          )
          : (
            <Ionicons
              name='gift-outline'
              size={36}
              color={theme.colors.brand}
            />
          )}
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.heading, text]}>{product.name}</Text>
          <View style={styles.row}>
            <CountryFlag
              code={product.global ? '' : product.countryCode}
              name={product.countryName}
            />
            <Text style={[styles.caption, muted, { flex: 1 }]}>
              {product.global ? 'Global' : `${product.countryName} · Redeem here only`}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={[styles.heading, text, { flex: 1 }]}>Choose a value</Text>
        <Text style={[styles.caption, muted]}>{product.currency} → NGN</Text>
      </View>
      <Text style={[styles.caption, muted]}>
        Card value on top. Your naira total below, including fees.
      </Text>
      {attempted ? <AppButton label='Continue payment' onPress={() => setOpen(true)} /> : null}
      {product.values.length
        ? (
          <>
            {product.values.length > PAGE_SIZE
              ? (
                <TextField
                  label='Find a value'
                  icon='search-outline'
                  keyboardType='decimal-pad'
                  value={search}
                  onChangeText={(s) => {
                    setSearch(s);
                    setPage(0);
                  }}
                  placeholder={`Search ${product.currency} amount`}
                  disabled={busy || attempted}
                />
              )
              : null}
            <View style={styles.grid} testID='gift-value-grid'>
              {shown.map((v) => {
                const amount = prices.get(v.value);
                return (
                  <Pressable
                    key={v.value}
                    accessibilityRole='button'
                    accessibilityLabel={`${product.currency} ${v.value}, ${
                      amount === undefined ? 'price unavailable' : formatMinorUnits(amount)
                    }`}
                    accessibilityState={{
                      disabled: busy || attempted || amount === undefined,
                    }}
                    disabled={busy || attempted || amount === undefined}
                    onPress={() => choose(v.value)}
                    style={(
                      { pressed },
                    ) => [
                      styles.value,
                      panel,
                      pressed &&
                      {
                        borderColor: theme.colors.brand,
                        backgroundColor: theme.colors.brandMist,
                      },
                    ]}
                  >
                    <Text style={[styles.valueTitle, text]}>
                      {product.currency} {v.value}
                    </Text>
                    <Text style={[styles.price, { color: theme.colors.brand }]}>
                      {amount === undefined ? 'Price unavailable' : formatMinorUnits(amount)}
                    </Text>
                    <View style={styles.row}>
                      <Text style={[styles.caption, muted, { flex: 1 }]}>
                        Select value
                      </Text>
                      <Ionicons
                        name='arrow-forward'
                        size={16}
                        color={theme.colors.textMuted}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {!shown.length
              ? (
                <Text style={[styles.body, muted]}>
                  No matching value. Try another amount.
                </Text>
              )
              : null}
            {pages > 1
              ? (
                <View style={styles.row}>
                  <AppButton
                    label='Previous'
                    variant='ghost'
                    disabled={page === 0 || busy || attempted}
                    onPress={() => setPage((p) => p - 1)}
                  />
                  <Text style={[styles.caption, muted]}>
                    {page + 1} / {pages}
                  </Text>
                  <AppButton
                    label='Next'
                    variant='ghost'
                    disabled={page + 1 >= pages || busy || attempted}
                    onPress={() => setPage((p) => p + 1)}
                  />
                </View>
              )
              : null}
          </>
        )
        : (
          <View style={[styles.box, panel]}>
            <TextField
              label={`Card value (${product.currency})`}
              value={customValue}
              onChangeText={setCustomValue}
              keyboardType='decimal-pad'
              disabled={busy || attempted}
              placeholder={`${product.min} – ${product.max}`}
            />
            <Text style={[styles.caption, muted]}>
              Choose {product.currency} {product.min} – {product.max}.
            </Text>
            <Text
              accessibilityLiveRegion='polite'
              style={[styles.valueTitle, text]}
            >
              {currentCustomPrice
                ? formatMinorUnits(currentCustomPrice.totalMinor)
                : customValue
                ? 'Enter an available amount to see your naira price.'
                : 'Your naira total appears here.'}
            </Text>
            {validCustom && customPrice.isFetching
              ? (
                <ActivityIndicator
                  color={theme.colors.brand}
                  accessibilityLabel='Calculating naira price'
                />
              )
              : null}
            {customPrice.isError
              ? (
                <FeedbackBanner
                  tone='error'
                  message='We couldn’t load this price. Please try again.'
                />
              )
              : null}
            <AppButton
              label='Continue'
              disabled={!currentCustomPrice || busy || attempted}
              onPress={() => choose(customValue.trim())}
            />
          </View>
        )}
      {product.instructions
        ? (
          <View>
            <Pressable
              accessibilityRole='button'
              accessibilityState={{ expanded: instructionsOpen }}
              onPress={() => setInstructionsOpen((v) => !v)}
              style={styles.row}
            >
              <Text style={[styles.body, text]}>How to redeem</Text>
              <Ionicons
                name={instructionsOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.colors.textMuted}
              />
            </Pressable>
            {instructionsOpen
              ? (
                <Text style={[styles.caption, muted, { paddingTop: 8 }]}>
                  {product.instructions}
                </Text>
              )
              : null}
          </View>
        )
        : null}
      <Modal
        visible={open}
        transparent
        animationType='slide'
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.backdrop}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel='Close payment review'
            accessibilityRole='button'
            disabled={busy}
            onPress={close}
          />
          <View
            accessibilityViewIsModal
            style={[styles.sheet, panel, {
              paddingBottom: Math.max(20, insets.bottom),
            }]}
          >
            <View style={styles.row}>
              <Text
                accessibilityRole='header'
                style={[styles.heading, text, { flex: 1 }]}
              >
                Review payment
              </Text>
              <AppButton
                label='Close'
                variant='ghost'
                disabled={busy}
                onPress={close}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps='handled'
              contentContainerStyle={styles.stack}
              style={{ flexShrink: 1 }}
            >
              <Text style={[styles.body, text]}>
                {product.name} · {product.currency} {selected}
              </Text>
              <View
                style={[styles.box, {
                  backgroundColor: theme.colors.brandMist,
                }]}
              >
                <Text style={[styles.caption, muted]}>TOTAL TO PAY</Text>
                <Text style={[styles.total, text]}>
                  {total === undefined ? 'Checking price…' : formatMinorUnits(total)}
                </Text>
                <Text style={[styles.caption, muted]}>
                  Includes all fees · Paid from your Billy wallet
                </Text>
              </View>
              {product.userIdRequired
                ? (
                  <TextField
                    label='Player / user ID'
                    value={recipient}
                    disabled={busy || attempted}
                    onChangeText={(v) => {
                      setRecipient(v);
                      setQuote(null);
                      setError('');
                    }}
                    autoCapitalize='none'
                  />
                )
                : null}
              <View style={styles.row}>
                <Text style={[styles.body, muted]}>Wallet balance</Text>
                <Text style={[styles.body, text]}>
                  {balance === undefined
                    ? 'Checked securely at payment'
                    : formatMinorUnits(balance)}
                </Text>
              </View>
              {quote && balance !== undefined && !insufficient
                ? (
                  <View style={styles.row}>
                    <Text style={[styles.caption, muted]}>
                      Balance after payment
                    </Text>
                    <Text style={[styles.caption, text]}>
                      {formatMinorUnits(balance - quote.totalMinor)}
                    </Text>
                  </View>
                )
                : null}
              {quote && previewTotal !== undefined &&
                  quote.totalMinor !== previewTotal
                ? (
                  <FeedbackBanner message='The price updated. Review the total above before paying.' />
                )
                : null}
              {insufficient
                ? (
                  <FeedbackBanner
                    tone='error'
                    message='Your wallet needs a little more. Add money to continue.'
                  />
                )
                : null}
              {error ? <FeedbackBanner tone='error' message={error} /> : null}
              {attempted && error
                ? (
                  <Text style={[styles.caption, muted]}>
                    Check your orders before starting another payment. Retrying here uses the same
                    payment reference.
                  </Text>
                )
                : null}
            </ScrollView>
            {insufficient && !attempted
              ? (
                <AppButton
                  label='Add money'
                  disabled={busy}
                  onPress={() => {
                    close();
                    router.push('/(app)/wallet/add-money');
                  }}
                />
              )
              : quote
              ? (
                <AppButton
                  label={expired && !attempted
                    ? 'Refresh price'
                    : `Pay ${formatMinorUnits(quote.totalMinor)}`}
                  loading={busy}
                  onPress={pay}
                />
              )
              : (
                <AppButton
                  label={busy ? 'Checking price' : 'Review price'}
                  loading={busy}
                  disabled={product.userIdRequired && !recipient.trim()}
                  onPress={() => void prepare(selected, recipient)}
                />
              )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  product: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logo: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#FFFFFF' },
  heading: {
    fontFamily: typography.familyRounded,
    fontWeight: '800',
    fontSize: 20,
  },
  body: { fontFamily: typography.family, fontSize: 14, lineHeight: 22 },
  caption: { fontFamily: typography.family, fontSize: 12, lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  value: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 130,
    padding: 14,
    borderWidth: 1,
    borderRadius: radii.lg,
    gap: 8,
  },
  valueTitle: {
    fontFamily: typography.familyRounded,
    fontWeight: '800',
    fontSize: 20,
  },
  price: {
    fontFamily: typography.familyRounded,
    fontWeight: '700',
    fontSize: 16,
  },
  box: { borderWidth: 0, borderRadius: radii.lg, padding: 16, gap: 10 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 18,
  },
  total: {
    fontFamily: typography.familyRounded,
    fontWeight: '800',
    fontSize: 32,
  },
});
