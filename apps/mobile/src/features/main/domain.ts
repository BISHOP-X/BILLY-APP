import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';

export type AppIconName = ComponentProps<typeof Ionicons>['name'];

export type BillyDataSource = 'demo' | 'supabase';

export type DemoScenario =
  | 'error'
  | 'funded'
  | 'maintenance'
  | 'new-user'
  | 'offline'
  | 'pending';

export type ActivityDirection = 'credit' | 'debit';

export type ActivityStatus =
  | 'cancelled'
  | 'created'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'refunded'
  | 'reserved'
  | 'succeeded';

export type ServiceKey =
  | 'bills'
  | 'crypto'
  | 'foreign_numbers'
  | 'gift_cards'
  | 'prepaid_cards'
  | 'social_boost';

export type WalletActionKey = 'wallet_funding' | 'wallet_withdrawal';

export type ServiceState =
  | 'available'
  | 'coming_soon'
  | 'maintenance'
  | 'unavailable';

export type RolloutMode = 'all' | 'off' | 'testers';

export type VerificationMode = 'live' | 'mock' | 'none';

export type ServiceAccessCode =
  | 'available'
  | 'feature_disabled'
  | 'kyc_expired'
  | 'kyc_in_progress'
  | 'kyc_mode_insufficient'
  | 'kyc_not_started'
  | 'kyc_pending'
  | 'kyc_rejected'
  | 'kyc_required'
  | 'kyc_tier_insufficient'
  | 'rollout_restricted'
  | 'service_maintenance'
  | 'service_unavailable';

export type KycStatus =
  | 'expired'
  | 'in_progress'
  | 'not_started'
  | 'pending'
  | 'rejected'
  | 'verified';

export type ProfileSummary = {
  avatarUrl: string | null;
  displayName: string;
  firstName: string;
};

export type WalletSummary = {
  availableMinor: number;
  balanceMinor: number;
  currency: string;
  hideBalance: boolean;
  id: string;
  reservedMinor: number;
  status: 'active' | 'closed' | 'frozen';
  updatedAt: string;
};

export type ServiceSummary = {
  accessCode: ServiceAccessCode;
  canTransact: boolean;
  description: string;
  icon: AppIconName;
  key: ServiceKey;
  label: string;
  message: string;
  requiredKycTier: number;
  requiredVerificationMode: Exclude<VerificationMode, 'none'>;
  requiresKyc: boolean;
  rollout: RolloutMode;
  sortOrder: number;
  state: ServiceState;
};

export type WalletActionSummary = {
  accessCode: ServiceAccessCode;
  canTransact: boolean;
  key: WalletActionKey;
  message: string;
  requiredKycTier: number;
  requiredVerificationMode: Exclude<VerificationMode, 'none'>;
  rollout: RolloutMode;
  state: ServiceState;
};

export type ActivityItem = {
  amountMinor: number;
  completedAt: string | null;
  createdAt: string;
  currency: string;
  direction: ActivityDirection;
  feeMinor: number;
  id: string;
  kind: string;
  reference: string;
  serviceKey: string;
  status: ActivityStatus;
  subtitle: string;
  title: string;
  totalMinor: number;
};

export type ActivityCursor = {
  createdAt: string;
  id: string;
};

export type ActivityPage = {
  items: ActivityItem[];
  nextCursor: ActivityCursor | null;
};

export type TransactionEvent = {
  id: string;
  message: string;
  occurredAt: string;
  status: ActivityStatus;
};

export type ReceiptSummary = {
  amountMinor: number;
  currency: string;
  feeMinor: number;
  id: string;
  issuedAt: string;
  reference: string;
  title: string;
  totalMinor: number;
};

export type TransactionDetail = ActivityItem & {
  events: TransactionEvent[];
  receipt: ReceiptSummary | null;
};

export type NotificationItem = {
  body: string;
  createdAt: string;
  id: string;
  readAt: string | null;
  route: NotificationRoute | null;
  title: string;
  type: 'account' | 'service' | 'status';
};

export type NotificationRoute =
  | '/(app)/(tabs)/account'
  | '/(app)/(tabs)/activity'
  | '/(app)/(tabs)/cards'
  | '/(app)/(tabs)/home'
  | '/(app)/(tabs)/services'
  | '/(app)/account/profile'
  | '/(app)/kyc'
  | '/(app)/notifications'
  | '/(app)/security'
  | '/(app)/support';

export type KycAccessCode =
  | 'kyc_expired'
  | 'kyc_in_progress'
  | 'kyc_not_started'
  | 'kyc_pending'
  | 'kyc_rejected'
  | 'kyc_required'
  | 'verified';

export type KycSummary = {
  accessCode: KycAccessCode;
  accessReason: string;
  expiresAt: string | null;
  status: KycStatus;
  tier: number;
  verificationMode: VerificationMode;
  verifiedAt: string | null;
};

export type DashboardSnapshot = {
  activity: ActivityItem[];
  dataSource: BillyDataSource;
  demoScenario: DemoScenario | null;
  generatedAt: string;
  kyc: KycSummary;
  notifications: NotificationItem[];
  profile: ProfileSummary;
  services: ServiceSummary[];
  unreadNotificationCount: number;
  wallet: WalletSummary | null;
  walletActions: {
    funding: WalletActionSummary;
    withdrawal: WalletActionSummary;
  };
};

export type RepositoryErrorCode =
  | 'configuration'
  | 'network'
  | 'not_found'
  | 'unauthorized'
  | 'unavailable'
  | 'unknown';

export class BillyRepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BillyRepositoryError';
    this.code = code;
  }
}

export type BillyMainRepository = {
  getActivityPage: (cursor?: ActivityCursor | null) => Promise<ActivityPage>;
  getDashboard: () => Promise<DashboardSnapshot>;
  getNotifications: () => Promise<NotificationItem[]>;
  getTransaction: (id: string) => Promise<TransactionDetail | null>;
  markNotificationRead: (id: string) => Promise<void>;
  setHideBalance: (hidden: boolean) => Promise<void>;
};
