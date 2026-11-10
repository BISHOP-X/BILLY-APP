import Ionicons from '@expo/vector-icons/Ionicons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { CountryFlag } from '@/components/ui/country-flag';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { useAuth } from '@/features/auth/auth-provider';
import { createBillyOperationKey } from '@/features/services/idempotency';
import { invokeAction } from '@/features/services/supabase-service-repository';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';
import type {
  CommerceCatalog,
  CommerceDelivery,
  CommerceKind,
  CommerceOrder,
  CommerceProduct,
  CommerceQuote,
} from './domain';
import { GiftCardCheckout } from './gift-card-checkout';

const titles: Record<CommerceKind, string> = {
  gift_cards: 'Gift cards',
  airtime: 'Airtime',
  data: 'Data & bundles',
  electricity: 'Electricity',
};
export function CommerceScreen({ kind }: { kind: CommerceKind }) {
  const theme = useBillyTheme();
  const scrollRef = useRef<ScrollView>(null);
  const showStepFromTop = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  }, []);
  return (
    <AppScreen bottomSafe contentStyle={styles.content} scrollRef={scrollRef} testID={`commerce-${kind}`}>
      <ScreenHeader
        title={titles[kind]}
        subtitle={kind === 'gift_cards'
          ? 'Find a favourite. Send a little joy.'
          : 'Everyday essentials, wherever home is.'}
      />
      {kind !== 'gift_cards' ? <View style={[styles.intro, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons
          name={kind === 'electricity'
            ? 'flash-outline'
            : 'globe-outline'}
          color={theme.colors.brand}
          size={28}
        />
        <Text style={[styles.body, { color: theme.colors.text, flex: 1 }]}>
          Choose a country and service. You’ll see the full naira price before you pay.
        </Text>
      </View> : null}
      <CommerceJourney kind={kind} onStepChange={showStepFromTop} />
    </AppScreen>
  );
}

export function CommerceJourney({ kind, onStepChange }: { kind: CommerceKind; onStepChange?: () => void }) {
  const theme = useBillyTheme();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [country, setCountry] = useState('');
  const [page, setPage] = useState(1);
  const [countriesOpen, setCountriesOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [product, setProduct] = useState<CommerceProduct | null>(null);
  const [value, setValue] = useState('');
  const [recipient, setRecipient] = useState('');
  const [invoice, setInvoice] = useState('');
  const [quote, setQuote] = useState<CommerceQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<CommerceOrder | null>(null);
  const [delivery, setDelivery] = useState<CommerceDelivery | null>(null);
  const operationKey = useRef('');
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setDelivery(null);
    });
    return () => {
      mounted.current = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 180);
    return () => clearTimeout(timer);
  }, [search]);
  const catalog = useQuery({
    queryKey: ['commerce', user?.id, kind, 'catalog', country, debounced, page],
    queryFn: () =>
      invokeAction<CommerceCatalog>('commerce.catalog', { kind, country, query: debounced, page }),
    enabled: !!user,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const orders = useQuery({
    queryKey: ['commerce', user?.id, kind, 'orders'],
    queryFn: () => invokeAction<CommerceOrder[]>('commerce.orders', { kind }),
    enabled: !!user,
    refetchInterval: (query) =>
      query.state.data?.some((o) => o.status === 'pending') ? 15_000 : false,
  });
  function reset() {
    setProduct(null);
    setQuote(null);
    setError('');
    setOrder(null);
    setDelivery(null);
    operationKey.current = '';
  }
  async function refresh(current: CommerceOrder) {
    const next = await invokeAction<CommerceOrder>('commerce.refresh', { orderId: current.id });
    if (mounted.current) setOrder(next);
    void cache.invalidateQueries({ queryKey: ['commerce', user?.id, kind, 'orders'] });
    void cache.invalidateQueries({ queryKey: ['main'] });
    return next;
  }
  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    let inFlight = false;
    const update = () => {
      if (inFlight || AppState.currentState === 'background') return;
      inFlight = true;
      void refresh(order).catch(() => {}).finally(() => {
        inFlight = false;
      });
    };
    const timer = setInterval(update, 15_000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
    // Refresh is intentionally tied to this order, not transient form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status]);
  async function run(work: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'This request could not be completed.');
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const text = { color: theme.colors.text };
  const muted = { color: theme.colors.textMuted };
  const panel = { backgroundColor: theme.colors.surface, borderColor: theme.colors.border };
  if (order) {
    return (
      <View style={styles.content}>
        <View style={[styles.panel, panel]}>
          <Ionicons
            name={order.status === 'succeeded'
              ? 'checkmark-circle-outline'
              : order.status === 'failed'
              ? 'close-circle-outline'
              : 'time-outline'}
            size={40}
            color={order.status === 'failed' ? theme.colors.danger : theme.colors.brand}
          />
          <Text style={[styles.heading, text]}>
            {order.status === 'succeeded'
              ? 'All done'
              : order.status === 'failed'
              ? 'Payment refunded'
              : 'Payment processing'}
          </Text>
          <Text style={[styles.body, muted]}>{order.title}</Text>
          <Text style={[styles.total, text]}>
            {formatMinorUnits(order.amount_minor + order.fee_minor)}
          </Text>
          <Text style={[styles.body, muted]}>{order.status_message}</Text>
          {order.status === 'pending'
            ? (
              <Text style={[styles.body, muted]}>
                You can leave this page. Your order will stay in your history.
              </Text>
            )
            : null}
          {order.status === 'pending' ||
              (order.status === 'succeeded' && kind === 'gift_cards' && !order.fulfilment_available)
            ? (
              <AppButton
                variant='secondary'
                label='Check status'
                loading={busy}
                onPress={() =>
                  void run(async () => {
                    await refresh(order);
                  })}
              />
            )
            : null}
          {order.fulfilment_available
            ? (
              <AppButton
                label='View delivery'
                loading={busy}
                onPress={() =>
                  void run(async () => {
                    setDelivery(
                      await invokeAction<CommerceDelivery>('commerce.reveal', {
                        orderId: order.id,
                      }),
                    );
                  })}
              />
            )
            : null}
        </View>
        {delivery
          ? (
            <View style={[styles.panel, panel]}>
              <Text style={[styles.heading, text]}>Your delivery</Text>
              {delivery.codes.map((code, index) => (
                <View key={index} style={styles.content}>
                  {code.number
                    ? <Text selectable style={[styles.code, text]}>Card: {code.number}</Text>
                    : null}
                  {code.pin
                    ? <Text selectable style={[styles.code, text]}>Code: {code.pin}</Text>
                    : null}
                  {code.info ? <Text style={[styles.body, muted]}>{code.info}</Text> : null}
                  <AppButton
                    variant='secondary'
                    label='Copy details'
                    onPress={() =>
                      void Clipboard.setStringAsync(
                        [code.number, code.pin, code.url].filter(Boolean).join('\n'),
                      )}
                  />
                  {/^https:\/\//i.test(code.url)
                    ? (
                      <AppButton
                        variant='ghost'
                        label='Open redemption link'
                        onPress={() => void Linking.openURL(code.url)}
                      />
                    )
                    : null}
                </View>
              ))}
              {delivery.instructions
                ? <Text style={[styles.body, muted]}>{delivery.instructions}</Text>
                : null}
            </View>
          )
          : null}
        {error ? <FeedbackBanner tone='error' message={error} /> : null}
        <AppButton variant='secondary' label='Back to browse' onPress={reset} />
      </View>
    );
  }
  if (product && kind === 'gift_cards') {
    return <GiftCardCheckout key={product.selectionToken} product={product} onBack={reset} onPurchased={(next) => {
      setOrder(next);
      onStepChange?.();
      void cache.invalidateQueries({ queryKey: ['commerce', user?.id, kind, 'orders'] });
      void cache.invalidateQueries({ queryKey: ['main'] });
    }} />;
  }
  if (product) {
    return (
      <View style={styles.content}>
        <AppButton
          variant='ghost'
          icon='arrow-back'
          label={quote ? 'Edit details' : 'Back to browse'}
          disabled={busy}
          onPress={() => quote ? (setQuote(null), setError('')) : reset()}
        />
        <View style={[styles.panel, panel]}>
          <ProductLogo product={product} />
          <Text style={[styles.heading, text]}>{product.name}</Text>
          <Text style={[styles.body, muted]}>
            {product.global ? 'Global' : product.countryName}
            {kind === 'gift_cards' && !product.global ? ' · Redeem in this region only' : ''}
          </Text>
          {product.instructions
            ? <Text style={[styles.body, muted]}>{product.instructions}</Text>
            : null}
        </View>
        {!quote
          ? (
            <>
              {product.regions.length
                ? (
                  <View style={styles.content}>
                    <Text style={[styles.label, text]}>Recipient’s region</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.filters}
                    >
                      {product.regions.map((region) => (
                        <AppButton
                          key={region}
                          variant={product.region === region ? 'primary' : 'secondary'}
                          label={region}
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              const next = await invokeAction<CommerceProduct>('commerce.product', {
                                selectionToken: product.selectionToken,
                                region,
                              });
                              setProduct(next);
                              onStepChange?.();
                              setValue('');
                            })}
                        />
                      ))}
                    </ScrollView>
                  </View>
                )
                : null}
              {product.values.length
                ? (
                  <View style={styles.content}>
                    <Text style={[styles.label, text]}>Choose a value</Text>
                    {product.values.map((v) => (
                      <Pressable
                        key={v.value}
                        accessibilityRole='radio'
                        accessibilityState={{ checked: value === v.value, disabled: busy }}
                        disabled={busy}
                        onPress={() => setValue(v.value)}
                        style={[
                          styles.choice,
                          panel,
                          value === v.value &&
                          {
                            borderColor: theme.colors.brand,
                            backgroundColor: theme.colors.brandMist,
                          },
                        ]}
                      >
                        <Text style={[styles.body, text]}>{v.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )
                : (
                  <TextField
                    label={`Amount (${product.currency})`}
                    disabled={busy}
                    keyboardType='decimal-pad'
                    value={value}
                    onChangeText={setValue}
                    placeholder={`${product.min} – ${product.max}`}
                  />
                )}
              <Text style={[styles.caption, muted]}>
                Available: {product.currency} {product.min} – {product.max}. Payment is in NGN.
              </Text>
              {kind !== 'gift_cards' || product.userIdRequired
                ? (
                  <TextField
                    label={product.userIdRequired
                      ? 'Player / user ID'
                      : kind === 'electricity'
                      ? 'Meter or account number'
                      : product.emailRequired
                      ? 'Recipient email'
                      : 'Phone number with country code'}
                    value={recipient}
                    disabled={busy}
                    onChangeText={setRecipient}
                    autoCapitalize='none'
                    keyboardType={product.emailRequired
                      ? 'email-address'
                      : product.userIdRequired
                      ? 'default'
                      : 'phone-pad'}
                    placeholder={kind === 'electricity'
                      ? 'Enter carefully'
                      : product.emailRequired
                      ? 'name@example.com'
                      : '+234…'}
                  />
                )
                : null}
              {product.invoiceRequired
                ? <TextField label='Invoice number' value={invoice} disabled={busy} onChangeText={setInvoice} />
                : null}
              {kind === 'electricity'
                ? (
                  <Text style={[styles.caption, muted]}>
                    Check the meter or account number carefully. This service does not confirm the
                    customer name before payment.
                  </Text>
                )
                : null}
              <AppButton
                label='Review price'
                loading={busy}
                disabled={!value || (!!product.regions.length && !product.region) ||
                  ((kind !== 'gift_cards' || product.userIdRequired) && !recipient)}
                onPress={() =>
                  void run(async () => {
                    const result = await invokeAction<CommerceQuote>('commerce.quote', {
                      selectionToken: product.selectionToken,
                      value,
                      recipient,
                      invoice,
                    });
                    operationKey.current = createBillyOperationKey('commerce');
                    setQuote(result);
                  })}
              />
            </>
          )
          : (
            <View style={[styles.panel, panel]}>
              <Text style={[styles.label, muted]}>TOTAL TO PAY</Text>
              <Text style={[styles.total, text]}>{formatMinorUnits(quote.totalMinor)}</Text>
              <Text style={[styles.body, muted]}>
                Value: {quote.faceCurrency} {quote.faceValue}
              </Text>
              {quote.delivery
                ? <Text style={[styles.body, text]}>Estimated delivery: {quote.delivery}</Text>
                : null}
              {recipient
                ? <Text selectable style={[styles.body, text]}>To: {recipient}</Text>
                : null}
              <Text style={[styles.caption, muted]}>
                Includes all fees. Price is held for 5 minutes.
              </Text>
              <AppButton
                label={`Pay ${formatMinorUnits(quote.totalMinor)}`}
                loading={busy}
                onPress={() =>
                  void run(async () => {
                    const result = await invokeAction<CommerceOrder>('commerce.purchase', {
                      quoteToken: quote.quoteToken,
                      idempotencyKey: operationKey.current,
                    });
                    setOrder(result);
                    void cache.invalidateQueries({
                      queryKey: ['commerce', user?.id, kind, 'orders'],
                    });
                    void cache.invalidateQueries({ queryKey: ['main'] });
                  })}
              />
              <Text style={[styles.caption, muted]}>
                If the connection drops, check order history before paying again.
              </Text>
            </View>
          )}
        {error ? <FeedbackBanner tone='error' message={error} /> : null}
      </View>
    );
  }
  return (
    <View style={styles.content}>
      <View style={styles.filters}>
        <View style={{ flex: 1 }}>
          <TextField
            label='Search'
            icon='search-outline'
            value={search}
            onChangeText={(s) => {
              setSearch(s);
              setPage(1);
            }}
            placeholder={kind === 'gift_cards' ? 'Find a brand' : 'Find a service'}
          />
        </View>
      </View>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Choose country'
        onPress={() => {
          setCountrySearch('');
          setCountriesOpen(true);
        }}
        style={[styles.country, panel]}
      >
        <CountryFlag code={country} name={catalog.data?.countries.find((c) => c.code === country)?.name} />
        <Text style={[styles.label, text, { flex: 1 }]}>
          {country
            ? catalog.data?.countries.find((c) => c.code === country)?.name || country
            : 'All countries'}
        </Text>
        <Ionicons name='chevron-down' color={theme.colors.textMuted} size={18} />
      </Pressable>
      {catalog.isError
        ? <FeedbackBanner tone='error' message='The catalogue couldn’t load. Please try again.' />
        : null}
      {catalog.isError
        ? <AppButton variant='secondary' label='Try again' onPress={() => void catalog.refetch()} />
        : null}
      {catalog.isLoading
        ? (
          <>
            <SkeletonBlock style={{ height: 110 }} />
            <SkeletonBlock style={{ height: 110 }} />
          </>
        )
        : null}
      {busy ? <Text style={[styles.caption, muted]}>Loading values…</Text> : null}
      {error ? <FeedbackBanner tone='error' message={error} /> : null}
      <Text style={[styles.caption, muted]}>
        {catalog.data ? `${catalog.data.total.toLocaleString()} choices` : 'Loading choices…'}
        {catalog.isFetching && !catalog.isLoading ? ' · Updating…' : ''}
      </Text>
      {catalog.data?.products.map((p) => (
        <Pressable
          key={p.selectionToken}
          accessibilityRole='button'
          accessibilityLabel={`Choose ${p.name}`}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              const full = await invokeAction<CommerceProduct>('commerce.product', {
                selectionToken: p.selectionToken,
              });
              setProduct(full);
              onStepChange?.();
              setValue(full.values[0]?.value || '');
              setRecipient('');
              setInvoice('');
            })}
          style={[styles.product, panel]}
        >
          <ProductLogo product={p} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.label, text]}>{p.name}</Text>
            <Text style={[styles.caption, muted]}>{p.countryName}</Text>
            <Text style={[styles.caption, { color: theme.colors.brand }]}>
              {p.currency} {p.min}
              {p.min !== p.max ? ` – ${p.max}` : ''}
            </Text>
          </View>
          <Ionicons name='chevron-forward' color={theme.colors.textMuted} size={18} />
        </Pressable>
      ))}
      {catalog.data && !catalog.data.products.length
        ? <Text style={[styles.body, muted]}>No matches. Try another country or search.</Text>
        : null}
      {catalog.data && catalog.data.pages > 1
        ? (
          <View style={styles.filters}>
            <AppButton
              variant='secondary'
              label='Previous'
              disabled={page === 1 || catalog.isFetching}
              onPress={() => setPage((p) => p - 1)}
            />
            <Text style={[styles.caption, muted]}>{page} / {catalog.data.pages}</Text>
            <AppButton
              variant='secondary'
              label='Next'
              disabled={page >= catalog.data.pages || catalog.isFetching}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
        )
        : null}
      {orders.data?.length
        ? (
          <View style={styles.content}>
            <Text style={[styles.heading, text]}>Recent orders</Text>
            {orders.data.map((o) => (
              <Pressable
                key={o.id}
                accessibilityRole='button'
                onPress={() => {
                  setOrder(o);
                  setDelivery(null);
                  setError('');
                }}
                style={[styles.choice, panel]}
              >
                <Text style={[styles.label, text]}>{o.title}</Text>
                <Text style={[styles.caption, muted]}>
                  {formatMinorUnits(o.amount_minor + o.fee_minor)} · {o.status === 'failed'
                    ? 'Failed · refunded'
                    : o.status === 'succeeded'
                    ? 'Completed'
                    : 'Processing'}
                </Text>
              </Pressable>
            ))}
          </View>
        )
        : null}
      <Modal
        visible={countriesOpen}
        transparent
        animationType='slide'
        onRequestClose={() => setCountriesOpen(false)}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={[styles.sheet, panel]}>
            <View style={styles.filters}>
              <Text style={[styles.heading, text, { flex: 1 }]}>Choose a country</Text>
              <AppButton variant='ghost' label='Close' onPress={() => setCountriesOpen(false)} />
            </View>
            <TextField
              label='Find country'
              value={countrySearch}
              onChangeText={setCountrySearch}
              autoCapitalize='none'
            />
            <ScrollView keyboardShouldPersistTaps='handled'>
              {[{ code: '', name: 'All countries' }, ...(catalog.data?.countries ?? [])].filter(
                (c) => c.name.toLowerCase().includes(countrySearch.toLowerCase()),
              ).map((c) => (
                <Pressable
                  key={c.code}
                  accessibilityRole='button'
                  onPress={() => {
                    setCountry(c.code);
                    setPage(1);
                    setCountriesOpen(false);
                  }}
                  accessibilityLabel={c.name}
                  accessibilityState={{ selected: country === c.code }}
                  style={[styles.choice, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}
                >
                  <CountryFlag code={c.code} name={c.name} />
                  <Text style={[styles.body, text, { flex: 1 }]}>{c.name}</Text>
                  {country === c.code ? <Ionicons name='checkmark' size={20} color={theme.colors.brand} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
function ProductLogo({ product }: { product: CommerceProduct }) {
  const theme = useBillyTheme();
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.logo, { backgroundColor: theme.dark ? '#F2F5F3' : '#FFFFFF' }]}>
      {product.image && !failed
        ? (
          <Image
            source={{ uri: product.image }}
            style={{ width: 48, height: 48 }}
            contentFit='contain'
            onError={() => setFailed(true)}
            accessibilityLabel={`${product.name} logo`}
          />
        )
        : (
          <Ionicons
            name={product.kind === 'gift_cards'
              ? 'gift-outline'
              : product.kind === 'electricity'
              ? 'flash-outline'
              : 'phone-portrait-outline'}
            color='#17643F'
            size={27}
          />
        )}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  intro: {
    padding: spacing.lg,
    borderRadius: radii.xl,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  panel: { padding: spacing.lg, borderRadius: radii.xl, borderWidth: 1, gap: spacing.md },
  body: { fontFamily: typography.family, fontSize: 14, lineHeight: 22 },
  heading: { fontFamily: typography.familyRounded, fontSize: 22, fontWeight: '800' },
  label: { fontFamily: typography.familyRounded, fontSize: 15, fontWeight: '700' },
  caption: { fontFamily: typography.family, fontSize: 12, lineHeight: 19 },
  total: { fontFamily: typography.familyRounded, fontSize: 32, fontWeight: '800' },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  country: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
  },
  product: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 100,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  choice: {
    minHeight: 50,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 6,
  },
  code: { fontFamily: typography.family, fontSize: 17, lineHeight: 26 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '85%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    paddingBottom: 32,
    gap: spacing.md,
  },
});
