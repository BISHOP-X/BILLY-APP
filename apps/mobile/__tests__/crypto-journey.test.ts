import { cryptoRepository } from '@/features/crypto/repository';

jest.mock('@/features/main/repository', () => ({
  isBillyDevDemo: true,
}));

jest.mock('@/features/services/supabase-service-repository', () => ({
  invokeAction: jest.fn(),
}));

describe('Quidax crypto preview journey', () => {
  it('completes Buy, Sell, Receive and Send without provider credentials', async () => {
    const buyAssets = await cryptoRepository.assets('buy');
    const usdt = buyAssets.assets.find((asset) => asset.symbol === 'USDT');
    expect(usdt).toBeDefined();
    const network = usdt!.networks[0];

    const buyQuote = await cryptoRepository.buyQuote(
      network.selectionToken,
      100_000,
    );
    expect(buyQuote.totalMinor).toBeGreaterThan(100_000);
    const bought = await cryptoRepository.submitTrade({
      action: 'buy',
      idempotencyKey: 'preview-buy-operation-0001',
      pin: '123456',
      quoteId: buyQuote.quoteId,
    });
    expect(bought.status).toBe('succeeded');

    const sellQuote = await cryptoRepository.sellQuote(
      network.selectionToken,
      '1.25',
    );
    expect(sellQuote.fiatAmountMinor).toBeGreaterThan(0);
    const sold = await cryptoRepository.submitTrade({
      action: 'sell',
      idempotencyKey: 'preview-sell-operation-0001',
      pin: '123456',
      quoteId: sellQuote.quoteId,
    });
    expect(sold.status).toBe('succeeded');

    const receiving = await cryptoRepository.receiveAddress(
      network.selectionToken,
    );
    expect(receiving.status).toBe('ready');
    expect(receiving.address).toMatch(/^T/);

    const sendQuote = await cryptoRepository.sendQuote(
      network.selectionToken,
      '2',
    );
    expect(Number(sendQuote.networkFee)).toBeGreaterThanOrEqual(0);
    const sent = await cryptoRepository.submitSend({
      address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
      idempotencyKey: 'preview-send-operation-0001',
      pin: '123456',
      quoteId: sendQuote.quoteId,
    });
    expect(sent.status).toBe('succeeded');
    expect(sent.transactionHash).toBeTruthy();

    const orders = await cryptoRepository.orders();
    expect(orders.map((order) => order.action)).toEqual([
      'send',
      'sell',
      'buy',
    ]);
  });
});
