import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide } from '@/components/ui/motion';
import { PinEntry } from '@/components/ui/pin-entry';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { TextField } from '@/components/ui/text-field';
import { BillChoiceCard } from '@/features/bills/components/bill-choice-card';
import { BillOrderResult } from '@/features/bills/components/bill-order-result';
import { BillStepper } from '@/features/bills/components/bill-stepper';
import { useDashboardQuery } from '@/features/main/queries';
import { findBillCategory } from '@/features/services/catalog';
import type {
  BillCategoryKey,
  BillOrder,
  BillQuote,
  BillSelection,
  BillService,
} from '@/features/services/domain';
import {
  useBillCatalogQuery,
  usePurchaseBill,
  useQuoteBill,
  useRefreshBillOrder,
  useValidateBillCustomer,
} from '@/features/services/queries';
import { createBillyOperationKey } from '@/features/services/idempotency';
import { isBillyDevDemo } from '@/features/main/repository';
import {
  formatFullDate,
  formatMinorUnits,
  parseMajorUnitsToMinor,
} from '@/features/wallet/money';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

type JourneyStep = 0 | 1 | 2 | 3;

export default function BillCategoryScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const categoryParam =
    typeof params.category === 'string' ? params.category : '';
  const category = findBillCategory(categoryParam);

  if (!category) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Pay bills" />
        <StatePanel
          actionLabel="See bill categories"
          icon="search-outline"
          message="This bill category is not part of the current Billy catalog."
          onAction={() => router.replace('/(app)/bills')}
          title="Category not found"
        />
      </AppScreen>
    );
  }

  return <BillJourney category={category.key} title={category.label} />;
}

function BillJourney({
  category,
  title,
}: {
  category: BillCategoryKey;
  title: string;
}) {
  const theme = useBillyTheme();
  const navigation = useNavigation();
  const dashboard = useDashboardQuery();
  const billsAccess =
    dashboard.data?.services.find((service) => service.key === 'bills') ?? null;
  const canTransact = billsAccess?.canTransact === true;
  const catalog = useBillCatalogQuery(category, canTransact);
  const validation = useValidateBillCustomer();
  const quoteRequest = useQuoteBill();
  const purchase = usePurchaseBill();
  const refreshOrder = useRefreshBillOrder();
  const [step, setStep] = useState<JourneyStep>(0);
  const [serviceId, setServiceId] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [subscriptionType, setSubscriptionType] = useState<
    'change' | 'renew' | null
  >(null);
  const [customerReference, setCustomerReference] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<BillQuote | null>(null);
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [order, setOrder] = useState<BillOrder | null>(null);
  const [pin, setPin] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const purchaseGuard = useRef(false);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (purchaseGuard.current) event.preventDefault();
      }),
    [navigation],
  );

  const service = useMemo(
    () =>
      catalog.data?.services.find((candidate) => candidate.id === serviceId) ??
      null,
    [catalog.data?.services, serviceId],
  );
  const product =
    service?.products.find((candidate) => candidate.id === productId) ?? null;
  const preparing = validation.isPending || quoteRequest.isPending;
  const renewing = subscriptionType === 'renew';
  const productUnavailable =
    Boolean(service) &&
    !renewing &&
    service?.amountMode === 'fixed' &&
    service.products.length === 0;

  function selectService(nextService: BillService) {
    setServiceId(nextService.id);
    setProductId(null);
    setSubscriptionType(
      nextService.subscriptionOptions?.length === 1
        ? nextService.subscriptionOptions[0]
        : null,
    );
    setCustomerReference('');
    setContactPhone('');
    setAmount('');
    setQuote(null);
    setFormError(null);
    validation.reset();
    quoteRequest.reset();
  }

  function buildSelection(): BillSelection | null {
    if (!service) {
      setFormError('Choose a service to continue.');
      return null;
    }
    if (service.subscriptionOptions?.length && !subscriptionType) {
      setFormError('Choose whether to renew or change your current package.');
      return null;
    }
    if (!renewing && service.products.length > 0 && !product) {
      setFormError('Choose a current product or account type.');
      return null;
    }
    if (productUnavailable) {
      setFormError('Current products are unavailable. Refresh and try again.');
      return null;
    }
    const amountMinor = renewing
      ? undefined
      : (product?.amountMinor ?? parseMajorUnitsToMinor(amount) ?? 0);
    const normalizedCustomer = customerReference.trim();
    const normalizedPhone =
      service.customerField.keyboard === 'phone-pad' &&
        !normalizedCustomer.includes('@')
        ? normalizedCustomer
        : contactPhone.trim();

    if (!normalizedCustomer) {
      setFormError(
        `Enter your ${service.customerField.label.toLowerCase()}.`,
      );
      return null;
    }
    if (!normalizedPhone) {
      setFormError('Enter a phone number for this payment.');
      return null;
    }
    if (
      !renewing &&
      (!Number.isSafeInteger(amountMinor) || (amountMinor ?? 0) <= 0)
    ) {
      setFormError('Enter or choose a valid amount.');
      return null;
    }

    return {
      ...(amountMinor !== undefined ? { amountMinor } : {}),
      category,
      contactPhone: normalizedPhone,
      customerReference: normalizedCustomer,
      productId: renewing ? null : productId,
      serviceId: service.id,
      ...(subscriptionType ? { subscriptionType } : {}),
    };
  }

  async function reviewPayment() {
    if (!canTransact || preparing) return;
    setFormError(null);
    const selection = buildSelection();
    if (!selection || !service) return;

    try {
      let validationToken: string | null = null;
      if (service.requiresCustomerValidation) {
        const result = await validation.mutateAsync(selection);
        if (!result.validated) {
          setFormError(result.message);
          return;
        }
        validationToken = result.validationToken;
      }
      const latestQuote = await quoteRequest.mutateAsync({
        selection,
        validationToken,
      });
      setQuote(latestQuote);
      setOperationKey(createBillyOperationKey('bill'));
      setStep(1);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Billy could not prepare this payment.',
      );
    }
  }

  async function confirmPayment() {
    if (
      !canTransact ||
      !quote ||
      !operationKey ||
      pin.length !== 6 ||
      purchaseGuard.current
    ) {
      return;
    }
    purchaseGuard.current = true;
    try {
      const completedOrder = await purchase.mutateAsync({
        idempotencyKey: operationKey,
        pin,
        quoteId: quote.id,
      });
      setPin('');
      setOrder(completedOrder);
      setStep(3);
    } catch {
      setPin('');
    } finally {
      purchaseGuard.current = false;
    }
  }

  function restart() {
    setStep(0);
    setQuote(null);
    setOperationKey(null);
    setOrder(null);
    setPin('');
    setServiceId('');
    setProductId(null);
    setSubscriptionType(null);
    setCustomerReference('');
    setContactPhone('');
    setAmount('');
    setFormError(null);
    validation.reset();
    quoteRequest.reset();
    purchase.reset();
    refreshOrder.reset();
  }

  async function refreshPendingOrder() {
    if (!order) return;
    try {
      setOrder(await refreshOrder.mutateAsync(order.id));
    } catch {
      // The mutation exposes a safe repository error beside the status card.
    }
  }

  function goBack() {
    if (purchaseGuard.current) return;
    if (step === 0) {
      router.back();
      return;
    }
    if (step === 3) {
      router.replace('/(app)/bills');
      return;
    }
    setStep((step - 1) as JourneyStep);
    setPin('');
    purchase.reset();
  }

  if (dashboard.isLoading) {
    return (
      <AppScreen bottomSafe testID={`bill-${category}-access-loading`}>
        <ScreenHeader title={title} />
        <DemoDataBanner />
        <SkeletonBlock style={styles.heroSkeleton} />
        <SkeletonBlock style={styles.formSkeleton} />
      </AppScreen>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <AppScreen bottomSafe testID={`bill-${category}-access-error`}>
        <ScreenHeader title={title} />
        <DemoDataBanner />
        <StatePanel
          actionLabel="Try again"
          icon="cloud-offline-outline"
          message="Billy could not confirm whether bill payments are available. No payment details were sent."
          onAction={() => void dashboard.refetch()}
          title="Bill access unavailable"
          tone="danger"
        />
      </AppScreen>
    );
  }

  if (!canTransact) {
    return (
      <AppScreen bottomSafe testID={`bill-${category}-access-disabled`}>
        <ScreenHeader title={title} />
        <DemoDataBanner />
        <StatePanel
          actionLabel="See all services"
          icon="lock-closed-outline"
          message={
            billsAccess?.message ??
            'Bill payments are not currently available for this account.'
          }
          onAction={() => router.replace('/(app)/(tabs)/services')}
          title="Bill payments unavailable"
          tone="warning"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen bottomSafe testID={`bill-${category}-screen`}>
      <ScreenHeader
        onBack={goBack}
        subtitle={
          step === 0
            ? 'Current products and limits load securely.'
            : step === 1
              ? 'Check every detail before confirming.'
              : step === 2
                ? 'Your PIN stays private and is never stored.'
                : 'Keep this reference for support.'
        }
        title={title}
      />
      <DemoDataBanner />
      <BillStepper step={step} />

      {catalog.isLoading ? (
        <View style={styles.loading}>
          <SkeletonBlock style={styles.heroSkeleton} />
          <SkeletonBlock style={styles.formSkeleton} />
        </View>
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
      ) : catalog.data.services.length === 0 ? (
        <StatePanel
          actionLabel="Refresh catalog"
          icon="receipt-outline"
          message="No current services were returned for this category. Billy will not guess provider products or prices."
          onAction={() => void catalog.refetch()}
          title="No services available"
          tone="warning"
        />
      ) : step === 0 ? (
        <FadeSlide>
          <View style={styles.journey}>
            {catalog.data.isPreview ? (
              <FeedbackBanner message="This development preview uses synthetic products. Live Billy always loads the provider catalog at runtime." />
            ) : null}

            <FormSection
              subtitle="Choose who you want to pay."
              title={`Select ${title.toLowerCase()} service`}>
              {catalog.data.services.map((candidate) => (
                <BillChoiceCard
                  description={candidate.description}
                  disabled={preparing}
                  key={candidate.id}
                  label={candidate.label}
                  onPress={() => selectService(candidate)}
                  selected={serviceId === candidate.id}
                />
              ))}
            </FormSection>

            {service ? (
              <>
                {service.subscriptionOptions?.length ? (
                  <FormSection
                    subtitle="Renew keeps your current package. Change lets you choose another current package."
                    title="Choose subscription action">
                    {service.subscriptionOptions.includes('renew') ? (
                      <BillChoiceCard
                        description="Pay for the package currently linked to this decoder."
                        disabled={preparing}
                        label="Renew current package"
                        onPress={() => {
                          setSubscriptionType('renew');
                          setProductId(null);
                          setAmount('');
                          setFormError(null);
                          validation.reset();
                          quoteRequest.reset();
                        }}
                        selected={subscriptionType === 'renew'}
                        testID="subscription-renew"
                      />
                    ) : null}
                    {service.subscriptionOptions.includes('change') ? (
                      <BillChoiceCard
                        description="Choose a different package from the live catalog."
                        disabled={preparing}
                        label="Change package"
                        onPress={() => {
                          setSubscriptionType('change');
                          setProductId(null);
                          setAmount('');
                          setFormError(null);
                          validation.reset();
                          quoteRequest.reset();
                        }}
                        selected={subscriptionType === 'change'}
                        testID="subscription-change"
                      />
                    ) : null}
                  </FormSection>
                ) : null}

                {!renewing && service.products.length ? (
                  <FormSection
                    subtitle="Prices shown here are confirmed again before payment."
                    title={
                      category === 'electricity'
                        ? 'Choose meter type'
                        : 'Choose product'
                    }>
                    {service.products.map((candidate) => (
                      <BillChoiceCard
                        description={candidate.description}
                        disabled={preparing}
                        key={candidate.id}
                        label={candidate.label}
                        onPress={() => {
                          setProductId(candidate.id);
                          if (candidate.amountMinor !== null) {
                            setAmount(
                              String(Math.trunc(candidate.amountMinor / 100)),
                            );
                          }
                          setFormError(null);
                          validation.reset();
                          quoteRequest.reset();
                        }}
                        selected={productId === candidate.id}
                        trailing={
                          candidate.amountMinor !== null
                            ? formatMinorUnits(candidate.amountMinor)
                            : undefined
                        }
                      />
                    ))}
                  </FormSection>
                ) : null}

                {productUnavailable ? (
                  <StatePanel
                    compact
                    icon="cloud-offline-outline"
                    message="No current products were returned for this service. Billy will not guess a package or price."
                    title="Products unavailable"
                    tone="warning"
                  />
                ) : (
                  <FormSection
                  subtitle={
                    service.requiresCustomerValidation
                      ? 'Billy verifies these details before showing your quote.'
                      : 'Check the destination carefully. Completed top-ups cannot be redirected.'
                  }
                  title="Customer details">
                  <TextField
                    autoCapitalize="none"
                    disabled={preparing}
                    icon={
                      service.customerField.keyboard === 'email-address'
                        ? 'mail-outline'
                        : service.customerField.keyboard === 'phone-pad'
                          ? 'call-outline'
                          : 'keypad-outline'
                    }
                    keyboardType={service.customerField.keyboard}
                    label={service.customerField.label}
                    maxLength={service.customerField.maxLength}
                    onChangeText={(value) => {
                      setCustomerReference(value);
                      setFormError(null);
                      validation.reset();
                      quoteRequest.reset();
                    }}
                    placeholder={service.customerField.placeholder}
                    value={customerReference}
                  />
                  {service.customerField.keyboard !== 'phone-pad' ? (
                    <TextField
                      disabled={preparing}
                      icon="call-outline"
                      keyboardType="phone-pad"
                      label="Phone number"
                      maxLength={14}
                      onChangeText={(value) => {
                        setContactPhone(value);
                        setFormError(null);
                        validation.reset();
                        quoteRequest.reset();
                      }}
                      placeholder="0801 234 5678"
                      value={contactPhone}
                    />
                  ) : null}
                  {!renewing && service.amountMode === 'custom' ? (
                    <TextField
                      disabled={preparing}
                      icon="cash-outline"
                      keyboardType="decimal-pad"
                      label="Amount"
                      maxLength={16}
                      onChangeText={(value) => {
                        setAmount(value.replace(/[^\d.,]/g, ''));
                        setFormError(null);
                        validation.reset();
                        quoteRequest.reset();
                      }}
                      placeholder="0.00"
                      rightSlot={
                        <Text
                          style={[
                            styles.currency,
                            { color: theme.colors.textMuted },
                          ]}>
                          NGN
                        </Text>
                      }
                      value={amount}
                    />
                  ) : null}
                  {!renewing &&
                  (service.minimumAmountMinor !== null ||
                    service.maximumAmountMinor !== null) ? (
                    <Text
                      style={[styles.limit, { color: theme.colors.textMuted }]}>
                      {service.minimumAmountMinor !== null
                        ? `Minimum ${formatMinorUnits(service.minimumAmountMinor)}`
                        : ''}
                      {service.minimumAmountMinor !== null &&
                      service.maximumAmountMinor !== null
                        ? ' · '
                        : ''}
                      {service.maximumAmountMinor !== null
                        ? `Maximum ${formatMinorUnits(service.maximumAmountMinor)}`
                        : ''}
                    </Text>
                  ) : null}
                  </FormSection>
                )}
              </>
            ) : null}

            {formError ? (
              <FeedbackBanner message={formError} tone="error" />
            ) : validation.isSuccess ? (
              <FeedbackBanner
                message={validation.data.message}
                tone="success"
              />
            ) : null}

            <AppButton
              disabled={
                !service ||
                productUnavailable ||
                preparing ||
                Boolean(
                  service?.subscriptionOptions?.length && !subscriptionType,
                )
              }
              icon="arrow-forward"
              label={
                validation.isPending || quoteRequest.isPending
                  ? 'Confirming latest details'
                  : 'Review payment'
              }
              loading={validation.isPending || quoteRequest.isPending}
              onPress={() => void reviewPayment()}
            />
          </View>
        </FadeSlide>
      ) : step === 1 && quote ? (
        <FadeSlide>
          <QuoteReview
            onConfirm={() => setStep(2)}
            onEdit={() => setStep(0)}
            quote={quote}
          />
        </FadeSlide>
      ) : step === 2 && quote ? (
        <FadeSlide>
          <View style={styles.journey}>
            <View
              style={[
                styles.pinCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}>
              <View
                style={[
                  styles.lock,
                  { backgroundColor: theme.colors.brandMist },
                ]}>
                <Ionicons
                  color={theme.colors.brand}
                  name="lock-closed"
                  size={26}
                />
              </View>
              <Text style={[styles.pinTitle, { color: theme.colors.text }]}>
                Confirm {formatMinorUnits(quote.totalMinor)}
              </Text>
              <Text
                style={[styles.pinSubtitle, { color: theme.colors.textMuted }]}>
                Enter your 6-digit Billy transaction PIN. Billy support will
                never ask you to share it.
              </Text>
              <PinEntry
                autoFocus
                disabled={purchase.isPending}
                onChange={(value) => {
                  if (purchase.isPending) return;
                  setPin(value);
                  purchase.reset();
                }}
                testID="bill-transaction-pin"
                value={pin}
              />
              {isBillyDevDemo ? (
                <FeedbackBanner message="Development preview: use any 6-digit PIN. No live funds or provider order will move." />
              ) : null}
              {purchase.isError ? (
                <FeedbackBanner message={purchase.error.message} tone="error" />
              ) : null}
            </View>
            <AppButton
              disabled={pin.length !== 6 || purchase.isPending}
              icon="shield-checkmark-outline"
              label="Pay securely"
              loading={purchase.isPending}
              onPress={() => void confirmPayment()}
            />
            <AppButton
              disabled={purchase.isPending}
              label="Back to review"
              onPress={() => setStep(1)}
              variant="ghost"
            />
          </View>
        </FadeSlide>
      ) : step === 3 && order ? (
        <FadeSlide>
          <BillOrderResult
            onAgain={restart}
            onRefresh={() => void refreshPendingOrder()}
            order={order}
            refreshError={
              refreshOrder.isError
                ? refreshOrder.error.message
                : null
            }
            refreshing={refreshOrder.isPending}
          />
        </FadeSlide>
      ) : (
        <StatePanel
          actionLabel="Start again"
          icon="refresh-outline"
          message="Billy could not restore this payment step. No transaction was sent."
          onAction={restart}
          title="Payment step expired"
          tone="warning"
        />
      )}
    </AppScreen>
  );
}

function FormSection({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle: string;
  title: string;
}) {
  const theme = useBillyTheme();
  return (
    <View
      style={[
        styles.formSection,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.sectionSubtitle, { color: theme.colors.textMuted }]}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.options}>{children}</View>
    </View>
  );
}

function QuoteReview({
  onConfirm,
  onEdit,
  quote,
}: {
  onConfirm: () => void;
  onEdit: () => void;
  quote: BillQuote;
}) {
  const theme = useBillyTheme();
  return (
    <View style={styles.journey}>
      <View
        style={[
          styles.reviewCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}>
        <View style={styles.reviewHeading}>
          <View
            style={[
              styles.reviewIcon,
              { backgroundColor: theme.colors.brandMist },
            ]}>
            <Ionicons
              color={theme.colors.brand}
              name="document-text-outline"
              size={24}
            />
          </View>
          <View style={styles.reviewHeadingCopy}>
            <Text style={[styles.reviewTitle, { color: theme.colors.text }]}>
              Review payment
            </Text>
            <Text
              style={[styles.reviewSubtitle, { color: theme.colors.textMuted }]}>
              Quote valid until {formatFullDate(quote.expiresAt)}
            </Text>
          </View>
        </View>

        <View style={styles.reviewRows}>
          <ReviewRow label="Service" value={quote.serviceLabel} />
          {quote.productLabel ? (
            <ReviewRow label="Product" value={quote.productLabel} />
          ) : null}
          <ReviewRow
            label="Customer"
            value={quote.customerName ?? quote.customerReference}
          />
          {quote.customerName ? (
            <ReviewRow label="Account" value={quote.customerReference} />
          ) : null}
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <ReviewRow label="Amount" value={formatMinorUnits(quote.amountMinor)} />
          <ReviewRow label="Billy fee" value={formatMinorUnits(quote.feeMinor)} />
          <View style={[styles.total, { backgroundColor: theme.colors.brandMist }]}>
            <Text style={[styles.totalLabel, { color: theme.colors.brand }]}>
              Total debit
            </Text>
            <Text style={[styles.totalValue, { color: theme.colors.brand }]}>
              {formatMinorUnits(quote.totalMinor)}
            </Text>
          </View>
        </View>
      </View>

      <FeedbackBanner message="A provider timeout will remain pending for reconciliation. Billy will not repeat the purchase automatically." />

      <AppButton
        icon="arrow-forward"
        label="Continue to PIN"
        onPress={onConfirm}
      />
      <AppButton label="Edit details" onPress={onEdit} variant="ghost" />
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.reviewRow}>
      <Text style={[styles.reviewLabel, { color: theme.colors.textMuted }]}>
        {label}
      </Text>
      <Text style={[styles.reviewValue, { color: theme.colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  currency: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  divider: {
    height: 1,
  },
  formSection: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  formSkeleton: {
    height: 420,
  },
  heroSkeleton: {
    height: 90,
  },
  journey: {
    gap: spacing.xl,
  },
  limit: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  loading: {
    gap: spacing.xl,
  },
  lock: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  options: {
    gap: spacing.sm,
  },
  pinCard: {
    alignItems: 'center',
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  pinSubtitle: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 440,
    textAlign: 'center',
  },
  pinTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  reviewCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.xl,
    padding: spacing.lg,
  },
  reviewHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  reviewHeadingCopy: {
    flex: 1,
    gap: 3,
  },
  reviewIcon: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  reviewLabel: {
    fontFamily: typography.family,
    fontSize: 12,
  },
  reviewRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  reviewRows: {
    gap: spacing.md,
  },
  reviewSubtitle: {
    fontFamily: typography.family,
    fontSize: 11,
  },
  reviewTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
  reviewValue: {
    flex: 1,
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  sectionHeading: {
    gap: 3,
  },
  sectionSubtitle: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 17,
    fontWeight: '800',
  },
  total: {
    alignItems: 'center',
    borderRadius: radii.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  totalLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  totalValue: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '800',
  },
});
