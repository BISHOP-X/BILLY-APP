import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusChip } from '@/components/ui/status-chip';
import { TextField } from '@/components/ui/text-field';
import type {
  SocialBoostInputKind,
  SocialBoostOrder,
  SocialBoostQuote,
  SocialBoostService,
} from '@/features/social-boost/domain';
import {
  useSocialBoostCancel,
  useSocialBoostFormCatalog,
  useSocialBoostOrders,
  useSocialBoostRefill,
  useSocialBoostRefills,
  useSocialBoostRefresh,
  useSocialBoostSubmit,
} from '@/features/social-boost/queries';
import { socialBoostRepository } from '@/features/social-boost/repository';
import { BoostPlatformIcon, BoostPlatformPicker } from '@/features/social-boost/platform-picker';
import { CatalogSelect } from '@/features/social-boost/catalog-select';
import { BoostSearchResults } from '@/features/social-boost/search-results';
import { boostServicePrice } from '@/features/social-boost/price-label';
import { boostOrderStatus } from '@/features/services/order-status';
import {
  isCompleteTransactionPin,
  normalizeTransactionPin,
  TRANSACTION_PIN_INPUT_MAX_LENGTH,
} from '@/features/security/transaction-pin';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

type FormState = {
  answerNumber: string;
  comments: string;
  groupLink: string;
  hashtags: string;
  intervalMinutes: string;
  keywords: string;
  quantity: string;
  runs: string;
  target: string;
  username: string;
  usernames: string;
};

const emptyForm: FormState = {
  answerNumber: '',
  comments: '',
  groupLink: '',
  hashtags: '',
  intervalMinutes: '',
  keywords: '',
  quantity: '',
  runs: '',
  target: '',
  username: '',
  usernames: '',
};

export default function SocialBoostScreen() {
  const theme = useBillyTheme();
  const [tab, setTab] = useState<'browse' | 'orders'>('browse');
  const [platform, setPlatform] = useState('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const searchText = search.trim();
  const deferredSearch = useDeferredValue(searchText.toLowerCase());
  const requestKey = useRef('');
  const formVersion = useRef(0);
  const refillKeys = useRef<Record<string,string>>({});
  const [feedback,setFeedback] = useState<{title:string;message:string;buttons?:{text:string;onPress?:()=>void;style?:string}[]}|null>(null);
  function notify(title:string,message:string,buttons?:{text:string;onPress?:()=>void;style?:string}[]) { setFeedback({title,message,buttons}); }
  const [selected, setSelected] = useState<SocialBoostService | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [quote, setQuote] = useState<SocialBoostQuote | null>(null);
  const [pin, setPin] = useState('');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const catalog = useSocialBoostFormCatalog();
  const orders = useSocialBoostOrders();
  const refills = useSocialBoostRefills();
  const submit = useSocialBoostSubmit();
  const refresh = useSocialBoostRefresh();
  const cancel = useSocialBoostCancel();
  const refill = useSocialBoostRefill();

  const catalogSummary = catalog.data;
  const platformServices = useMemo(() => (catalog.data?.services ?? []).filter(service =>
    platform === 'all' || service.platform === platform), [catalog.data, platform]);
  const categories = useMemo(() => [...new Set(platformServices.map(service => service.category))], [platformServices]);
  const services = useMemo(
    () => platformServices.filter((service) =>
      (searchText ? `${service.name} ${service.category} ${service.type} ${service.platform}`.toLowerCase().includes(deferredSearch)
        : !category || service.category === category)),
    [platformServices, category, deferredSearch, searchText],
  );
  const updatingSearch = deferredSearch !== searchText.toLowerCase() || catalog.isPending;
  const categoryOptions = useMemo(() => categories.map(name => ({ value: name, label: name })), [categories]);
  const serviceOptions = useMemo(() => !category || searchText ? [] : services.map(service => ({
    value: service.selectionToken, label: service.name,
    priceLabel: boostServicePrice(service),
    detail: `${service.minimumQuantity.toLocaleString()}–${service.maximumQuantity.toLocaleString()}${service.refillAvailable ? ' · Refill available' : ''}`,
  })), [category, searchText, services]);

  async function refreshPage() {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.all([catalog.refetch(), orders.refetch(), refills.refetch()]); }
    finally { setRefreshing(false); }
  }

  function resetSelection() {
    formVersion.current += 1;
    setSelected(null);
    setForm(emptyForm);
    setQuote(null);
    setPin('');
  }

  function patchForm(key: keyof FormState, value: string) {
    formVersion.current += 1;
    setForm((current) => ({ ...current, [key]: value }));
    setQuote(null);
    setPin('');
  }

  function selectService(service: SocialBoostService) {
    formVersion.current += 1;
    setSelected(service);
    setForm({
      ...emptyForm,
      quantity: String(service.minimumQuantity),
    });
    setQuote(null);
    setPin('');
  }

  async function getQuote() {
    if (!selected || quoteBusy) return;
    const requestedVersion = formVersion.current;
    const quantity = Number(form.quantity.replaceAll(',', ''));
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < selected.minimumQuantity ||
      quantity > selected.maximumQuantity
    ) {
      notify(
        'Check quantity',
        `Choose between ${selected.minimumQuantity.toLocaleString()} and ${selected.maximumQuantity.toLocaleString()}.`,
      );
      return;
    }
    setQuoteBusy(true);
    requestKey.current = `mobile-social-${Crypto.randomUUID()}`;
    try {
      const currentService = await catalog.freshService(selected.catalogKey);
      if (formVersion.current !== requestedVersion) return;
      setSelected(currentService);
      const nextQuote = await socialBoostRepository.quote(currentService.selectionToken, quantity);
      if (formVersion.current === requestedVersion) setQuote(nextQuote);
    } catch (error) {
      if (formVersion.current !== requestedVersion) return;
      notify(
        'Quote unavailable',
        error instanceof Error ? error.message : 'Please try again safely.',
      );
    } finally {
      setQuoteBusy(false);
    }
  }

  async function placeOrder() {
    if (!quote || submit.isPending) return;
    try {
      const parseOptionalInteger = (value: string) => {
        const parsed = Number(value);
        return value.trim() && Number.isSafeInteger(parsed) ? parsed : undefined;
      };
      const order = await submit.mutateAsync({
        answerNumber: parseOptionalInteger(form.answerNumber),
        comments: form.comments.trim() || undefined,
        groupLink: form.groupLink.trim() || undefined,
        hashtags: form.hashtags.trim() || undefined,
        idempotencyKey: requestKey.current,
        intervalMinutes: parseOptionalInteger(form.intervalMinutes),
        keywords: form.keywords.trim() || undefined,
        pin,
        quoteId: quote.quoteId,
        runs: parseOptionalInteger(form.runs),
        target: form.target.trim(),
        username: form.username.trim() || undefined,
        usernames: form.usernames.trim() || undefined,
      });
      notify('Order received', order.statusMessage);
      setSelected(null);
      setQuote(null);
      setPin('');
      setForm(emptyForm);
      setTab('orders');
    } catch (error) {
      notify(
        'Order stopped safely',
        error instanceof Error
          ? error.message
          : 'Billy did not create another order.',
      );
    }
  }

  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      onRefresh={() => void refreshPage()}
      refreshing={refreshing}
      testID="social-boost-screen"
    >
      <ScreenHeader
        subtitle="Choose a service. Grow your audience."
        title="Social Boost"
      />
      <DemoDataBanner />
      {feedback ? <View accessibilityLiveRegion="polite" style={[styles.quote,{backgroundColor:theme.colors.surface,borderColor:theme.colors.border}]}>
        <Text style={[styles.cardTitle,{color:theme.colors.text}]}>{feedback.title}</Text>
        <Text style={[styles.helper,{color:theme.colors.textMuted}]}>{feedback.message}</Text>
        {(feedback.buttons??[{text:'Dismiss'}]).map(button=><AppButton key={button.text} label={button.text} variant={button.style === 'destructive' ? 'danger' : 'ghost'} onPress={()=>{setFeedback(null);button.onPress?.();}}/>)}</View>:null}

      <View
        style={[
          styles.tabs,
          { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        {(['browse', 'orders'] as const).map((item) => (
          <ScalePressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item }}
            containerStyle={styles.tabContainer}
            key={item}
            onPress={() => setTab(item)}
            style={[
              styles.tab,
              tab === item && {
                backgroundColor: theme.colors.surface,
                ...shadows.card,
              },
            ]}
          >
            <Ionicons
              color={tab === item ? theme.colors.brand : theme.colors.textMuted}
              name={item === 'browse' ? 'search-outline' : 'time-outline'}
              size={18}
            />
            <Text
              style={[
                styles.tabText,
                {
                  color:
                    tab === item ? theme.colors.brand : theme.colors.textMuted,
                },
              ]}
            >
              {item === 'browse' ? 'New order' : 'My orders'}
            </Text>
          </ScalePressable>
        ))}
      </View>

      {tab === 'browse' ? (
        <FadeSlide style={styles.section}>
          <View style={[styles.orderForm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <BoostPlatformPicker
              platforms={catalogSummary?.platforms ?? []}
              selected={platform}
              onSelect={(value) => {
                if (value === platform) return;
                setPlatform(value); setCategory(''); resetSelection();
              }}
            />
            <TextField
              autoCapitalize="none"
              icon="search-outline"
              label="Search"
              maxLength={80}
              onChangeText={setSearch}
              placeholder="Search for a service"
              value={search}
            />
            {searchText ? <BoostSearchResults
              searchKey={`${platform}:${searchText}`}
              services={services}
              loading={updatingSearch && !catalog.isError}
              total={updatingSearch ? undefined : services.length}
              error={catalog.isError ? 'Search is unavailable. Your form is still here.' : undefined}
              onRetry={() => void catalog.refetch()}
              onSelect={(service) => {
                setSearch(''); setCategory(service.category); selectService(service);
              }}
            /> : null}
            {catalog.isError && !searchText ? (
              <StatePanel compact actionLabel="Try again" icon="cloud-offline-outline"
                title="Services unavailable" message={catalog.error.message}
                onAction={() => void catalog.refetch()} tone="danger" />
            ) : null}
            <CatalogSelect
              label="Category"
              placeholder="Choose a category"
              value={category}
              selectedLabel={category}
              loading={catalog.isPending}
              disabled={!categories.length || Boolean(searchText)}
              options={categoryOptions}
              onSelect={(value) => { if (value === category) return; setCategory(value); resetSelection(); }}
            />
            <CatalogSelect
              label="Service"
              placeholder={category ? 'Choose a service' : 'Choose a category first'}
              value={selected?.selectionToken ?? ''}
              selectedLabel={selected?.name}
              selectedPriceLabel={selected ? boostServicePrice(selected) : undefined}
              loading={catalog.isPending}
              disabled={!category || !services.length || Boolean(searchText)}
              options={serviceOptions}
              onSelect={(value) => { const service = services.find((item) => item.selectionToken === value); if (service) selectService(service); }}
            />
            {!searchText && !catalog.isPending && services.length === 0 ? (
              <Text style={[styles.helper, { color: theme.colors.textMuted }]}>No services match this search. Try another platform or phrase.</Text>
            ) : null}
            {selected ? (
              <OrderBuilder busy={quoteBusy} form={form} onChange={patchForm}
                onQuote={() => void getQuote()} selected={selected} />
            ) : (
              <>
                <TextField label="Link" placeholder="https://…" value="" disabled />
                <TextField label="Quantity" placeholder="Choose a service first" value="" disabled />
                <Text style={[styles.helper, { color: theme.colors.textMuted }]}>Choose your category and service to see limits and pricing.</Text>
              </>
            )}
          </View>

          {quote ? (
            <View
              style={[
                styles.quote,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.brand,
                },
              ]}
            >
              <View style={styles.quoteHeader}>
                <View>
                  <Text style={[styles.quoteEyebrow, { color: theme.colors.brand }]}>
                    CHARGE
                  </Text>
                  <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
                    Review your order
                  </Text>
                </View>
                <Ionicons
                  color={theme.colors.brand}
                  name="shield-checkmark-outline"
                  size={25}
                />
              </View>
              <QuoteRow label="Service" value={quote.productTitle} />
              <QuoteRow
                label="Quantity"
                value={quote.quantity.toLocaleString()}
              />
              <QuoteRow
                label="Service amount"
                value={formatMinorUnits(quote.amountMinor, 'NGN')}
              />
              <QuoteRow
                label="Billy fee"
                value={formatMinorUnits(quote.feeMinor, 'NGN')}
              />
              <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
              <QuoteRow
                label="Total"
                strong
                value={formatMinorUnits(quote.totalMinor, 'NGN')}
              />
              <TextField
                inputMode="numeric"
                label="Transaction PIN"
                maxLength={TRANSACTION_PIN_INPUT_MAX_LENGTH}
                onChangeText={(value) => setPin(normalizeTransactionPin(value))}
                placeholder="4 digits"
                secureTextEntry
                value={pin}
              />
              <AppButton
                disabled={!form.target.trim() || !isCompleteTransactionPin(pin)}
                icon="arrow-forward"
                label="Place order"
                loading={submit.isPending}
                onPress={() => void placeOrder()}
              />
              <AppButton
                label="Change quantity"
                onPress={() => {
                  setQuote(null);
                  setPin('');
                }}
                variant="ghost"
              />
            </View>
          ) : null}
        </FadeSlide>
      ) : (
        <OrdersPanel
          actionBusy={refresh.isPending || cancel.isPending || refill.isPending}
          onCancel={(order) => {
            notify(
              'Request cancellation?',
              'Cancellation depends on the order’s progress. Any confirmed refund goes to your wallet.',
              [
                { style: 'cancel', text: 'Keep order' },
                {
                  onPress: () =>
                    void cancel.mutateAsync(order.id).catch((error) =>
                      notify(
                        'Cancellation unavailable',
                        error instanceof Error
                          ? error.message
                          : 'Please try again later.',
                      ),
                    ),
                  style: 'destructive',
                  text: 'Request cancellation',
                },
              ],
            );
          }}
          onRefill={(order) =>
            void refill
              .mutateAsync({
                idempotencyKey: refillKeys.current[order.id] ?? (refillKeys.current[order.id]=`mobile-social-refill-${Crypto.randomUUID()}`),
                orderId: order.id,
              })
              .then((result) =>
                notify('Refill requested', result.statusMessage),
              )
              .catch((error) =>
                notify(
                  'Refill unavailable',
                  error instanceof Error
                    ? error.message
                    : 'Please try again later.',
                ),
              )
          }
          onRefresh={(order) =>
            void refresh
              .mutateAsync(order.id)
              .then((result) =>
                notify('Status refreshed', result.statusMessage),
              )
              .catch((error) =>
                notify(
                  'Status unavailable',
                  error instanceof Error
                    ? error.message
                    : 'Please try again later.',
                ),
              )
          }
          orders={orders.data ?? []}
          query={orders}
          refills={refills.data ?? []}
        />
      )}
    </AppScreen>
  );
}

function OrderBuilder({
  busy,
  form,
  onChange,
  onQuote,
  selected,
}: {
  busy: boolean;
  form: FormState;
  onChange: (key: keyof FormState, value: string) => void;
  onQuote: () => void;
  selected: SocialBoostService;
}) {
  const theme = useBillyTheme();
  const targetCopy = targetLabel(selected);
  return (
    <FadeSlide
      style={[
        styles.builder,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <TextField
        autoCapitalize="none"
        icon="link-outline"
        label={targetCopy.label === 'TikTok username' ? targetCopy.label : 'Link'}
        onChangeText={(value) => onChange('target', value)}
        placeholder={targetCopy.placeholder}
        value={form.target}
      />
      <Text style={[styles.helper, { color: theme.colors.textMuted }]}>
        {targetCopy.helper}
      </Text>
      <TextField
        inputMode="numeric"
        label="Quantity"
        onChangeText={(value) =>
          onChange('quantity', value.replace(/[^\d,]/g, ''))
        }
        placeholder={selected.minimumQuantity.toLocaleString()}
        value={form.quantity}
      />
      <Text style={[styles.helper, { color: theme.colors.textMuted }]}>
        Minimum {selected.minimumQuantity.toLocaleString()} · Maximum{' '}
        {selected.maximumQuantity.toLocaleString()}
      </Text>
      <DynamicFields
        form={form}
        inputKind={selected.inputKind}
        onChange={onChange}
      />
      {['comment likes','comment replies'].includes(selected.type.toLowerCase()) ? <TextField label="Comment author's username" value={form.username} autoCapitalize="none" onChangeText={value=>onChange('username',value)}/>:null}
      <AppButton
        disabled={!form.target.trim() || !form.quantity.trim()}
        icon="receipt-outline"
        label="Continue"
        loading={busy}
        onPress={onQuote}
      />
    </FadeSlide>
  );
}

function DynamicFields({
  form,
  inputKind,
  onChange,
}: {
  form: FormState;
  inputKind: SocialBoostInputKind;
  onChange: (key: keyof FormState, value: string) => void;
}) {
  if (inputKind === 'comments') {
    return (
      <TextField
        label="Comments — one per line"
        multiline
        numberOfLines={5}
        onChangeText={(value) => onChange('comments', value)}
        placeholder={'Great post!\nLove this update\nThanks for sharing'}
        style={styles.multiline}
        textAlignVertical="top"
        value={form.comments}
      />
    );
  }
  if (inputKind === 'usernames') {
    return (
      <TextField
        autoCapitalize="none"
        label="Usernames — one per line"
        multiline
        numberOfLines={5}
        onChangeText={(value) => onChange('usernames', value)}
        placeholder={'username_one\nusername_two'}
        style={styles.multiline}
        textAlignVertical="top"
        value={form.usernames}
      />
    );
  }
  if (inputKind === 'hashtags') {
    return (
      <>
      <TextField
        autoCapitalize="none"
        label="Hashtags"
        onChangeText={(value) => onChange('hashtags', value)}
        placeholder="#billy #growth"
        value={form.hashtags}
      />
      <TextField label="Usernames — one per line" value={form.usernames} multiline autoCapitalize="none" onChangeText={value=>onChange('usernames',value)}/>
      </>
    );
  }
  if (inputKind === 'poll') {
    return (
      <TextField
        inputMode="numeric"
        label="Poll answer number"
        onChangeText={(value) => onChange('answerNumber', value.replace(/\D/g, ''))}
        placeholder="1"
        value={form.answerNumber}
      />
    );
  }
  if (inputKind === 'seo') {
    return (
      <TextField
        label="Keywords"
        multiline
        numberOfLines={3}
        onChangeText={(value) => onChange('keywords', value)}
        placeholder="Comma-separated keywords"
        style={styles.multilineSmall}
        value={form.keywords}
      />
    );
  }
  if (inputKind === 'subscriptions') {
    return (
      <TextField
        autoCapitalize="none"
        label="Username"
        onChangeText={(value) => onChange('username', value)}
        placeholder="@username"
        value={form.username}
      />
    );
  }
  if (inputKind === 'group_invites') {
    return (
      <TextField
        autoCapitalize="none"
        label="Source group link"
        onChangeText={(value) => onChange('groupLink', value)}
        placeholder="https://…"
        value={form.groupLink}
      />
    );
  }
  return null;
}

function OrdersPanel({
  actionBusy,
  onCancel,
  onRefill,
  onRefresh,
  orders,
  query,
  refills,
}: {
  actionBusy: boolean;
  onCancel: (order: SocialBoostOrder) => void;
  onRefill: (order: SocialBoostOrder) => void;
  onRefresh: (order: SocialBoostOrder) => void;
  orders: SocialBoostOrder[];
  query: ReturnType<typeof useSocialBoostOrders>;
  refills: NonNullable<ReturnType<typeof useSocialBoostRefills>['data']>;
}) {
  const theme = useBillyTheme();
  if (query.isLoading) {
    return (
      <>
        <SkeletonBlock style={styles.orderSkeleton} />
        <SkeletonBlock style={styles.orderSkeleton} />
      </>
    );
  }
  if (query.isError) {
    return (
      <StatePanel
        actionLabel="Try again"
        icon="cloud-offline-outline"
        message={query.error?.message ?? 'Billy could not load your orders.'}
        onAction={() => void query.refetch()}
        title="Orders unavailable"
        tone="danger"
      />
    );
  }
  if (!orders.length) {
    return (
      <StatePanel
        icon="megaphone-outline"
        message="Your Social Boost orders will appear here with delivery progress and eligible actions."
        title="No orders yet"
      />
    );
  }
  return (
    <FadeSlide style={styles.orders}>
      <View style={styles.ordersHeading}>
        <View>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Delivery history
          </Text>
          <Text style={[styles.sectionBody, { color: theme.colors.textMuted }]}>
            Refresh checks this order. It won’t place a new one.
          </Text>
        </View>
      </View>
      {orders.map((order) => {
        const orderRefills = refills.filter(
          (candidate) => candidate.orderId === order.id,
        );
        return (
          <View
            key={order.id}
            style={[
              styles.order,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={styles.orderHeader}>
              <View
                style={[
                  styles.orderIcon,
                  { backgroundColor: '#FFFFFF' },
                ]}
              >
                <BoostPlatformIcon platform={order.platform} size={23} />
              </View>
              <View style={styles.orderCopy}>
                <Text style={[styles.orderTitle, { color: theme.colors.text }]}>
                  {order.productTitle}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.orderTarget, { color: theme.colors.textMuted }]}
                >
                  {order.target}
                </Text>
              </View>
            </View>
            <StatusChip {...boostOrderStatus(order)} />
            <View style={[styles.orderStats, { backgroundColor: theme.colors.surfaceMuted }]}>
              <OrderStat
                label="Quantity"
                value={order.quantity.toLocaleString()}
              />
              <OrderStat
                label="Delivered"
                value={
                  order.deliveredQuantity === null
                    ? 'Confirming'
                    : order.deliveredQuantity.toLocaleString()
                }
              />
              <OrderStat
                label="Paid"
                value={formatMinorUnits(order.totalMinor, 'NGN')}
              />
            </View>
            <Text style={[styles.orderMessage, { color: theme.colors.textMuted }]}>
              {order.statusMessage}
            </Text>
            {order.refundMinor > 0 ? (
              <View style={[styles.refund, { backgroundColor: theme.dark ? '#322344' : '#F1E9FF' }]}>
                <Ionicons
                  color={theme.dark ? '#D0B7FF' : '#6D28D9'}
                  name="return-down-back-outline"
                  size={17}
                />
                <Text style={[styles.refundText, { color: theme.dark ? '#D0B7FF' : '#6D28D9' }]}>
                  {formatMinorUnits(order.refundMinor, 'NGN')} returned to your
                  Billy wallet.
                </Text>
              </View>
            ) : null}
            <View style={styles.orderActions}>
              {!['succeeded', 'partial', 'cancelled', 'failed', 'refunded'].includes(
                order.status,
              ) ? (
                <MiniAction
                  disabled={actionBusy}
                  icon="refresh-outline"
                  label="Refresh"
                  onPress={() => onRefresh(order)}
                />
              ) : null}
              {order.cancelAvailable &&
              ['pending', 'processing'].includes(order.status) ? (
                <MiniAction
                  danger
                  disabled={actionBusy}
                  icon="close-circle-outline"
                  label="Cancel"
                  onPress={() => onCancel(order)}
                />
              ) : null}
              {order.refillAvailable && order.status === 'succeeded' ? (
                <MiniAction
                  disabled={actionBusy}
                  icon="sync-outline"
                  label="Request refill"
                  onPress={() => onRefill(order)}
                />
              ) : null}
            </View>
            {orderRefills.map((item) => (
              <View
                key={item.id}
                style={[styles.refill, { borderColor: theme.colors.border }]}
              >
                <Ionicons
                  color={theme.colors.brand}
                  name="sync-outline"
                  size={16}
                />
                <View style={styles.refillCopy}>
                  <Text style={[styles.refillTitle, { color: theme.colors.text }]}>
                    Refill {item.status.replaceAll('_', ' ')}
                  </Text>
                  <Text style={[styles.refillBody, { color: theme.colors.textMuted }]}>
                    {item.statusMessage}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </FadeSlide>
  );
}

function MiniAction({
  danger = false,
  disabled,
  icon,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useBillyTheme();
  const color = danger ? theme.colors.danger : theme.colors.brand;
  return (
    <ScalePressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.miniAction,
        {
          backgroundColor: `${color}12`,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons color={color} name={icon} size={15} />
      <Text style={[styles.miniActionText, { color }]}>{label}</Text>
    </ScalePressable>
  );
}

function OrderStat({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.orderStat}>
      <Text style={[styles.orderStatLabel, { color: theme.colors.textSoft }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.orderStatValue, { color: theme.colors.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

function QuoteRow({
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
    <View style={styles.quoteRow}>
      <Text style={[styles.quoteLabel, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.quoteValue,
          { color: strong ? theme.colors.brand : theme.colors.text },
          strong && styles.quoteStrong,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function targetLabel(service: SocialBoostService) {
  const tiktokFollowers =
    service.platform === 'tiktok' &&
    `${service.name} ${service.category}`.toLowerCase().includes('follower');
  if (tiktokFollowers) {
    return {
      helper: 'Enter the TikTok username only. Video and share links are rejected.',
      label: 'TikTok username',
      placeholder: '@username',
    };
  }
  const content = /(view|like|comment|share|post|video|reel|story)/i.test(
    `${service.name} ${service.category}`,
  );
  return {
    helper: content
      ? 'Paste the exact public content link.'
      : 'Paste the exact public profile, page, channel or group link.',
    label: content ? 'Post or video link' : 'Profile or page link',
    placeholder:
      service.platform === 'youtube'
        ? 'https://youtube.com/watch?v=…'
        : `https://${service.platform}.com/…`,
  };
}

const styles = StyleSheet.create({
  orderForm: { borderRadius: 24, borderWidth: 1, padding: 16, gap: 20 },
  builder: {
    gap: spacing.md,
  },
  cardTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '900',
  },
  content: { gap: spacing.lg },
  divider: { height: 1 },
  helper: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
    marginTop: -spacing.xs,
  },
  miniAction: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  miniActionText: {
    fontFamily: typography.familyRounded,
    fontSize: 10,
    fontWeight: '800',
  },
  multiline: { minHeight: 116, paddingVertical: spacing.md },
  multilineSmall: { minHeight: 80, paddingVertical: spacing.md },
  order: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  orderCopy: { flex: 1, gap: 3 },
  orderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  orderIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  orderMessage: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  orderSkeleton: { height: 220 },
  orderStat: { flex: 1, gap: 3, minWidth: 80 },
  orderStatLabel: {
    fontFamily: typography.family,
    fontSize: 9,
    textTransform: 'uppercase',
  },
  orderStats: {
    borderRadius: radii.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
  },
  orderStatValue: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  orderTarget: { fontFamily: typography.family, fontSize: 10 },
  orderTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  orders: { gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  ordersHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quote: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  quoteEyebrow: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  quoteHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quoteLabel: { fontFamily: typography.family, fontSize: 12 },
  quoteRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  quoteStrong: { fontSize: 16, fontWeight: '900' },
  quoteValue: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  refill: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  refillBody: { fontFamily: typography.family, fontSize: 10, lineHeight: 15 },
  refillCopy: { flex: 1, gap: 2 },
  refillTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  refund: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  refundText: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  section: { gap: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  sectionBody: { fontFamily: typography.family, fontSize: 11, lineHeight: 17 },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '900',
  },
  tabContainer: { flex: 1 },
  tab: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  tabs: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tabText: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
});
