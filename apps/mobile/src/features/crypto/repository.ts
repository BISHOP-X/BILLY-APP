import { isBillyDevDemo } from '@/features/main/repository';
import { invokeAction } from '@/features/services/supabase-service-repository';

import type {
  CryptoAddress,
  CryptoAsset,
  CryptoAssetCatalog,
  CryptoOperation,
  CryptoOrder,
  CryptoPortfolio,
  CryptoRepository,
  CryptoSendQuote,
  CryptoTradeQuote,
} from './domain';

const syntheticAssets: CryptoAsset[] = [
  {
    balance: '125.50',
    locked: '0',
    name: 'Tether',
    networks: [
      {
        depositEnabled: true,
        id: 'trc20',
        name: 'TRON',
        selectionToken: 'preview-usdt-trc20',
        withdrawEnabled: true,
      },
      {
        depositEnabled: true,
        id: 'erc20',
        name: 'Ethereum',
        selectionToken: 'preview-usdt-erc20',
        withdrawEnabled: true,
      },
    ],
    symbol: 'USDT',
  },
  {
    balance: '0.0274',
    locked: '0',
    name: 'Bitcoin',
    networks: [
      {
        depositEnabled: true,
        id: 'bitcoin',
        name: 'Bitcoin',
        selectionToken: 'preview-btc-bitcoin',
        withdrawEnabled: true,
      },
    ],
    symbol: 'BTC',
  },
  {
    balance: '0.42',
    locked: '0',
    name: 'Ethereum',
    networks: [
      {
        depositEnabled: true,
        id: 'erc20',
        name: 'Ethereum',
        selectionToken: 'preview-eth-erc20',
        withdrawEnabled: true,
      },
    ],
    symbol: 'ETH',
  },
];

function liveRepository(): CryptoRepository {
  return {
    assets: (operation) =>
      invokeAction<CryptoAssetCatalog>('crypto.assets', { operation }),
    buyQuote: (selectionToken, fiatAmountMinor) =>
      invokeAction<CryptoTradeQuote>('crypto.buy.quote', {
        fiatAmountMinor,
        selectionToken,
      }),
    orders: () => invokeAction<CryptoOrder[]>('crypto.orders'),
    portfolio: () => invokeAction<CryptoPortfolio>('crypto.portfolio'),
    receiveAddress: (selectionToken) =>
      invokeAction<CryptoAddress>('crypto.receive.address', { selectionToken }),
    refreshOrder: (orderId) =>
      invokeAction<CryptoOrder>('crypto.order.refresh', { orderId }),
    sellQuote: (selectionToken, tokenAmount) =>
      invokeAction<CryptoTradeQuote>('crypto.sell.quote', {
        selectionToken,
        tokenAmount,
      }),
    sendQuote: (selectionToken, tokenAmount) =>
      invokeAction<CryptoSendQuote>('crypto.send.quote', {
        selectionToken,
        tokenAmount,
      }),
    submitSend: (input) =>
      invokeAction<CryptoOrder>('crypto.send.submit', input),
    submitTrade: ({ action, ...input }) =>
      invokeAction<CryptoOrder>(`crypto.${action}.submit`, input),
  };
}

function demoRepository(): CryptoRepository {
  const previewOrders: CryptoOrder[] = [];
  const quotes = new Map<string, CryptoTradeQuote | CryptoSendQuote>();
  const selection = (token: string) => {
    const [asset = 'USDT', network = 'trc20'] = token
      .replace('preview-', '')
      .split('-');
    return { asset: asset.toUpperCase(), network };
  };
  const createOrder = (
    action: CryptoOrder['action'],
    quote: CryptoTradeQuote | CryptoSendQuote,
    destinationAddress: string | null = null,
  ): CryptoOrder => {
    const now = new Date().toISOString();
    const trade = 'fiatAmountMinor' in quote ? quote : null;
    const order: CryptoOrder = {
      action,
      asset: quote.asset,
      completedAt: now,
      createdAt: now,
      destinationAddress,
      destinationTag: null,
      feeMinor: trade?.feeMinor ?? 0,
      fiatAmountMinor: trade?.fiatAmountMinor ?? null,
      id: crypto.randomUUID(),
      isPreview: true,
      network: quote.network,
      status: 'succeeded',
      statusMessage:
        action === 'send'
          ? 'Preview transfer completed.'
          : `Preview crypto ${action} completed.`,
      tokenAmount: quote.tokenAmount,
      transactionHash: action === 'send' ? 'preview-chain-hash' : null,
      transactionId: crypto.randomUUID(),
      updatedAt: now,
    };
    previewOrders.unshift(order);
    return order;
  };
  return {
    async assets(_operation: CryptoOperation) {
      return { assets: syntheticAssets, isPreview: true };
    },
    async buyQuote(token, fiatAmountMinor) {
      const selected = selection(token);
      const feeMinor = Math.ceil(fiatAmountMinor * 0.01);
      const quote: CryptoTradeQuote = {
        action: 'buy',
        ...selected,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        feeMinor,
        fiatAmountMinor,
        quoteId: `preview-buy-${Date.now()}`,
        tokenAmount: (fiatAmountMinor / 160_000_000).toFixed(6),
        totalMinor: fiatAmountMinor + feeMinor,
      };
      quotes.set(quote.quoteId, quote);
      return quote;
    },
    async orders() {
      return previewOrders;
    },
    async portfolio() {
      return {
        assets: syntheticAssets,
        isPreview: true,
        updatedAt: new Date().toISOString(),
      };
    },
    async receiveAddress(token) {
      const selected = selection(token);
      return {
        ...selected,
        address:
          selected.network === 'bitcoin'
            ? 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
            : 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
        status: 'ready',
      };
    },
    async refreshOrder(orderId) {
      const found = previewOrders.find((order) => order.id === orderId);
      if (!found) throw new Error('Preview crypto order was not found.');
      return found;
    },
    async sellQuote(token, tokenAmount) {
      const selected = selection(token);
      const grossPayoutMinor = Math.round(Number(tokenAmount) * 160_000_000);
      const feeMinor = Math.ceil(grossPayoutMinor * 0.01);
      const quote: CryptoTradeQuote = {
        action: 'sell',
        ...selected,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        feeMinor,
        fiatAmountMinor: grossPayoutMinor - feeMinor,
        grossPayoutMinor,
        payoutMinor: grossPayoutMinor - feeMinor,
        quoteId: `preview-sell-${Date.now()}`,
        tokenAmount,
      };
      quotes.set(quote.quoteId, quote);
      return quote;
    },
    async sendQuote(token, tokenAmount) {
      const selected = selection(token);
      const quote: CryptoSendQuote = {
        ...selected,
        availableBalance: '125.50',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        networkFee: selected.network === 'trc20' ? '1' : '0.0002',
        quoteId: `preview-send-${Date.now()}`,
        tokenAmount,
      };
      quotes.set(quote.quoteId, quote);
      return quote;
    },
    async submitSend({ address, quoteId }) {
      const quote = quotes.get(quoteId);
      if (!quote) throw new Error('This preview quote has expired.');
      return createOrder('send', quote, address);
    },
    async submitTrade({ action, quoteId }) {
      const quote = quotes.get(quoteId);
      if (!quote || !('fiatAmountMinor' in quote)) {
        throw new Error('This preview quote has expired.');
      }
      return createOrder(action, quote);
    },
  };
}

export const cryptoRepository = isBillyDevDemo
  ? demoRepository()
  : liveRepository();
