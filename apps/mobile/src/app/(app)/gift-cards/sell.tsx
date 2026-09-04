import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { TextField } from '@/components/ui/text-field';
import { useDashboardQuery } from '@/features/main/queries';
import type {
  EvidenceAsset,
  SellCardProduct,
  SellCardQuote,
} from '@/features/prestmit/domain';
import {
  useSellCategories,
  useSellProducts,
  useSellSubmitMutation,
} from '@/features/prestmit/queries';
import { prestmitRepository } from '@/features/prestmit/repository';
import { formatMinorUnits } from '@/features/wallet/money';
import { useKycChecksQuery } from '@/features/services/queries';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

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

export default function SellGiftCardScreen() {
  const theme = useBillyTheme();
  const dashboard = useDashboardQuery();
  const kycChecks = useKycChecksQuery();
  const categories = useSellCategories();
  const submit = useSellSubmitMutation();
  const [categoryToken, setCategoryToken] = useState<string | null>(null);
  const products = useSellProducts(categoryToken);
  const [product, setProduct] = useState<SellCardProduct | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SellCardQuote | null>(null);
  const [evidenceMode, setEvidenceMode] = useState<'ecode' | 'physical'>('ecode');
  const [ecode, setEcode] = useState('');
  const [assets, setAssets] = useState<EvidenceAsset[]>([]);
  const [comments, setComments] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderKey = useMemo(() => Crypto.randomUUID(), []);

  const kyc = dashboard.data?.kyc;
  const kycReady =
    kyc?.status === 'verified' ||
    kycChecks.data?.some((check) => check.status === 'verified') === true;

  if (dashboard.isLoading || categories.isLoading || kycChecks.isLoading) {
    return (
      <AppScreen bottomSafe>
        <ScreenHeader title="Sell Gift Card" />
        <SkeletonBlock style={styles.heroSkeleton} />
        <SkeletonBlock style={styles.bodySkeleton} />
      </AppScreen>
    );
  }

  if (!kycReady) {
    return (
      <AppScreen bottomSafe testID="gift-card-sell-kyc-gate">
        <ScreenHeader title="Sell Gift Card" />
        <StatePanel
          actionLabel="Verify identity"
          icon="shield-checkmark-outline"
          message="Gift Card Sell requires a verified Billy identity. Buying gift cards remains available without this step."
          onAction={() => router.push('/(app)/kyc')}
          title="Verification required"
          tone="warning"
        />
      </AppScreen>
    );
  }

  function chooseProduct(value: SellCardProduct) {
    setProduct(value);
    setAmount((value.minimumFaceValueMinor / 100).toString());
    setQuote(null);
    setAssets([]);
    setEcode('');
    setError(null);
    setEvidenceMode(value.form === 'physical' ? 'physical' : 'ecode');
  }

  async function getQuote() {
    if (!product) return;
    const faceValueMinor = parseFaceValue(amount);
    if (
      faceValueMinor === null ||
      faceValueMinor < product.minimumFaceValueMinor ||
      (product.maximumFaceValueMinor !== undefined &&
        faceValueMinor > product.maximumFaceValueMinor)
    ) {
      setError(
        `Enter at least ${faceMoney(
          product.minimumFaceValueMinor,
          product.currencyCode,
        )}${
          product.maximumFaceValueMinor
            ? ` and no more than ${faceMoney(
                product.maximumFaceValueMinor,
                product.currencyCode,
              )}`
            : ''
        }.`,
      );
      return;
    }
    setQuoting(true);
    setError(null);
    try {
      setQuote(
        await prestmitRepository.quoteSell({
          faceValueMinor,
          selectionToken: product.selectionToken,
        }),
      );
    } catch (quoteError) {
      setError(
        quoteError instanceof Error
          ? quoteError.message
          : 'Billy could not load a current payout quote.',
      );
    } finally {
      setQuoting(false);
    }
  }

  async function chooseImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access to choose the gift card images you want to submit.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      quality: 0.86,
      selectionLimit: 5,
    });
    if (result.canceled) return;
    const selected = result.assets
      .filter(
        (asset) =>
          asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/png',
      )
      .slice(0, 5)
      .map((asset, index) => ({
        fileName: asset.fileName ?? `gift-card-${index + 1}.jpg`,
        mimeType: (asset.mimeType ?? 'image/jpeg') as
          | 'image/jpeg'
          | 'image/png',
        uri: asset.uri,
      }));
    setAssets(selected);
    setError(
      selected.length ? null : 'Choose JPEG or PNG gift card images only.',
    );
  }

  async function submitOrder() {
    if (!quote) return;
    if (evidenceMode === 'ecode' && ecode.trim().length < 4) {
      setError('Enter the complete gift card eCode.');
      return;
    }
    if (evidenceMode === 'physical' && assets.length < 1) {
      setError('Add at least one clear gift card image.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const evidencePaths: string[] = [];
      for (const asset of assets) {
        evidencePaths.push(
          await prestmitRepository.uploadEvidence(orderKey, asset),
        );
      }
      const order = await submit.mutateAsync({
        comments: comments.trim() || undefined,
        ecode: evidenceMode === 'ecode' ? ecode.trim() : undefined,
        evidenceMode,
        evidencePaths,
        idempotencyKey: `giftcard-sell-${orderKey}`,
        quoteId: quote.quoteId,
      });
      router.replace({
        pathname: '/(app)/card-order/[id]',
        params: { id: order.id, service: 'gift_cards' },
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Billy could not submit this gift card safely.',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <AppScreen
      bottomSafe
      contentStyle={styles.content}
      testID="gift-card-sell-screen">
      <ScreenHeader title="Sell Gift Card" />
      <View
        style={[
          styles.verified,
          { backgroundColor: theme.colors.brandMist, borderColor: theme.colors.border },
        ]}>
        <Ionicons color={theme.colors.brand} name="shield-checkmark" size={20} />
        <View style={styles.verifiedCopy}>
          <Text style={[styles.verifiedTitle, { color: theme.colors.brandDeep }]}>
            Identity check ready
          </Text>
          <Text style={[styles.verifiedBody, { color: theme.colors.textMuted }]}>
            Billy still rechecks eligibility before any wallet payout.
          </Text>
        </View>
      </View>

      {!categoryToken ? (
        <FadeSlide style={styles.stack}>
          <Heading
            subtitle="Provider-current card families; nothing is hardcoded into the sale."
            title="1. Choose brand"
          />
          {categories.isError || !categories.data ? (
            <StatePanel
              actionLabel="Try again"
              icon="cloud-offline-outline"
              message={
                categories.error?.message ?? 'Billy could not load sellable brands.'
              }
              onAction={() => void categories.refetch()}
              title="Brands unavailable"
              tone="danger"
            />
          ) : (
            <View style={styles.categoryGrid}>
              {categories.data.categories.map((category) => (
                <ScalePressable
                  accessibilityLabel={category.name}
                  accessibilityRole="button"
                  key={category.selectionToken}
                  onPress={() => setCategoryToken(category.selectionToken)}
                  style={[
                    styles.category,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                    },
                  ]}>
                  <View
                    style={[
                      styles.categoryIcon,
                      { backgroundColor: theme.colors.brandMist },
                    ]}>
                    <Text style={[styles.categoryLetter, { color: theme.colors.brand }]}>
                      {category.name.slice(0, 1)}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.categoryName, { color: theme.colors.text }]}>
                    {category.name}
                  </Text>
                </ScalePressable>
              ))}
            </View>
          )}
        </FadeSlide>
      ) : !product ? (
        <FadeSlide style={styles.stack}>
          <Back label="Brands" onPress={() => setCategoryToken(null)} />
          <Heading
            subtitle="Country, currency, and evidence format must match your card."
            title="2. Choose exact card"
          />
          {products.isLoading ? (
            <SkeletonBlock style={styles.bodySkeleton} />
          ) : products.isError || !products.data ? (
            <StatePanel
              actionLabel="Try again"
              icon="cloud-offline-outline"
              message={products.error?.message ?? 'Card types are unavailable.'}
              onAction={() => void products.refetch()}
              title="Card types unavailable"
              tone="danger"
            />
          ) : (
            products.data.products.map((entry) => (
              <ScalePressable
                accessibilityLabel={`${entry.title}, ${entry.form}`}
                accessibilityRole="button"
                key={entry.selectionToken}
                onPress={() => chooseProduct(entry)}
                style={[
                  styles.product,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                  },
                ]}>
                <View style={styles.productCopy}>
                  <Text style={[styles.productTitle, { color: theme.colors.text }]}>
                    {entry.title}
                  </Text>
                  <Text style={[styles.productMeta, { color: theme.colors.textMuted }]}>
                    {entry.country ?? 'Provider region'} · {entry.currencyCode} ·{' '}
                    {entry.form.replaceAll('_', ' ')}
                  </Text>
                </View>
                <Ionicons color={theme.colors.brand} name="arrow-forward" size={19} />
              </ScalePressable>
            ))
          )}
        </FadeSlide>
      ) : !quote ? (
        <FadeSlide style={styles.stack}>
          <Back label="Card types" onPress={() => setProduct(null)} />
          <Heading
            subtitle={`${product.title} · ${product.country ?? 'Provider region'}`}
            title="3. Get current payout"
          />
          <TextField
            icon="cash-outline"
            keyboardType="decimal-pad"
            label={`Card value (${product.currencyCode})`}
            onChangeText={setAmount}
            value={amount}
          />
          <FeedbackBanner
            message="The payout rate is requested now and bound to a short-lived quote."
            tone="info"
          />
          <AppButton
            icon="calculator-outline"
            label="Calculate payout"
            loading={quoting}
            onPress={() => void getQuote()}
          />
        </FadeSlide>
      ) : (
        <FadeSlide style={styles.stack}>
          <Back
            label="Change amount"
            onPress={() => {
              setQuote(null);
              setAssets([]);
              setEcode('');
            }}
          />
          <Heading
            subtitle="Check the payout, then provide only the evidence this card accepts."
            title="4. Review & submit"
          />
          <View
            style={[
              styles.quote,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}>
            <QuoteRow
              label="Card value"
              value={faceMoney(quote.faceValueMinor, quote.faceCurrency)}
            />
            <QuoteRow
              label="Gross payout"
              value={formatMinorUnits(quote.grossPayoutMinor)}
            />
            <QuoteRow label="Billy margin" value={formatMinorUnits(quote.feeMinor)} />
            <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
            <QuoteRow
              label="You receive"
              strong
              value={formatMinorUnits(quote.payoutMinor)}
            />
          </View>

          {quote.evidenceForm === 'physical_or_ecode' ? (
            <View style={styles.evidenceSwitch}>
              <EvidenceButton
                active={evidenceMode === 'ecode'}
                icon="key-outline"
                label="eCode"
                onPress={() => setEvidenceMode('ecode')}
              />
              <EvidenceButton
                active={evidenceMode === 'physical'}
                icon="images-outline"
                label="Physical"
                onPress={() => setEvidenceMode('physical')}
              />
            </View>
          ) : null}

          {evidenceMode === 'ecode' ? (
            <TextField
              autoCapitalize="characters"
              icon="key-outline"
              label="Gift card eCode"
              multiline
              onChangeText={setEcode}
              placeholder="Enter the complete code"
              value={ecode}
            />
          ) : (
            <View style={styles.stack}>
              <AppButton
                icon="images-outline"
                label={assets.length ? 'Change card images' : 'Choose card images'}
                onPress={() => void chooseImages()}
                variant="secondary"
              />
              {assets.map((asset) => (
                <View
                  key={`${asset.uri}-${asset.fileName}`}
                  style={[
                    styles.asset,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                    },
                  ]}>
                  <Ionicons color={theme.colors.brand} name="image-outline" size={20} />
                  <Text
                    numberOfLines={1}
                    style={[styles.assetName, { color: theme.colors.text }]}>
                    {asset.fileName}
                  </Text>
                  <Ionicons
                    color={theme.colors.success}
                    name="checkmark-circle"
                    size={19}
                  />
                </View>
              ))}
            </View>
          )}

          <TextField
            icon="chatbubble-ellipses-outline"
            label="Notes (optional)"
            maxLength={500}
            multiline
            onChangeText={setComments}
            placeholder="Anything the reviewer should know"
            value={comments}
          />
          <FeedbackBanner
            message="Submission does not credit your wallet immediately. Billy waits for confirmed approval and credits exactly once."
            tone="warning"
          />
          <AppButton
            icon="shield-checkmark-outline"
            label="Submit for review"
            loading={uploading || submit.isPending}
            onPress={() => void submitOrder()}
          />
        </FadeSlide>
      )}
      {error ? <FeedbackBanner message={error} tone="error" /> : null}
    </AppScreen>
  );
}

function Heading({ subtitle, title }: { subtitle: string; title: string }) {
  const theme = useBillyTheme();
  return (
    <View style={styles.heading}>
      <Text style={[styles.headingTitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.headingSubtitle, { color: theme.colors.textMuted }]}>
        {subtitle}
      </Text>
    </View>
  );
}

function Back({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useBillyTheme();
  return (
    <ScalePressable
      accessibilityLabel={`Back to ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.back}>
      <Ionicons color={theme.colors.brand} name="arrow-back" size={18} />
      <Text style={[styles.backText, { color: theme.colors.brand }]}>{label}</Text>
    </ScalePressable>
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
      <Text style={[styles.quoteLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text
        style={[
          styles.quoteValue,
          { color: strong ? theme.colors.brand : theme.colors.text },
        ]}>
        {value}
      </Text>
    </View>
  );
}

function EvidenceButton({
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
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[
        styles.evidenceButton,
        {
          backgroundColor: active ? theme.colors.brand : theme.colors.surface,
          borderColor: active ? theme.colors.brand : theme.colors.border,
        },
      ]}>
      <Ionicons
        color={active ? '#FFFFFF' : theme.colors.brand}
        name={icon}
        size={18}
      />
      <Text
        style={[
          styles.evidenceText,
          { color: active ? '#FFFFFF' : theme.colors.text },
        ]}>
        {label}
      </Text>
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  asset: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  assetName: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
  },
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
  bodySkeleton: {
    height: 280,
  },
  category: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flex: 1,
    gap: spacing.sm,
    minWidth: 96,
    padding: spacing.md,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryIcon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  categoryLetter: {
    fontFamily: typography.familyRounded,
    fontSize: 21,
    fontWeight: '900',
  },
  categoryName: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    gap: spacing.lg,
  },
  evidenceButton: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
  },
  evidenceSwitch: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  evidenceText: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '800',
  },
  heading: {
    gap: 4,
  },
  headingSubtitle: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
  },
  headingTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 18,
    fontWeight: '900',
  },
  heroSkeleton: {
    height: 90,
  },
  product: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  productCopy: {
    flex: 1,
    gap: 5,
  },
  productMeta: {
    fontFamily: typography.family,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  productTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '900',
  },
  quote: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  quoteLabel: {
    fontFamily: typography.family,
    fontSize: 13,
  },
  quoteRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  quoteValue: {
    fontFamily: typography.familyRounded,
    fontSize: 13,
    fontWeight: '900',
  },
  rule: {
    height: 1,
  },
  stack: {
    gap: spacing.lg,
  },
  verified: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  verifiedBody: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  verifiedCopy: {
    flex: 1,
    gap: 2,
  },
  verifiedTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '900',
  },
});
