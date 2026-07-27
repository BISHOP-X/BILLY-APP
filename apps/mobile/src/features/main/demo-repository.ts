import {
  BillyRepositoryError,
  type ActivityItem,
  type BillyMainRepository,
  type DashboardSnapshot,
  type DemoScenario,
  type NotificationItem,
  type ServiceSummary,
  type TransactionDetail,
} from './domain';
import { serviceCatalog } from './service-catalog';

const DEMO_DELAY_MS = 260;
let hideDemoBalance = false;
const readDemoNotifications = new Set<string>();

function minutesAgo(now: Date, minutes: number) {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function demoServices(scenario: DemoScenario): ServiceSummary[] {
  return serviceCatalog.map((service, index) => {
    const maintenance =
      scenario === 'maintenance' && ['bills', 'crypto'].includes(service.key);
    const activeTesterPreview = service.key === 'bills' && !maintenance;
    const requiresKyc = service.key === 'crypto';

    return {
      ...service,
      accessCode: maintenance
        ? 'service_maintenance'
        : activeTesterPreview
          ? 'available'
          : 'feature_disabled',
      canTransact: activeTesterPreview,
      message: maintenance
        ? 'This preview is temporarily paused while we complete service checks.'
        : activeTesterPreview
          ? 'Bill payments are available through Billy’s safe tester adapter. No live provider transaction will be created.'
          : 'The complete Billy flow is being prepared with a safe mock adapter. Live transactions are off.',
      requiresKyc,
      requiredKycTier: requiresKyc ? 1 : 0,
      requiredVerificationMode: 'live',
      rollout: activeTesterPreview ? 'testers' : 'off',
      state: maintenance
        ? 'maintenance'
        : activeTesterPreview
          ? 'available'
          : 'coming_soon',
      sortOrder: service.sortOrder ?? (index + 1) * 10,
    };
  });
}

function demoActivity(now: Date, scenario: DemoScenario): ActivityItem[] {
  if (scenario === 'new-user') return [];

  const items: ActivityItem[] = [
    {
      amountMinor: 5_000_000,
      completedAt: minutesAgo(now, 190),
      createdAt: minutesAgo(now, 192),
      currency: 'NGN',
      direction: 'credit',
      feeMinor: 0,
      id: 'demo-tx-funding',
      kind: 'wallet_funding',
      reference: 'BLY-DEMO-10001',
      serviceKey: 'wallet_funding',
      status: 'succeeded',
      subtitle: 'Wallet funding preview',
      title: 'Money added',
      totalMinor: 5_000_000,
    },
    {
      amountMinor: 1_250_000,
      completedAt: minutesAgo(now, 1_440),
      createdAt: minutesAgo(now, 1_443),
      currency: 'NGN',
      direction: 'debit',
      feeMinor: 10_000,
      id: 'demo-tx-bill',
      kind: 'service_purchase',
      reference: 'BLY-DEMO-10002',
      serviceKey: 'bills',
      status: 'succeeded',
      subtitle: 'Electricity payment preview',
      title: 'Bill payment',
      totalMinor: 1_260_000,
    },
    {
      amountMinor: 350_000,
      completedAt: null,
      createdAt: minutesAgo(now, 35),
      currency: 'NGN',
      direction: 'debit',
      feeMinor: 0,
      id: 'demo-tx-social',
      kind: 'service_purchase',
      reference: 'BLY-DEMO-10003',
      serviceKey: 'social_boost',
      status: 'pending',
      subtitle: 'Order preview · awaiting completion',
      title: 'Social order',
      totalMinor: 350_000,
    },
    {
      amountMinor: 220_000,
      completedAt: minutesAgo(now, 2_880),
      createdAt: minutesAgo(now, 3_020),
      currency: 'NGN',
      direction: 'credit',
      feeMinor: 0,
      id: 'demo-tx-refund',
      kind: 'refund',
      reference: 'BLY-DEMO-10004',
      serviceKey: 'foreign_numbers',
      status: 'refunded',
      subtitle: 'Number order preview',
      title: 'Refund received',
      totalMinor: 220_000,
    },
  ];

  if (scenario === 'pending') {
    return items.map((item, index) =>
      index === 0
        ? {
            ...item,
            completedAt: null,
            status: 'processing',
            subtitle: 'Funding preview · confirmation pending',
          }
        : item,
    );
  }

  return items;
}

function demoNotifications(now: Date): NotificationItem[] {
  return [
    {
      body: 'Your preview account is ready. Live provider transactions remain disabled.',
      createdAt: minutesAgo(now, 18),
      id: 'demo-notification-ready',
      readAt: readDemoNotifications.has('demo-notification-ready')
        ? now.toISOString()
        : null,
      route: '/(app)/(tabs)/home',
      title: 'Welcome to Billy preview',
      type: 'account',
    },
    {
      body: 'Never share your password or transaction PIN with anyone.',
      createdAt: minutesAgo(now, 1_080),
      id: 'demo-notification-security',
      readAt: readDemoNotifications.has('demo-notification-security')
        ? now.toISOString()
        : null,
      route: '/(app)/security',
      title: 'Keep your account secure',
      type: 'status',
    },
  ];
}

function buildSnapshot(scenario: DemoScenario, now = new Date()): DashboardSnapshot {
  return {
    activity: demoActivity(now, scenario),
    dataSource: 'demo',
    demoScenario: scenario,
    generatedAt: now.toISOString(),
    kyc: {
      accessCode: 'kyc_not_started',
      accessReason:
        'Verify before crypto transactions or selling gift cards. Funding, bills, and gift-card buying remain available.',
      expiresAt: null,
      status: 'not_started',
      tier: 0,
      verificationMode: 'none',
      verifiedAt: null,
    },
    notifications: demoNotifications(now),
    profile: {
      avatarUrl: null,
      displayName: 'Amina Bello',
      firstName: 'Amina',
    },
    services: demoServices(scenario),
    unreadNotificationCount: demoNotifications(now).filter(
      (notification) => !notification.readAt,
    ).length,
    wallet:
      scenario === 'new-user'
        ? {
            availableMinor: 0,
            balanceMinor: 0,
            currency: 'NGN',
            hideBalance: hideDemoBalance,
            id: 'demo-wallet-new',
            reservedMinor: 0,
            status: 'active',
            updatedAt: now.toISOString(),
          }
        : {
            availableMinor: 2_548_500,
            balanceMinor: 2_898_500,
            currency: 'NGN',
            hideBalance: hideDemoBalance,
            id: 'demo-wallet-funded',
            reservedMinor: 350_000,
            status: 'active',
            updatedAt: now.toISOString(),
          },
    walletActions: {
      funding: {
        accessCode: 'available',
        canTransact: true,
        key: 'wallet_funding',
        message: 'Permanent account funding is ready in this preview.',
        requiredKycTier: 0,
        requiredVerificationMode: 'live',
        rollout: 'testers',
        state: 'available',
      },
      withdrawal: {
        accessCode: 'feature_disabled',
        canTransact: false,
        key: 'wallet_withdrawal',
        message: 'Withdrawals remain disabled in this preview.',
        requiredKycTier: 0,
        requiredVerificationMode: 'live',
        rollout: 'off',
        state: 'coming_soon',
      },
    },
  };
}

async function waitForDemo() {
  await new Promise((resolve) => setTimeout(resolve, DEMO_DELAY_MS));
}

export function resetDemoRepositoryStateForTests() {
  hideDemoBalance = false;
  readDemoNotifications.clear();
}

function throwForScenario(scenario: DemoScenario) {
  if (scenario === 'offline') {
    throw new BillyRepositoryError(
      'network',
      'This demo is showing Billy’s offline state. Restore the funded demo scenario to continue.',
    );
  }
  if (scenario === 'error') {
    throw new BillyRepositoryError(
      'unavailable',
      'This demo is showing a recoverable service error. Your financial records were not changed.',
    );
  }
}

export function createDemoRepository(scenario: DemoScenario): BillyMainRepository {
  return {
    async getActivityPage(cursor) {
      await waitForDemo();
      throwForScenario(scenario);
      const activity = buildSnapshot(scenario).activity;
      const startIndex = cursor
        ? activity.findIndex(
            (item) =>
              item.createdAt === cursor.createdAt && item.id === cursor.id,
          ) + 1
        : 0;
      const items = activity.slice(Math.max(0, startIndex), startIndex + 30);
      return {
        items,
        nextCursor:
          startIndex + items.length < activity.length && items.length
            ? {
                createdAt: items[items.length - 1].createdAt,
                id: items[items.length - 1].id,
              }
            : null,
      };
    },
    async getDashboard() {
      await waitForDemo();
      throwForScenario(scenario);
      return buildSnapshot(scenario);
    },
    async getNotifications() {
      await waitForDemo();
      throwForScenario(scenario);
      return buildSnapshot(scenario).notifications;
    },
    async getTransaction(id) {
      await waitForDemo();
      throwForScenario(scenario);
      const item = buildSnapshot(scenario).activity.find((candidate) => candidate.id === id);
      if (!item) return null;

      const detail: TransactionDetail = {
        ...item,
        events: [
          {
            id: `${id}-created`,
            message: 'Billy created this preview transaction.',
            occurredAt: item.createdAt,
            status: 'created',
          },
          {
            id: `${id}-latest`,
            message:
              item.status === 'succeeded'
                ? 'The preview transaction reached a successful final state.'
                : 'The preview transaction is waiting for a final state.',
            occurredAt: item.completedAt ?? item.createdAt,
            status: item.status,
          },
        ],
        receipt:
          item.status === 'succeeded' || item.status === 'refunded'
            ? {
                amountMinor: item.amountMinor,
                currency: item.currency,
                feeMinor: item.feeMinor,
                id: `${id}-receipt`,
                issuedAt: item.completedAt ?? item.createdAt,
                reference: item.reference,
                title: item.title,
                totalMinor: item.totalMinor,
              }
            : null,
      };
      return detail;
    },
    async markNotificationRead(id) {
      await waitForDemo();
      readDemoNotifications.add(id);
    },
    async setHideBalance(hidden) {
      await waitForDemo();
      hideDemoBalance = hidden;
    },
  };
}
