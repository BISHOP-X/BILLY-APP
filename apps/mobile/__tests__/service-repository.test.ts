import {
  createDemoServiceRepository,
  resetDemoServiceState,
} from '@/features/services/demo-service-repository';
import type {
  BillSelection,
  BillyServiceRepository,
} from '@/features/services/domain';

jest.mock('@/features/main/repository', () => ({
  billyDemoScenario: 'funded',
}));

async function completeDemoRequest<T>(request: Promise<T>) {
  await jest.runAllTimersAsync();
  return request;
}

const airtimeSelection: BillSelection = {
  amountMinor: 50_000,
  category: 'airtime',
  contactPhone: '08012345678',
  customerReference: '08012345678',
  productId: null,
  serviceId: 'demo-airtime-mtn',
};

describe('demo service repository', () => {
  let repository: BillyServiceRepository;

  beforeEach(() => {
    jest.useFakeTimers();
    resetDemoServiceState();
    repository = createDemoServiceRepository();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates one reusable permanent Paga account and returns it on replay', async () => {
    const first = await completeDemoRequest(
      repository.createFundingAccount(),
    );
    const second = await completeDemoRequest(
      repository.createFundingAccount(),
    );
    const read = await completeDemoRequest(repository.getFundingAccount());

    expect(first.account).toMatchObject({
      bankName: 'Paga',
      currency: 'NGN',
      isPermanent: true,
      status: 'active',
    });
    expect(second.account?.id).toBe(first.account?.id);
    expect(read.account?.id).toBe(first.account?.id);
  });

  it('loads provider-shaped bill choices only through the repository boundary', async () => {
    const catalog = await completeDemoRequest(
      repository.getBillCatalog('electricity'),
    );

    expect(catalog.category.key).toBe('electricity');
    expect(catalog.isPreview).toBe(true);
    expect(catalog.services.length).toBeGreaterThan(0);
    expect(
      catalog.services.every((service) => service.products.length > 0),
    ).toBe(true);
  });

  it('validates, quotes, and purchases a bill with exact minor-unit totals', async () => {
    const validation = await completeDemoRequest(
      repository.validateBillCustomer(airtimeSelection),
    );
    const quote = await completeDemoRequest(
      repository.quoteBill({ selection: airtimeSelection }),
    );
    const order = await completeDemoRequest(
      repository.purchaseBill({
        idempotencyKey: 'bill-test-operation-0001',
        pin: '123456',
        quoteId: quote.id,
      }),
    );
    const rediscovered = await completeDemoRequest(
      repository.getBillOrderForTransaction(order.transactionId),
    );

    expect(validation.validated).toBe(true);
    expect(quote).toMatchObject({
      amountMinor: 50_000,
      feeMinor: 0,
      totalMinor: 50_000,
    });
    expect(order).toMatchObject({
      category: 'airtime',
      status: 'succeeded',
    });
    expect(rediscovered?.id).toBe(order.id);
  });

  it('returns the original bill order when the same operation is retried', async () => {
    const quote = await completeDemoRequest(
      repository.quoteBill({ selection: airtimeSelection }),
    );
    const request = {
      idempotencyKey: 'bill-test-operation-0002',
      pin: '123456',
      quoteId: quote.id,
    };

    const first = await completeDemoRequest(repository.purchaseBill(request));
    const replay = await completeDemoRequest(repository.purchaseBill(request));

    expect(replay).toEqual(first);
  });

  it('rejects malformed destinations and incomplete transaction PINs', async () => {
    const invalidSelectionRequest = repository.quoteBill({
      selection: {
        ...airtimeSelection,
        contactPhone: '123',
        customerReference: '123',
      },
    });
    const invalidSelection = expect(invalidSelectionRequest).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await jest.runAllTimersAsync();
    await invalidSelection;

    const quote = await completeDemoRequest(
      repository.quoteBill({ selection: airtimeSelection }),
    );
    const invalidPinRequest = repository.purchaseBill({
      idempotencyKey: 'bill-test-operation-0003',
      pin: '1234',
      quoteId: quote.id,
    });
    const invalidPin = expect(invalidPinRequest).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await jest.runAllTimersAsync();
    await invalidPin;
  });

  it('stores only a masked identifier for protected-service verification', async () => {
    const check = await completeDemoRequest(
      repository.submitKyc({
        consentVersion: 'identity-verification-v1',
        idempotencyKey: 'kyc-test-operation-0001',
        method: 'bvn_basic',
        number: '12345678901',
      }),
    );
    const history = await completeDemoRequest(repository.getKycChecks());

    expect(check).toMatchObject({
      maskedIdentifier: '*******8901',
      method: 'bvn_basic',
      status: 'verified',
    });
    expect(JSON.stringify(history)).not.toContain('12345678901');
  });

  it('refreshes a pending identity check without resubmitting the identity number', async () => {
    const pending = await completeDemoRequest(
      repository.submitKyc({
        consentVersion: 'identity-verification-v1',
        idempotencyKey: 'kyc-test-operation-0002',
        method: 'bvn_basic',
        number: '22222222222',
      }),
    );
    expect(pending.status).toBe('pending');

    const refreshed = await completeDemoRequest(
      repository.refreshKycCheck(pending.id),
    );

    expect(refreshed).toMatchObject({
      id: pending.id,
      maskedIdentifier: '*******2222',
      status: 'verified',
    });
    expect(JSON.stringify(refreshed)).not.toContain('22222222222');
  });
});
