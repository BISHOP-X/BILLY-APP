import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import type { KycSummary } from '@/features/main/domain';
import {
  ServiceApiError,
  type KycCheck,
  type KycMethod,
} from '@/features/services/domain';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, shadows, spacing, typography } from '@/theme/tokens';

import { IdentityNumberField } from './identity-number-field';
import { KycCheckCard } from './kyc-check-card';
import { KycMethodPicker } from './kyc-method-picker';

export const BILLY_IDENTITY_CONSENT_VERSION = 'billy-identity-consent-v1';

type KycSubmission = {
  consentVersion: typeof BILLY_IDENTITY_CONSENT_VERSION;
  method: KycMethod;
  number: string;
};

type KycJourneyProps = {
  checks: KycCheck[];
  dashboardKyc: KycSummary | null;
  dashboardLoading?: boolean;
  historyError?: string | null;
  historyLoading?: boolean;
  onRefreshCheck?: (checkId: string) => Promise<KycCheck>;
  onRefreshHistory: () => void;
  onSubmit: (submission: KycSubmission) => Promise<KycCheck>;
  showDemoHints?: boolean;
  submitting?: boolean;
};

function statusSummary(
  kyc: Pick<KycSummary, 'status' | 'verificationMode'> | null,
) {
  if (!kyc) {
    return {
      color: 'muted' as const,
      icon: 'cloud-offline-outline' as const,
      label: 'Status unavailable',
      message:
        'Funding, bills, and gift-card browsing and buying remain available while protected actions stay disabled.',
    };
  }

  if (kyc.verificationMode === 'mock') {
    if (kyc.status === 'verified') {
      return {
        color: 'warning' as const,
        icon: 'flask-outline' as const,
        label: 'Preview check complete',
        message: 'This tester result is not a live identity verification.',
      };
    }
    if (kyc.status === 'pending' || kyc.status === 'in_progress') {
      return {
        color: 'warning' as const,
        icon: 'flask-outline' as const,
        label: 'Preview check in review',
        message: 'This tester result is not a live provider check.',
      };
    }
    if (kyc.status === 'rejected') {
      return {
        color: 'warning' as const,
        icon: 'flask-outline' as const,
        label: 'Preview check not verified',
        message: 'This tester result is not live. You can retry safely.',
      };
    }
    return {
      color: 'warning' as const,
      icon: 'flask-outline' as const,
      label: 'Preview check not completed',
      message: 'This tester status is not a live identity result.',
    };
  }

  if (kyc.status === 'verified') {
    return {
      color: 'success' as const,
      icon: 'checkmark-circle' as const,
      label: 'Identity verified',
      message: 'Billy has a completed identity check on your profile.',
    };
  }

  if (kyc.status === 'pending' || kyc.status === 'in_progress') {
    return {
      color: 'warning' as const,
      icon: 'time' as const,
      label: 'Check in review',
      message:
        'Funding, bills, and gift-card browsing and buying stay available while crypto transactions and gift-card sales wait for review.',
    };
  }

  if (kyc.status === 'rejected') {
    return {
      color: 'danger' as const,
      icon: 'alert-circle' as const,
      label: 'Not verified',
      message:
        'Retry before making crypto transactions or selling gift cards. Funding, bills, and gift-card browsing and buying remain available.',
    };
  }

  return {
    color: 'brand' as const,
    icon: 'shield-outline' as const,
    label: 'Not completed',
    message: 'Complete this before crypto transactions or selling gift cards.',
  };
}

function safeSubmitError(error: unknown) {
  if (error instanceof ServiceApiError && error.retryable) {
    return 'We could not complete the secure check right now. Your number was cleared. You can retry safely.';
  }
  if (error instanceof ServiceApiError && error.code === 'invalid_request') {
    return 'Those details could not be used. Your number was cleared; review them and try again.';
  }
  return 'We could not send the identity check. Your number was cleared. Check your connection and try again.';
}

function safeRefreshError(error: unknown) {
  if (error instanceof ServiceApiError && error.code === 'not_found') {
    return 'This check is no longer available. Pull down to refresh your history.';
  }
  return 'Billy could not refresh this status. The check remains safely in review; try again later.';
}

export function KycJourney({
  checks,
  dashboardKyc,
  dashboardLoading = false,
  historyError = null,
  historyLoading = false,
  onRefreshCheck,
  onRefreshHistory,
  onSubmit,
  showDemoHints = false,
  submitting = false,
}: KycJourneyProps) {
  const theme = useBillyTheme();
  const [method, setMethod] = useState<KycMethod>('bvn_basic');
  const [identityVisibilityResetToken, setIdentityVisibilityResetToken] =
    useState(0);
  const [number, setNumber] = useState('');
  const [consented, setConsented] = useState(false);
  const [touched, setTouched] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [submittedCheck, setSubmittedCheck] = useState<KycCheck | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshingCheckId, setRefreshingCheckId] = useState<string | null>(
    null,
  );
  const submitGuard = useRef(false);
  const busy = submitting || localSubmitting;
  const validNumber = /^\d{11}$/.test(number);
  const label = method === 'bvn_basic' ? 'BVN' : 'NIN';
  const numberError =
    touched && !validNumber ? `Enter your complete 11-digit ${label}.` : null;
  const latestCheck = useMemo(
    () => {
      if (!submittedCheck) return null;
      const persisted = checks.find((check) => check.id === submittedCheck.id);
      if (!persisted) return submittedCheck;
      if (
        persisted.status === 'pending' &&
        submittedCheck.status !== 'pending'
      ) {
        return submittedCheck;
      }
      return persisted;
    },
    [checks, submittedCheck],
  );
  const summary = statusSummary(
    latestCheck
      ? {
          status:
            latestCheck.status === 'created' || latestCheck.status === 'error'
              ? 'not_started'
              : latestCheck.status,
          verificationMode: latestCheck.isPreview ? 'mock' : 'live',
        }
      : dashboardKyc,
  );
  const summaryColor =
    summary.color === 'success'
      ? theme.colors.success
      : summary.color === 'warning'
        ? theme.colors.warning
        : summary.color === 'danger'
          ? theme.colors.danger
          : summary.color === 'brand'
            ? theme.colors.brand
            : theme.colors.textMuted;
  const history = useMemo(
    () =>
      latestCheck
        ? checks.filter((check) => check.id !== latestCheck.id)
        : checks,
    [checks, latestCheck],
  );

  function changeMethod(nextMethod: KycMethod) {
    if (nextMethod === method) return;
    setMethod(nextMethod);
    setIdentityVisibilityResetToken((current) => current + 1);
    setNumber('');
    setConsented(false);
    setTouched(false);
    setSubmitError(null);
  }

  async function submit() {
    setTouched(true);
    setSubmitError(null);
    if (!validNumber || !consented || busy || submitGuard.current) return;
    submitGuard.current = true;

    const submission: KycSubmission = {
      consentVersion: BILLY_IDENTITY_CONSENT_VERSION,
      method,
      number,
    };

    setNumber('');
    setIdentityVisibilityResetToken((current) => current + 1);
    setConsented(false);
    setTouched(false);
    setSubmittedCheck(null);
    setLocalSubmitting(true);
    Keyboard.dismiss();

    try {
      const result = await onSubmit(submission);
      setSubmittedCheck(result);
    } catch (error) {
      setSubmitError(safeSubmitError(error));
    } finally {
      setLocalSubmitting(false);
      submitGuard.current = false;
    }
  }

  async function refreshCheck(checkId: string) {
    if (!onRefreshCheck || refreshingCheckId) return;
    setRefreshError(null);
    setRefreshingCheckId(checkId);
    try {
      const result = await onRefreshCheck(checkId);
      setSubmittedCheck(result);
    } catch (error) {
      setRefreshError(safeRefreshError(error));
    } finally {
      setRefreshingCheckId(null);
    }
  }

  return (
    <View style={styles.journey}>
      <FadeSlide>
        <View
          style={[
            styles.hero,
            {
              backgroundColor: theme.colors.brandDeep,
              borderColor: `${theme.colors.brandSoft}66`,
            },
            shadows.card,
          ]}>
          <View
            pointerEvents="none"
            style={[
              styles.orbitLarge,
              { borderColor: `${theme.colors.accent}18` },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.orbitSmall,
              { backgroundColor: `${theme.colors.brandSoft}33` },
            ]}
          />
          <View style={styles.heroTop}>
            <View
              style={[
                styles.heroIcon,
                { backgroundColor: `${theme.colors.white}16` },
              ]}>
              <Ionicons
                accessible={false}
                color={theme.colors.white}
                name="finger-print"
                size={30}
              />
            </View>
            <View
              style={[
                styles.optionalBadge,
                { backgroundColor: `${theme.colors.accent}1F` },
              ]}>
              <View
                style={[
                  styles.optionalDot,
                  { backgroundColor: theme.colors.accent },
                ]}
              />
              <Text style={[styles.optionalText, { color: theme.colors.white }]}>
                WHEN NEEDED
              </Text>
            </View>
          </View>
          <View style={styles.heroCopy}>
            <Text
              accessibilityRole="header"
              style={[styles.heroTitle, { color: theme.colors.white }]}>
              Verify for protected transactions.
            </Text>
            <Text style={[styles.heroMessage, { color: '#D6EBDD' }]}>
              Identity verification is required for crypto transactions and
              selling gift cards. It does not block wallet funding, bills, or
              browsing and buying gift cards.
            </Text>
          </View>
          <View
            style={[
              styles.privacyStrip,
              { backgroundColor: `${theme.colors.white}0D` },
            ]}>
            <Ionicons
              accessible={false}
              color={theme.colors.accent}
              name="lock-closed"
              size={16}
            />
            <Text style={[styles.privacyText, { color: '#E7F4EC' }]}>
              Your complete number is used for this check, then kept out of
              your app history.
            </Text>
          </View>
        </View>
      </FadeSlide>

      <FadeSlide delay={70}>
        {dashboardLoading ? (
          <SkeletonBlock style={{ height: 88 }} />
        ) : (
          <View
            style={[
              styles.profileStatus,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}>
            <View
              style={[
                styles.statusIcon,
                { backgroundColor: `${summaryColor}14` },
              ]}>
              <Ionicons
                accessible={false}
                color={summaryColor}
                name={summary.icon}
                size={22}
              />
            </View>
            <View style={styles.statusCopy}>
              <Text style={[styles.statusLabel, { color: theme.colors.text }]}>
                {summary.label}
              </Text>
              <Text
                style={[
                  styles.statusMessage,
                  { color: theme.colors.textMuted },
                ]}>
                {summary.message}
              </Text>
            </View>
          </View>
        )}
      </FadeSlide>

      <FadeSlide delay={110}>
        <View
          style={[
            styles.formCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
            shadows.card,
          ]}>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={[styles.eyebrow, { color: theme.colors.brand }]}>
                PRIVATE IDENTITY CHECK
              </Text>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                Choose one ID
              </Text>
            </View>
            <View
              style={[
                styles.stepBadge,
                { backgroundColor: theme.colors.brandMist },
              ]}>
              <Text style={[styles.stepText, { color: theme.colors.brand }]}>
                ONE STEP
              </Text>
            </View>
          </View>

          <KycMethodPicker
            disabled={busy}
            onChange={changeMethod}
            value={method}
          />

          <IdentityNumberField
            disabled={busy}
            error={numberError}
            method={method}
            onChangeText={(value) => {
              if (number && !value) {
                setIdentityVisibilityResetToken((current) => current + 1);
              }
              setNumber(value);
              if (touched) setTouched(false);
              if (submitError) setSubmitError(null);
            }}
            value={number}
            visibilityResetToken={identityVisibilityResetToken}
          />

          <View
            style={[
              styles.securityNote,
              { backgroundColor: theme.colors.surfaceMuted },
            ]}>
            <Ionicons
              accessible={false}
              color={theme.colors.brand}
              name="shield-checkmark-outline"
              size={19}
            />
            <Text
              style={[styles.securityCopy, { color: theme.colors.textMuted }]}>
              Billy sends this once through its secure server. Only a masked
              ending and the result appear here afterwards.
            </Text>
          </View>

          <ScalePressable
            accessibilityHint="Double tap to give or withdraw consent. Verification is required only for crypto transactions and gift-card sales."
            accessibilityLabel="Consent to the Billy identity check"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consented, disabled: busy }}
            disabled={busy}
            onPress={() => setConsented((current) => !current)}
            style={styles.consent}>
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: consented
                    ? theme.colors.brand
                    : theme.colors.surface,
                  borderColor: consented
                    ? theme.colors.brand
                    : theme.colors.border,
                },
              ]}>
              {consented ? (
                <Ionicons
                  accessible={false}
                  color={theme.colors.white}
                  name="checkmark"
                  size={17}
                />
              ) : null}
            </View>
            <Text style={[styles.consentCopy, { color: theme.colors.textMuted }]}>
              I consent to Billy using my selected {label} for this one
              identity check under{' '}
              <Text style={[styles.consentStrong, { color: theme.colors.text }]}>
                Billy Identity Consent v1
              </Text>
              . I understand it is required before crypto transactions or
              selling gift cards.
            </Text>
          </ScalePressable>

          {showDemoHints ? (
            <View
              style={[
                styles.demoHint,
                {
                  backgroundColor: `${theme.colors.warning}10`,
                  borderColor: `${theme.colors.warning}38`,
                },
              ]}>
              <Ionicons
                accessible={false}
                color={theme.colors.warning}
                name="flask-outline"
                size={16}
              />
              <Text style={[styles.demoHintText, { color: theme.colors.textMuted }]}>
                Preview only: eleven 1s returns not verified, eleven 2s stays
                in review, eleven 0s tests retry, and another 11 digits
                verifies.
              </Text>
            </View>
          ) : null}

          {submitError ? (
            <View
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={[
                styles.submitError,
                { backgroundColor: `${theme.colors.danger}12` },
              ]}>
              <Ionicons
                accessible={false}
                color={theme.colors.danger}
                name="alert-circle"
                size={19}
              />
              <Text
                style={[styles.submitErrorText, { color: theme.colors.danger }]}>
                {submitError}
              </Text>
            </View>
          ) : null}

          <AppButton
            accessibilityHint="Submits the selected identity number once and clears it from this form."
            disabled={!validNumber || !consented}
            icon="arrow-forward"
            label={`Check my ${label}`}
            loading={busy}
            onPress={() => void submit()}
            testID="kyc-submit"
          />
        </View>
      </FadeSlide>

      {latestCheck ? (
        <FadeSlide delay={20} key={latestCheck.id}>
          <View style={styles.resultSection}>
            <Text style={[styles.resultEyebrow, { color: theme.colors.brand }]}>
              LATEST RESPONSE
            </Text>
            <KycCheckCard
              check={latestCheck}
              highlighted
              onRefresh={
                onRefreshCheck && latestCheck.status === 'pending'
                  ? () => void refreshCheck(latestCheck.id)
                  : undefined
              }
              refreshing={refreshingCheckId === latestCheck.id}
            />
          </View>
        </FadeSlide>
      ) : null}

      {refreshError ? (
        <FeedbackBanner message={refreshError} tone="warning" />
      ) : null}

      <FadeSlide delay={150}>
        <View style={styles.historySection}>
          <View style={styles.historyHeading}>
            <View style={styles.historyTitleRow}>
              <Text style={[styles.historyTitle, { color: theme.colors.text }]}>
                Check history
              </Text>
              {history.length ? (
                <View
                  style={[
                    styles.count,
                    { backgroundColor: theme.colors.brandMist },
                  ]}>
                  <Text style={[styles.countText, { color: theme.colors.brand }]}>
                    {history.length}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.historySubtitle, { color: theme.colors.textMuted }]}>
              Complete identity numbers never appear here.
            </Text>
          </View>

          {historyLoading ? (
            <>
              <SkeletonBlock style={{ height: 132 }} />
              <SkeletonBlock style={{ height: 132 }} />
            </>
          ) : historyError ? (
            <StatePanel
              actionLabel="Try again"
              compact
              icon="cloud-offline-outline"
              message="Your identity history could not be loaded. Funding, bills, and gift-card browsing and buying remain available."
              onAction={onRefreshHistory}
              title="History unavailable"
              tone="danger"
            />
          ) : history.length ? (
            history.map((check) => (
              <KycCheckCard
                check={check}
                key={check.id}
                onRefresh={
                  onRefreshCheck && check.status === 'pending'
                    ? () => void refreshCheck(check.id)
                    : undefined
                }
                refreshing={refreshingCheckId === check.id}
              />
            ))
          ) : (
            <View
              style={[
                styles.emptyHistory,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: theme.colors.brandMist },
                ]}>
                <Ionicons
                  accessible={false}
                  color={theme.colors.brand}
                  name="shield-outline"
                  size={25}
                />
              </View>
              <View style={styles.emptyCopy}>
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                  {latestCheck ? 'No earlier checks' : 'No checks yet'}
                </Text>
                <Text
                  style={[
                    styles.emptyMessage,
                    { color: theme.colors.textMuted },
                  ]}>
                  {latestCheck
                    ? 'Your latest result is shown above. Complete identity numbers never appear in this history.'
                    : 'Funding, bills, and gift-card browsing and buying remain available. Verify before crypto transactions or gift-card sales.'}
                </Text>
              </View>
            </View>
          )}
        </View>
      </FadeSlide>
    </View>
  );
}

const styles = StyleSheet.create({
  checkbox: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1.4,
    height: 24,
    justifyContent: 'center',
    marginTop: 1,
    width: 24,
  },
  consent: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
  },
  consentCopy: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 19,
  },
  consentStrong: {
    fontFamily: typography.familyRounded,
    fontWeight: '800',
  },
  count: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 24,
    justifyContent: 'center',
    minWidth: 24,
    paddingHorizontal: 7,
  },
  countText: {
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  demoHint: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  demoHintText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 10,
    lineHeight: 15,
  },
  emptyCopy: {
    flex: 1,
    gap: 3,
  },
  emptyHistory: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  emptyMessage: {
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '800',
  },
  eyebrow: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.25,
  },
  formCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  hero: {
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.lg,
    overflow: 'hidden',
    padding: spacing.xl,
    position: 'relative',
  },
  heroCopy: {
    gap: spacing.xs,
    maxWidth: 480,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  heroMessage: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 20,
  },
  heroTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 31,
  },
  heroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyHeading: {
    gap: 3,
  },
  historySection: {
    gap: spacing.md,
  },
  historySubtitle: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  historyTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 19,
    fontWeight: '800',
  },
  historyTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  journey: {
    gap: spacing.xl,
  },
  optionalBadge: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  optionalDot: {
    borderRadius: radii.pill,
    height: 6,
    width: 6,
  },
  optionalText: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  orbitLarge: {
    borderRadius: radii.pill,
    borderWidth: 28,
    height: 220,
    position: 'absolute',
    right: -85,
    top: -100,
    width: 220,
  },
  orbitSmall: {
    borderRadius: radii.pill,
    bottom: -34,
    height: 90,
    position: 'absolute',
    right: 26,
    width: 90,
  },
  privacyStrip: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  privacyText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  profileStatus: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  resultEyebrow: {
    fontFamily: typography.familyRounded,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.25,
  },
  resultSection: {
    gap: spacing.sm,
  },
  sectionHeading: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: typography.familyRounded,
    fontSize: 21,
    fontWeight: '800',
    marginTop: 3,
  },
  securityCopy: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 17,
  },
  securityNote: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  statusCopy: {
    flex: 1,
    gap: 3,
  },
  statusIcon: {
    alignItems: 'center',
    borderRadius: radii.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  statusLabel: {
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
  statusMessage: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 16,
  },
  stepBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  stepText: {
    fontFamily: typography.familyRounded,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  submitError: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.md,
  },
  submitErrorText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
});
