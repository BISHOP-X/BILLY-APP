import { socialBoostRepository } from '@/features/social-boost/repository';

jest.mock('@/features/main/repository', () => ({
  isBillyDevDemo: true,
}));

jest.mock('@/features/services/supabase-service-repository', () => ({
  invokeAction: jest.fn(),
}));

describe('Social Boost preview journey', () => {
  it('completes catalog, quote, order, delivery and refill without provider keys', async () => {
    const catalog = await socialBoostRepository.catalog({
      platform: 'instagram',
    });
    expect(catalog.services).toHaveLength(1);
    const service = catalog.services[0];
    const quote = await socialBoostRepository.quote(
      service.selectionToken,
      service.minimumQuantity,
    );
    expect(quote.totalMinor).toBeGreaterThan(0);

    const order = await socialBoostRepository.submitOrder({
      idempotencyKey: 'preview-social-operation-0001',
      pin: '123456',
      quoteId: quote.quoteId,
      target: 'https://instagram.com/billy.preview',
    });
    expect(order.status).toBe('pending');

    const completed = await socialBoostRepository.refreshOrder(order.id);
    expect(completed.status).toBe('succeeded');
    expect(completed.deliveredQuantity).toBe(completed.quantity);

    const refill = await socialBoostRepository.createRefill({
      idempotencyKey: 'preview-social-refill-00001',
      orderId: order.id,
    });
    expect(refill.status).toBe('pending');
    await expect(socialBoostRepository.refills(order.id)).resolves.toHaveLength(
      1,
    );
  });

  it('does not represent a cancellation request as a confirmed refund', async () => {
    const service = (
      await socialBoostRepository.catalog({ platform: 'twitter' })
    ).services[0];
    const quote = await socialBoostRepository.quote(
      service.selectionToken,
      service.minimumQuantity,
    );
    const order = await socialBoostRepository.submitOrder({
      idempotencyKey: 'preview-social-operation-0002',
      pin: '123456',
      quoteId: quote.quoteId,
      target: 'https://x.com/billy/status/123',
    });
    const requested = await socialBoostRepository.cancelOrder(order.id);
    expect(requested.status).toBe('cancellation_requested');
    expect(requested.refundMinor).toBe(0);
    const confirmed = await socialBoostRepository.refreshOrder(order.id);
    expect(confirmed.status).toBe('cancelled');
    expect(confirmed.refundMinor).toBe(confirmed.totalMinor);
  });
});
