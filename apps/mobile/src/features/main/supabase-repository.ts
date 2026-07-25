import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import type { Database, Profile, UserPreferences } from '@/lib/supabase/database.types';

import {
  BillyRepositoryError,
  type ActivityCursor,
  type ActivityItem,
  type ActivityPage,
  type ActivityStatus,
  type BillyMainRepository,
  type DashboardSnapshot,
  type KycAccessCode,
  type KycStatus,
  type NotificationItem,
  type NotificationRoute,
  type RolloutMode,
  type ServiceAccessCode,
  type ServiceState,
  type ServiceSummary,
  type TransactionDetail,
  type VerificationMode,
  type WalletActionKey,
  type WalletActionSummary,
} from './domain';
import { serviceCatalog } from './service-catalog';

type MinorUnitValue = number | string;

type WalletRow = {
  available_balance_minor: MinorUnitValue;
  balance_minor: MinorUnitValue;
  currency: string;
  id: string;
  reserved_minor: MinorUnitValue;
  status: 'active' | 'closed' | 'frozen';
  updated_at: string;
  user_id: string;
};

type TransactionRow = {
  amount_minor: MinorUnitValue;
  completed_at: string | null;
  created_at: string;
  currency: string;
  direction: 'credit' | 'debit';
  fee_minor: MinorUnitValue;
  id: string;
  kind: string;
  reference: string;
  service_key: string;
  status: ActivityStatus;
  subtitle: string | null;
  title: string;
  total_minor: MinorUnitValue;
  updated_at: string;
  user_id: string;
  wallet_id: string;
};

type TransactionEventRow = {
  id: string;
  message: string;
  occurred_at: string;
  status: ActivityStatus;
  transaction_id: string;
};

type ReceiptRow = {
  amount_minor: MinorUnitValue;
  currency: string;
  fee_minor: MinorUnitValue;
  id: string;
  issued_at: string;
  reference: string;
  title: string;
  total_minor: MinorUnitValue;
  transaction_id: string;
};

type ServiceAccessRow = {
  access_code: string;
  access_reason: string | null;
  can_access: boolean;
  description: string;
  icon: string;
  label: string;
  requires_kyc: boolean;
  required_kyc_tier: number;
  required_verification_mode: string;
  rollout_mode: string;
  service_key: string;
  sort_order: number;
  status_message: string | null;
  status: ServiceState;
  visible: boolean;
};

type KycProfileRow = {
  access_code: string;
  access_reason: string;
  expires_at: string | null;
  status: KycStatus;
  tier: number;
  verification_mode: string;
  verified_at: string | null;
};

type NotificationRow = {
  body: string;
  category: string;
  created_at: string;
  id: string;
  read_at: string | null;
  route: string | null;
  title: string;
  user_id: string;
};

type ReadTable<Row, Update = never> = {
  Insert: never;
  Relationships: [];
  Row: Row;
  Update: Update;
};

type FinancialReadDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: {
      get_my_activity_page: {
        Args: {
          p_before_created_at: string | null;
          p_before_id: string | null;
          p_page_size: number;
        };
        Returns: TransactionRow[];
      };
      get_my_kyc_summary: {
        Args: Record<PropertyKey, never>;
        Returns: KycProfileRow[];
      };
      get_my_service_availability: {
        Args: Record<PropertyKey, never>;
        Returns: ServiceAccessRow[];
      };
      get_my_transaction_events: {
        Args: { p_transaction_id: string };
        Returns: TransactionEventRow[];
      };
      get_my_transaction_receipt: {
        Args: { p_transaction_id: string };
        Returns: ReceiptRow[];
      };
      get_my_unread_notification_count: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Tables: {
      notifications: ReadTable<NotificationRow, { read_at?: string | null }>;
      transactions: ReadTable<TransactionRow>;
      wallets: ReadTable<WalletRow>;
    };
    Views: Record<string, never>;
  };
};

const financialClient =
  supabase as unknown as SupabaseClient<FinancialReadDatabase>;

function normalizeRepositoryError(error: unknown, fallback: string) {
  if (error instanceof BillyRepositoryError) return error;

  const message =
    typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : fallback;
  const normalized = message.toLowerCase();

  if (normalized.includes('jwt') || normalized.includes('auth')) {
    return new BillyRepositoryError('unauthorized', 'Your secure session needs to be refreshed.', {
      cause: error,
    });
  }
  if (
    normalized.includes('fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout')
  ) {
    return new BillyRepositoryError(
      'network',
      'Billy could not reach the secure data service. Check your connection and try again.',
      { cause: error },
    );
  }

  return new BillyRepositoryError('unavailable', fallback, { cause: error });
}

function requireNoError(error: unknown, message: string) {
  if (error) throw normalizeRepositoryError(error, message);
}

function requireMinorUnits(value: unknown, field: string) {
  let normalized: number;

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BillyRepositoryError(
        'unavailable',
        `Billy rejected an unsafe ${field} value. No balance was displayed.`,
      );
    }
    normalized = Number(parsed);
  } else if (typeof value === 'number') {
    normalized = value;
  } else {
    normalized = Number.NaN;
  }

  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new BillyRepositoryError(
      'unavailable',
      `Billy rejected an unsafe ${field} value. No balance was displayed.`,
    );
  }
  return normalized;
}

function requireKycTier(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3
  ) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy received an invalid verification tier and refused to display it.',
    );
  }
  return value;
}

function requireNgnCurrency(value: unknown, context: string): 'NGN' {
  if (value !== 'NGN') {
    throw new BillyRepositoryError(
      'unavailable',
      `Billy received an unsupported ${context} currency and refused to calculate it.`,
    );
  }
  return value;
}

const serviceAccessCodes = new Set<ServiceAccessCode>([
  'available',
  'feature_disabled',
  'kyc_expired',
  'kyc_in_progress',
  'kyc_mode_insufficient',
  'kyc_not_started',
  'kyc_pending',
  'kyc_rejected',
  'kyc_required',
  'kyc_tier_insufficient',
  'rollout_restricted',
  'service_maintenance',
  'service_unavailable',
]);

function requireServiceAccessCode(value: string): ServiceAccessCode {
  if (!serviceAccessCodes.has(value as ServiceAccessCode)) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy received an unknown service-access state and kept the service disabled.',
    );
  }
  return value as ServiceAccessCode;
}

function requireRolloutMode(value: string): RolloutMode {
  if (value === 'all' || value === 'off' || value === 'testers') return value;
  throw new BillyRepositoryError(
    'unavailable',
    'Billy received an unknown rollout state and kept the service disabled.',
  );
}

function requireVerificationMode(
  value: string,
  allowNone = false,
): VerificationMode {
  if (value === 'live' || value === 'mock' || (allowNone && value === 'none')) {
    return value;
  }
  throw new BillyRepositoryError(
    'unavailable',
    'Billy received an unknown verification mode and kept protected actions disabled.',
  );
}

const kycAccessCodes = new Set<KycAccessCode>([
  'kyc_expired',
  'kyc_in_progress',
  'kyc_not_started',
  'kyc_pending',
  'kyc_rejected',
  'kyc_required',
  'verified',
]);

function requireKycAccessCode(value: string): KycAccessCode {
  if (kycAccessCodes.has(value as KycAccessCode)) {
    return value as KycAccessCode;
  }
  throw new BillyRepositoryError(
    'unavailable',
    'Billy received an unknown verification state and kept protected actions disabled.',
  );
}

const notificationRoutes = new Set<NotificationRoute>([
  '/(app)/(tabs)/account',
  '/(app)/(tabs)/activity',
  '/(app)/(tabs)/cards',
  '/(app)/(tabs)/home',
  '/(app)/(tabs)/services',
  '/(app)/account/profile',
  '/(app)/kyc',
  '/(app)/notifications',
  '/(app)/security',
  '/(app)/support',
]);

function normalizeNotificationRoute(route: string | null): NotificationRoute | null {
  return route && notificationRoutes.has(route as NotificationRoute)
    ? (route as NotificationRoute)
    : null;
}

function normalizeNotificationType(
  category: string,
): NotificationItem['type'] {
  if (category === 'account' || category === 'service') return category;
  return 'status';
}

async function requireUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  requireNoError(error, 'Billy could not confirm your secure session.');

  if (!user) {
    throw new BillyRepositoryError('unauthorized', 'Sign in again to continue.');
  }
  return user.id;
}

function mapActivity(row: TransactionRow): ActivityItem {
  const currency = requireNgnCurrency(row.currency, 'transaction');
  const amountMinor = requireMinorUnits(row.amount_minor, 'transaction amount');
  const feeMinor = requireMinorUnits(row.fee_minor, 'transaction fee');
  const totalMinor = requireMinorUnits(row.total_minor, 'transaction total');
  if (totalMinor !== amountMinor + feeMinor) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy detected inconsistent transaction totals and refused to display them.',
    );
  }
  return {
    amountMinor,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    currency,
    direction: row.direction,
    feeMinor,
    id: row.id,
    kind: row.kind,
    reference: row.reference,
    serviceKey: row.service_key,
    status: row.status,
    subtitle: row.subtitle ?? '',
    title: row.title,
    totalMinor,
  };
}

function mapWallet(row: WalletRow, preference: UserPreferences) {
  const currency = requireNgnCurrency(row.currency, 'wallet');
  const balanceMinor = requireMinorUnits(row.balance_minor, 'wallet balance');
  const reservedMinor = requireMinorUnits(
    row.reserved_minor,
    'wallet reserved balance',
  );
  const availableMinor = requireMinorUnits(
    row.available_balance_minor,
    'wallet available balance',
  );

  if (availableMinor !== balanceMinor - reservedMinor) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy detected an inconsistent wallet balance and refused to display it.',
    );
  }

  return {
    availableMinor,
    balanceMinor,
    currency,
    hideBalance: preference.hide_balances_by_default,
    id: row.id,
    reservedMinor,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapProfile(profile: Profile) {
  const firstName = profile.first_name?.trim() || 'there';
  return {
    avatarUrl: profile.avatar_url,
    displayName:
      profile.display_name?.trim() ||
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
      'Billy customer',
    firstName,
  };
}

function mapAvailability(row: ServiceAccessRow) {
  const accessCode = requireServiceAccessCode(row.access_code);
  const stateAllowsAccess = row.status === 'available';
  const canTransact =
    row.can_access && accessCode === 'available' && stateAllowsAccess;

  return {
    accessCode,
    canTransact,
    message:
      row.access_reason ||
      row.status_message ||
      (canTransact
        ? 'This service is available.'
        : 'Live transactions for this service are not enabled yet.'),
    requiredKycTier: requireKycTier(row.required_kyc_tier),
    requiredVerificationMode: requireVerificationMode(
      row.required_verification_mode,
    ) as Exclude<VerificationMode, 'none'>,
    rollout: requireRolloutMode(row.rollout_mode),
    state: row.status,
  };
}

function mapServices(rows: ServiceAccessRow[]): ServiceSummary[] {
  const availability = new Map(rows.map((row) => [row.service_key, row]));
  return serviceCatalog
    .flatMap((catalogItem) => {
      const row = availability.get(catalogItem.key);
      if (!row?.visible) return [];

      return {
        ...mapAvailability(row),
        description: row.description || catalogItem.description,
        icon: catalogItem.icon,
        key: catalogItem.key,
        label: row.label || catalogItem.label,
        requiresKyc: row.requires_kyc,
        sortOrder: row.sort_order,
      } satisfies ServiceSummary;
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function failClosedWalletAction(key: WalletActionKey): WalletActionSummary {
  return {
    accessCode: 'service_unavailable',
    canTransact: false,
    key,
    message: 'Billy could not verify this wallet action, so it remains disabled.',
    requiredKycTier: 0,
    requiredVerificationMode: 'live',
    rollout: 'off',
    state: 'unavailable',
  };
}

function mapWalletAction(
  rows: ServiceAccessRow[],
  key: WalletActionKey,
): WalletActionSummary {
  const row = rows.find((candidate) => candidate.service_key === key);
  if (!row) return failClosedWalletAction(key);
  return {
    ...mapAvailability(row),
    key,
  };
}

function mapKyc(row: KycProfileRow | null) {
  if (!row) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy could not verify your identity status and kept protected actions disabled.',
    );
  }

  return {
    accessCode: requireKycAccessCode(row.access_code),
    accessReason: row.access_reason,
    expiresAt: row.expires_at,
    status: row.status,
    tier: requireKycTier(row.tier),
    verificationMode: requireVerificationMode(row.verification_mode, true),
    verifiedAt: row.verified_at,
  };
}

function mapNotification(notification: NotificationRow): NotificationItem {
  return {
    body: notification.body,
    createdAt: notification.created_at,
    id: notification.id,
    readAt: notification.read_at,
    route: normalizeNotificationRoute(notification.route),
    title: notification.title,
    type: normalizeNotificationType(notification.category),
  };
}

function mapReceipt(receipt: ReceiptRow) {
  const amountMinor = requireMinorUnits(receipt.amount_minor, 'receipt amount');
  const feeMinor = requireMinorUnits(receipt.fee_minor, 'receipt fee');
  const totalMinor = requireMinorUnits(receipt.total_minor, 'receipt total');
  if (totalMinor !== amountMinor + feeMinor) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy detected an inconsistent receipt snapshot and refused to display it.',
    );
  }

  return {
    amountMinor,
    currency: requireNgnCurrency(receipt.currency, 'receipt'),
    feeMinor,
    id: receipt.id,
    issuedAt: receipt.issued_at,
    reference: receipt.reference,
    title: receipt.title,
    totalMinor,
  };
}

function requireUnreadCount(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy could not verify the unread notification count.',
    );
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BillyRepositoryError(
      'unavailable',
      'Billy received an unsafe unread notification count.',
    );
  }
  return Number(parsed);
}

async function loadProfileAndPreference(userId: string) {
  const [profileResult, preferenceResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single<Profile>(),
    supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single<UserPreferences>(),
  ]);

  requireNoError(profileResult.error, 'Billy could not load your profile.');
  requireNoError(preferenceResult.error, 'Billy could not load your privacy preferences.');
  if (!profileResult.data || !preferenceResult.data) {
    throw new BillyRepositoryError(
      'not_found',
      'Billy could not find your completed profile and preferences.',
    );
  }
  return {
    preference: preferenceResult.data,
    profile: profileResult.data,
  };
}

async function loadFinancialDashboard(userId: string) {
  const [
    walletResult,
    activityResult,
    serviceAccessResult,
    kycResult,
    notificationResult,
    unreadCountResult,
  ] =
    await Promise.all([
      financialClient
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('currency', 'NGN')
        .maybeSingle(),
      financialClient
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(12),
      financialClient.rpc('get_my_service_availability'),
      financialClient.rpc('get_my_kyc_summary').maybeSingle(),
      financialClient
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(8),
      financialClient.rpc('get_my_unread_notification_count'),
    ]);

  requireNoError(walletResult.error, 'Billy could not load your wallet.');
  requireNoError(activityResult.error, 'Billy could not load your activity.');
  requireNoError(
    serviceAccessResult.error,
    'Billy could not verify service availability.',
  );
  requireNoError(kycResult.error, 'Billy could not load your verification status.');
  requireNoError(notificationResult.error, 'Billy could not load notification status.');
  requireNoError(
    unreadCountResult.error,
    'Billy could not verify your unread notification count.',
  );

  return {
    activity: activityResult.data ?? [],
    kyc: kycResult.data,
    notifications: notificationResult.data ?? [],
    services: serviceAccessResult.data ?? [],
    unreadCount: requireUnreadCount(unreadCountResult.data),
    wallet: walletResult.data,
  };
}

export function createSupabaseRepository(): BillyMainRepository {
  return {
    async getActivityPage(cursor?: ActivityCursor | null): Promise<ActivityPage> {
      await requireUserId();
      const pageSize = 30;
      const { data, error } = await financialClient
        .rpc('get_my_activity_page', {
          p_before_created_at: cursor?.createdAt ?? null,
          p_before_id: cursor?.id ?? null,
          p_page_size: pageSize + 1,
        });
      requireNoError(error, 'Billy could not load your activity.');
      const rows = data ?? [];
      const visibleRows = rows.slice(0, pageSize);
      const lastVisible = visibleRows.at(-1);
      return {
        items: visibleRows.map(mapActivity),
        nextCursor:
          rows.length > pageSize && lastVisible
            ? {
                createdAt: lastVisible.created_at,
                id: lastVisible.id,
              }
            : null,
      };
    },
    async getDashboard() {
      const userId = await requireUserId();

      try {
        const [{ profile, preference }, financial] = await Promise.all([
          loadProfileAndPreference(userId),
          loadFinancialDashboard(userId),
        ]);

        const snapshot: DashboardSnapshot = {
          activity: financial.activity.map(mapActivity),
          dataSource: 'supabase',
          demoScenario: null,
          generatedAt: new Date().toISOString(),
          kyc: mapKyc(financial.kyc),
          notifications: financial.notifications.map(mapNotification),
          profile: mapProfile(profile),
          services: mapServices(financial.services),
          unreadNotificationCount: financial.unreadCount,
          wallet: financial.wallet
            ? mapWallet(financial.wallet, preference)
            : null,
          walletActions: {
            funding: mapWalletAction(financial.services, 'wallet_funding'),
            withdrawal: mapWalletAction(
              financial.services,
              'wallet_withdrawal',
            ),
          },
        };
        return snapshot;
      } catch (error) {
        throw normalizeRepositoryError(
          error,
          'Billy could not load your financial overview. No demo data was substituted.',
        );
      }
    },
    async getNotifications(): Promise<NotificationItem[]> {
      const userId = await requireUserId();
      const { data, error } = await financialClient
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(100);
      requireNoError(error, 'Billy could not load your notifications.');
      return (data ?? []).map(mapNotification);
    },
    async getTransaction(id) {
      const userId = await requireUserId();
      const transactionResult = await financialClient
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      requireNoError(transactionResult.error, 'Billy could not load this transaction.');
      if (!transactionResult.data) return null;

      const [eventsResult, receiptResult] = await Promise.all([
        financialClient.rpc('get_my_transaction_events', {
          p_transaction_id: id,
        }),
        financialClient
          .rpc('get_my_transaction_receipt', {
            p_transaction_id: id,
          })
          .maybeSingle(),
      ]);
      requireNoError(eventsResult.error, 'Billy could not load the transaction timeline.');
      requireNoError(receiptResult.error, 'Billy could not load this receipt.');

      const detail: TransactionDetail = {
        ...mapActivity(transactionResult.data),
        events: (eventsResult.data ?? []).map((event) => ({
          id: event.id,
          message: event.message,
          occurredAt: event.occurred_at,
          status: event.status,
        })),
        receipt: receiptResult.data ? mapReceipt(receiptResult.data) : null,
      };
      return detail;
    },
    async markNotificationRead(id) {
      const userId = await requireUserId();
      const { data, error } = await financialClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('id', id)
        .is('read_at', null)
        .select('id')
        .maybeSingle();
      requireNoError(error, 'Billy could not update this notification.');
      if (!data) {
        throw new BillyRepositoryError(
          'not_found',
          'This notification was already read or is no longer available.',
        );
      }
    },
    async setHideBalance(hidden) {
      const userId = await requireUserId();
      const { error } = await supabase
        .from('user_preferences')
        .update({ hide_balances_by_default: hidden })
        .eq('user_id', userId);
      requireNoError(error, 'Billy could not update your balance privacy preference.');
    },
  };
}

export type BillyAppDatabase = Database & FinancialReadDatabase;
