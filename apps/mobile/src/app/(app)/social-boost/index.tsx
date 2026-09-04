import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
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
  SocialBoostPlatform,
  SocialBoostQuote,
  SocialBoostService,
} from '@/features/social-boost/domain';
import {
  useSocialBoostCancel,
  useSocialBoostCatalog,
  useSocialBoostOrders,
  useSocialBoostRefill,
  useSocialBoostRefills,
  useSocialBoostRefresh,
  useSocialBoostSubmit,
} from '@/features/social-boost/queries';
import { socialBoostRepository } from '@/features/social-boost/repository';
import { formatMinorUnits } from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

const platformLabels: Partial<Record<SocialBoostPlatform, string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  telegram: 'Telegram',
  tiktok: 'TikTok',
  twitter: 'X / Twitter',
  youtube: 'YouTube',
};

const platformIcons: Partial<
  Record<SocialBoostPlatform, keyof typeof Ionicons.glyphMap>
> = {
  facebook: 'logo-facebook',
  instagram: 'logo-instagram',
  linkedin: 'logo-linkedin',
  pinterest: 'logo-pinterest',
  tiktok: 'logo-tiktok',
  twitter: 'logo-twitter',
  youtube: 'logo-youtube',
};

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
  const [selected, setSelected] = useState<SocialBoostService | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [quote, setQuote] = useState<SocialBoostQuote | null>(null);
  const [pin, setPin] = useState('');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const catalog = useSocialBoostCatalog(platform, search);
  const orders = useSocialBoostOrders();
  const refills = useSocialBoostRefills();
  const submit = useSocialBoostSubmit();
  const refresh = useSocialBoostRefresh();
  const cancel = useSocialBoostCancel();
  const refill = useSocialBoostRefill();

  const platforms = useMemo(
    () => ['all', ...(catalog.data?.platforms ?? [])],
    [catalog.data?.platforms],
  );

  function patchForm(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setQuote(null);
    setPin('');
  }

  function selectService(service: SocialBoostService) {
    setSelected(service);
    setForm({
      ...emptyForm,
      quantity: String(service.minimumQuantity),
    });
    setQuote(null);
    setPin('');
  }

  async function getQuote() {
    if (!selected) return;
    const quantity = Number(form.quantity.replaceAll(',', ''));
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < selected.minimumQuantity ||
      quantity > selected.maximumQuantity
    ) {
      Alert.alert(
        'Check quantity',
        `Choose between ${selected.minimumQuantity.toLocaleString()} and ${selected.maximumQuantity.toLocaleString()}.`,
      );
      return;
    }
    setQuoteBusy(true);
    try {
      setQuote(
        await socialBoostRepository.quote(selected.selectionToken, quantity),
      );
    } catch (error) {
      Alert.alert(
        'Quote unavailable',
        error instanceof Error ? error.message : 'Please try again safely.',
      );
    } finally {
      setQuoteBusy(false);
    }
  }

  async function placeOrder() {
    if (!quote) return;
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
        idempotencyKey: `mobile-social-${Crypto.randomUUID()}`,
        intervalMinutes: parseOptionalInteger(form.intervalMinutes),
        keywords: form.keywords.trim() || undefined,
        pin,
        quoteId: quote.quoteId,
        runs: parseOptionalInteger(form.runs),
        target: form.target.trim(),
        username: form.username.trim() || undefined,
        usernames: form.usernames.trim() || undefined,
      });
      Alert.alert('Order received', order.statusMessage);
      setSelected(null);
      setQuote(null);
      setPin('');
      setForm(emptyForm);
      setTab('orders');
    } catch (error) {
      Alert.alert(
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
      onRefresh={() => {
        void catalog.refetch();
        void orders.refetch();
        void refills.refetch();
      }}
      refreshing={
        catalog.isRefetching || orders.isRefetching || refills.isRefetching
      }
      testID="social-boost-screen"
    >
      <ScreenHeader
        subtitle="Real services. Clear delivery tracking."
        title="Social Boost"
      />
      <DemoDataBanner />

      <LinearGradient
        colors={['#071E14', '#124D31', '#2B8D5A']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>GROW WITH CLARITY</Text>
            <Text style={styles.heroTitle}>Choose. Review. Track.</Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons color="#146237" name="megaphone" size={27} />
          </View>
        </View>
        <Text style={styles.heroBody}>
          Browse the current service catalog, confirm an exact target and follow
          delivery without exposing provider details.
        </Text>
        <View style={styles.heroNotice}>
          <Ionicons color="#B8F3CF" name="eye-outline" size={17} />
          <Text style={styles.heroNoticeText}>
            Keep the target profile or content public until delivery completes.
          </Text>
        </View>
      </LinearGradient>

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
              {item === 'browse' ? 'Browse' : 'My orders'}
            </Text>
          </ScalePressable>
        ))}
      </View>

      {tab === 'browse' ? (
        <FadeSlide style={styles.section}>
          <TextField
            autoCapitalize="none"
            icon="search-outline"
            label="Find a service"
            onChangeText={setSearch}
            placeholder="Followers, views, comments…"
            value={search}
          />

          <ScrollView
            contentContainerStyle={styles.platforms}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {platforms.map((item) => {
              const active = platform === item;
              const typed = item as SocialBoostPlatform;
              return (
                <ScalePressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  key={item}
                  onPress={() => {
                    setPlatform(item);
                    setSelected(null);
                    setQuote(null);
                  }}
                  style={[
                    styles.platform,
                    {
                      backgroundColor: active
                        ? theme.colors.brand
                        : theme.colors.surface,
                      borderColor: active
                        ? theme.colors.brand
                        : theme.colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    color={active ? '#FFFFFF' : theme.colors.brand}
                    name={
                      item === 'all'
                        ? 'apps-outline'
                        : platformIcons[typed] ?? 'globe-outline'
                    }
                    size={17}
                  />
                  <Text
                    style={[
                      styles.platformText,
                      {
                        color: active ? '#FFFFFF' : theme.colors.text,
                      },
                    ]}
                  >
                    {item === 'all'
                      ? 'All'
                      : platformLabels[typed] ??
                        `${item.slice(0, 1).toUpperCase()}${item.slice(1)}`}
                  </Text>
                  {item !== 'all' && catalog.data?.platformCounts[item] ? (
                    <Text
                      style={[
                        styles.platformCount,
                        {
                          color: active
                            ? 'rgba(255,255,255,0.75)'
                            : theme.colors.textSoft,
                        },
                      ]}
                    >
                      {catalog.data.platformCounts[item]}
                    </Text>
                  ) : null}
                </ScalePressable>
              );
            })}
          </ScrollView>

          {catalog.isLoading ? (
            <>
              <SkeletonBlock style={styles.serviceSkeleton} />
              <SkeletonBlock style={styles.serviceSkeleton} />
            </>
          ) : catalog.isError || !catalog.data ? (
            <StatePanel
              actionLabel="Try again"
              icon="cloud-offline-outline"
              message={
                catalog.error?.message ??
                'Billy could not load the current service catalog.'
              }
              onAction={() => void catalog.refetch()}
              title="Catalog unavailable"
              tone="danger"
            />
          ) : catalog.data.services.length ? (
            <View style={styles.services}>
              {catalog.data.services.map((service) => (
                <ServiceCard
                  key={service.selectionToken}
                  onPress={() => selectService(service)}
                  selected={selected?.selectionToken === service.selectionToken}
                  service={service}
                />
              ))}
            </View>
          ) : (
            <StatePanel
              compact
              icon="search-outline"
              message="Try another platform or search phrase."
              title="No matching services"
            />
          )}

          {selected ? (
            <OrderBuilder
              busy={quoteBusy}
              form={form}
              onChange={patchForm}
              onClose={() => {
                setSelected(null);
                setQuote(null);
                setPin('');
              }}
              onQuote={() => void getQuote()}
              selected={selected}
            />
          ) : null}

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
                    SECURE QUOTE
                  </Text>
                  <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
                    Review before ordering
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
                label="6-digit transaction PIN"
                maxLength={6}
                onChangeText={(value) => setPin(value.replace(/\D/g, ''))}
                placeholder="••••••"
                secureTextEntry
                value={pin}
              />
              <AppButton
                disabled={!form.target.trim() || pin.length !== 6}
                icon="arrow-forward"
                label="Place order securely"
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
            Alert.alert(
              'Request cancellation?',
              'Cancellation eligibility comes from the service. Any refund follows the provider-confirmed undelivered quantity.',
              [
                { style: 'cancel', text: 'Keep order' },
                {
                  onPress: () =>
                    void cancel.mutateAsync(order.id).catch((error) =>
                      Alert.alert(
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
                idempotencyKey: `mobile-social-refill-${Crypto.randomUUID()}`,
                orderId: order.id,
              })
              .then((result) =>
                Alert.alert('Refill requested', result.statusMessage),
              )
              .catch((error) =>
                Alert.alert(
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
                Alert.alert('Status refreshed', result.statusMessage),
              )
              .catch((error) =>
                Alert.alert(
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

function ServiceCard({
  onPress,
  selected,
  service,
}: {
  onPress: () => void;
  selected: boolean;
  service: SocialBoostService;
}) {
  const theme = useBillyTheme();
  return (
    <ScalePressable
      accessibilityLabel={`Select ${service.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.service,
        {
          backgroundColor: selected
            ? theme.colors.brandMist
            : theme.colors.surface,
          borderColor: selected ? theme.colors.brand : theme.colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.serviceIcon,
          {
            backgroundColor: selected
              ? theme.colors.brand
              : theme.colors.brandMist,
          },
        ]}
      >
        <Ionicons
          color={selected ? '#FFFFFF' : theme.colors.brand}
          name={platformIcons[service.platform] ?? 'globe-outline'}
          size={21}
        />
      </View>
      <View style={styles.serviceCopy}>
        <Text style={[styles.serviceCategory, { color: theme.colors.brand }]}>
          {service.category}
        </Text>
        <Text style={[styles.serviceTitle, { color: theme.colors.text }]}>
          {service.name}
        </Text>
        <Text style={[styles.serviceMeta, { color: theme.colors.textMuted }]}>
          {service.minimumQuantity.toLocaleString()}–
          {service.maximumQuantity.toLocaleString()} · {service.type}
        </Text>
        <View style={styles.capabilities}>
          {service.refillAvailable ? (
            <Capability icon="refresh-outline" label="Refill eligible" />
          ) : null}
          {service.cancelAvailable ? (
            <Capability icon="close-circle-outline" label="Cancellation" />
          ) : null}
        </View>
      </View>
      <Ionicons color={theme.colors.textSoft} name="chevron-forward" size={20} />
    </ScalePressable>
  );
}

function Capability({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  const theme = useBillyTheme();
  return (
    <View style={[styles.capability, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Ionicons color={theme.colors.brand} name={icon} size={12} />
      <Text style={[styles.capabilityText, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

function OrderBuilder({
  busy,
  form,
  onChange,
  onClose,
  onQuote,
  selected,
}: {
  busy: boolean;
  form: FormState;
  onChange: (key: keyof FormState, value: string) => void;
  onClose: () => void;
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
      <View style={styles.builderHeader}>
        <View style={styles.builderHeading}>
          <Text style={[styles.builderEyebrow, { color: theme.colors.brand }]}>
            BUILD YOUR ORDER
          </Text>
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
            {selected.name}
          </Text>
        </View>
        <ScalePressable
          accessibilityLabel="Close order form"
          onPress={onClose}
          style={[styles.close, { backgroundColor: theme.colors.surfaceMuted }]}
        >
          <Ionicons color={theme.colors.textMuted} name="close" size={20} />
        </ScalePressable>
      </View>
      <TextField
        autoCapitalize="none"
        icon="link-outline"
        label={targetCopy.label}
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
      {selected.inputKind === 'default' ? (
        <View style={styles.scheduleRow}>
          <View style={styles.scheduleField}>
            <TextField
              inputMode="numeric"
              label="Runs (optional)"
              onChangeText={(value) => onChange('runs', value.replace(/\D/g, ''))}
              placeholder="1"
              value={form.runs}
            />
          </View>
          <View style={styles.scheduleField}>
            <TextField
              inputMode="numeric"
              label="Interval mins"
              onChangeText={(value) =>
                onChange('intervalMinutes', value.replace(/\D/g, ''))
              }
              placeholder="Optional"
              value={form.intervalMinutes}
            />
          </View>
        </View>
      ) : null}
      <AppButton
        disabled={!form.target.trim() || !form.quantity.trim()}
        icon="receipt-outline"
        label="Review price"
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
      <TextField
        autoCapitalize="none"
        label="Hashtags"
        onChangeText={(value) => onChange('hashtags', value)}
        placeholder="#billy #growth"
        value={form.hashtags}
      />
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
            Refresh only checks the existing provider order.
          </Text>
        </View>
        <StatusChip status="pending" />
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
                  { backgroundColor: theme.colors.brandMist },
                ]}
              >
                <Ionicons
                  color={theme.colors.brand}
                  name={platformIcons[order.platform] ?? 'globe-outline'}
                  size={21}
                />
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
              <StatusChip status={chipStatus(order.status)} />
            </View>
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
              <View style={[styles.refund, { backgroundColor: `${theme.colors.success}14` }]}>
                <Ionicons
                  color={theme.colors.success}
                  name="return-down-back-outline"
                  size={17}
                />
                <Text style={[styles.refundText, { color: theme.colors.success }]}>
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

function chipStatus(status: SocialBoostOrder['status']) {
  if (status === 'partial') return 'in_progress' as const;
  if (status === 'manual_review' || status === 'cancellation_requested') {
    return 'pending' as const;
  }
  return status;
}

const styles = StyleSheet.create({
  builder: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  builderEyebrow: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  builderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  builderHeading: { flex: 1, gap: 4 },
  capability: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  capabilities: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  capabilityText: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '700',
  },
  cardTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '900',
  },
  close: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  content: { gap: spacing.lg },
  divider: { height: 1 },
  eyebrow: {
    color: '#B8F3CF',
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  helper: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
    marginTop: -spacing.xs,
  },
  hero: {
    borderRadius: radii.xl,
    gap: spacing.md,
    minHeight: 220,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  heroBody: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 19,
  },
  heroCopy: { flex: 1, gap: 5 },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  heroNotice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  heroNoticeText: {
    color: '#DDF8E8',
    flex: 1,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  heroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  miniAction: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 5,
    minHeight: 38,
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
  orders: { gap: spacing.md },
  ordersHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  platform: {
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  platformCount: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
  },
  platforms: { gap: spacing.sm, paddingRight: spacing.lg },
  platformText: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
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
  scheduleField: { flex: 1, minWidth: 130 },
  scheduleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.lg },
  sectionBody: { fontFamily: typography.family, fontSize: 11, lineHeight: 17 },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 20,
    fontWeight: '900',
  },
  service: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 116,
    padding: spacing.md,
  },
  serviceCategory: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  serviceCopy: { flex: 1, gap: 4 },
  serviceIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  serviceMeta: { fontFamily: typography.family, fontSize: 10 },
  services: { gap: spacing.sm },
  serviceSkeleton: { height: 116 },
  serviceTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
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
