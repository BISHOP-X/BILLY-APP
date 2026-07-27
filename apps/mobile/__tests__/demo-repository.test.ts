import type { BillyMainRepository } from '@/features/main/domain';
import {
  createDemoRepository,
  resetDemoRepositoryStateForTests,
} from '@/features/main/demo-repository';

async function completeDemoRequest<T>(request: Promise<T>) {
  await jest.runAllTimersAsync();
  return request;
}

describe('demo repository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetDemoRepositoryStateForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a balanced funded dashboard and receipt-ready activity', async () => {
    const repository = createDemoRepository('funded');

    const snapshot = await completeDemoRequest(repository.getDashboard());

    expect(snapshot.dataSource).toBe('demo');
    expect(snapshot.demoScenario).toBe('funded');
    expect(snapshot.wallet).toMatchObject({
      availableMinor: 2_548_500,
      balanceMinor: 2_898_500,
      currency: 'NGN',
      reservedMinor: 350_000,
      status: 'active',
    });
    expect(
      snapshot.wallet!.availableMinor + snapshot.wallet!.reservedMinor,
    ).toBe(snapshot.wallet!.balanceMinor);
    expect(snapshot.activity).toHaveLength(4);
    expect(snapshot.services).toHaveLength(6);
    expect(
      snapshot.services.find((service) => service.key === 'bills'),
    ).toMatchObject({
      accessCode: 'available',
      canTransact: true,
      requiresKyc: false,
      rollout: 'testers',
      state: 'available',
    });
    expect(
      snapshot.services
        .filter((service) => !['bills', 'crypto'].includes(service.key))
        .every((service) => !service.canTransact),
    ).toBe(true);
    expect(
      snapshot.services.find((service) => service.key === 'crypto'),
    ).toMatchObject({
      accessCode: 'available',
      canTransact: true,
      requiredKycTier: 1,
      requiresKyc: true,
      rollout: 'testers',
      state: 'available',
    });
    expect(
      snapshot.services.find((service) => service.key === 'gift_cards'),
    ).toMatchObject({
      requiredKycTier: 0,
      requiresKyc: false,
    });
    expect(snapshot.walletActions.funding).toMatchObject({
      accessCode: 'available',
      canTransact: true,
      requiredKycTier: 0,
      rollout: 'testers',
      state: 'available',
    });

    const transaction = await completeDemoRequest(
      repository.getTransaction('demo-tx-funding'),
    );

    expect(transaction).toMatchObject({
      id: 'demo-tx-funding',
      receipt: {
        reference: 'BLY-DEMO-10001',
      },
      status: 'succeeded',
    });
    expect(transaction?.events).toHaveLength(2);
  });

  it('returns a safe zero-balance new-user state', async () => {
    const repository = createDemoRepository('new-user');

    const snapshot = await completeDemoRequest(repository.getDashboard());

    expect(snapshot.activity).toEqual([]);
    expect(snapshot.wallet).toMatchObject({
      availableMinor: 0,
      balanceMinor: 0,
      reservedMinor: 0,
      status: 'active',
    });
  });

  it('fails reads with a typed network error in the offline scenario', async () => {
    const repository = createDemoRepository('offline');
    const request = repository.getDashboard();
    const rejection = expect(request).rejects.toMatchObject({
      code: 'network',
      name: 'BillyRepositoryError',
    });

    await jest.runAllTimersAsync();
    await rejection;
  });

  it('marks only the affected services as under maintenance', async () => {
    const repository = createDemoRepository('maintenance');

    const snapshot = await completeDemoRequest(repository.getDashboard());
    const maintenanceKeys = snapshot.services
      .filter((service) => service.state === 'maintenance')
      .map((service) => service.key);

    expect(maintenanceKeys).toEqual(['bills', 'crypto']);
    expect(
      snapshot.services
        .filter((service) => !maintenanceKeys.includes(service.key))
        .every((service) => service.state === 'coming_soon'),
    ).toBe(true);
  });

  it('persists privacy and notification mutations across subsequent reads', async () => {
    const repository: BillyMainRepository = createDemoRepository('funded');

    await completeDemoRequest(repository.setHideBalance(true));
    await completeDemoRequest(
      repository.markNotificationRead('demo-notification-ready'),
    );

    const snapshot = await completeDemoRequest(repository.getDashboard());
    const readyNotification = snapshot.notifications.find(
      (notification) => notification.id === 'demo-notification-ready',
    );
    const securityNotification = snapshot.notifications.find(
      (notification) => notification.id === 'demo-notification-security',
    );

    expect(snapshot.wallet?.hideBalance).toBe(true);
    expect(readyNotification?.readAt).not.toBeNull();
    expect(securityNotification?.readAt).toBeNull();
  });
});
