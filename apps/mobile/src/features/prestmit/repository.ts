import { isBillyDevDemo } from '@/features/main/repository';
import { invokeAction } from '@/features/services/supabase-service-repository';
import { supabase } from '@/lib/supabase/client';

import type {
  BuyCardCatalog,
  BuyCardQuote,
  CardFulfilment,
  CardServiceKey,
  PrestmitOrder,
  PrestmitRepository,
  SellCardCategoryCatalog,
  SellCardProductCatalog,
  SellCardQuote,
} from './domain';

const syntheticBuyCatalog: BuyCardCatalog = {
  fetchedAt: new Date().toISOString(),
  isPreview: true,
  products: [
    {
      brand: 'Amazon',
      categories: ['Shopping'],
      currencyCode: 'USD',
      currencySymbol: '$',
      isPreOrder: false,
      maximumFaceValueMinor: 50_000,
      minimumFaceValueMinor: 1_000,
      regions: ['United States'],
      selectionToken: 'synthetic-amazon-us',
      title: 'Amazon US Gift Card',
    },
    {
      brand: 'Apple',
      categories: ['Entertainment'],
      currencyCode: 'USD',
      currencySymbol: '$',
      isPreOrder: false,
      maximumFaceValueMinor: 50_000,
      minimumFaceValueMinor: 500,
      regions: ['United States'],
      selectionToken: 'synthetic-apple-us',
      title: 'Apple US Gift Card',
    },
    {
      brand: 'Steam',
      categories: ['Gaming'],
      currencyCode: 'USD',
      currencySymbol: '$',
      isPreOrder: false,
      maximumFaceValueMinor: 20_000,
      minimumFaceValueMinor: 1_000,
      regions: ['Global'],
      selectionToken: 'synthetic-steam',
      title: 'Steam Gift Card',
    },
  ],
};

const syntheticPrepaidCatalog: BuyCardCatalog = {
  fetchedAt: new Date().toISOString(),
  isPreview: true,
  products: [
    {
      brand: 'Visa',
      categories: ['Prepaid Cards'],
      currencyCode: 'USD',
      currencySymbol: '$',
      isPreOrder: false,
      maximumFaceValueMinor: 100_000,
      minimumFaceValueMinor: 1_000,
      regions: ['Global'],
      selectionToken: 'synthetic-usd-visa',
      title: 'USD Visa Prepaid Card',
    },
    {
      brand: 'Mastercard',
      categories: ['Prepaid Cards'],
      currencyCode: 'CAD',
      currencySymbol: 'CA$',
      isPreOrder: true,
      maximumFaceValueMinor: 75_000,
      minimumFaceValueMinor: 1_000,
      regions: ['Canada'],
      selectionToken: 'synthetic-cad-mastercard',
      title: 'CAD Mastercard Prepaid Card',
    },
  ],
};

function action(service: CardServiceKey, suffix: string) {
  return `${service === 'prepaid_cards' ? 'prepaid' : 'giftcards'}.${
    suffix
  }`;
}

function liveRepository(): PrestmitRepository {
  return {
    getBuyCatalog: (service) =>
      invokeAction<BuyCardCatalog>(
        service === 'prepaid_cards' ? 'prepaid.catalog' : 'giftcards.buy.catalog',
      ),
    getOrder: (orderId, service) =>
      invokeAction<PrestmitOrder>(action(service, 'order.get'), { orderId }),
    getOrders: (service) =>
      invokeAction<PrestmitOrder[]>(action(service, 'orders')),
    getSellCategories: () =>
      invokeAction<SellCardCategoryCatalog>('giftcards.sell.categories'),
    getSellProducts: (categoryToken) =>
      invokeAction<SellCardProductCatalog>('giftcards.sell.products', {
        categoryToken,
      }),
    purchase: ({ idempotencyKey, pin, quoteId, service }) =>
      invokeAction<PrestmitOrder>(
        service === 'prepaid_cards'
          ? 'prepaid.purchase'
          : 'giftcards.buy.purchase',
        { idempotencyKey, pin, quoteId },
      ),
    quoteBuy: ({ faceValueMinor, quantity, selectionToken, service }) =>
      invokeAction<BuyCardQuote>(
        service === 'prepaid_cards' ? 'prepaid.quote' : 'giftcards.buy.quote',
        { faceValueMinor, quantity, selectionToken },
      ),
    quoteSell: ({ faceValueMinor, selectionToken }) =>
      invokeAction<SellCardQuote>('giftcards.sell.quote', {
        faceValueMinor,
        selectionToken,
      }),
    refreshOrder: (orderId, service) =>
      invokeAction<PrestmitOrder>(action(service, 'order.refresh'), { orderId }),
    reveal: (orderId, pin, service) =>
      invokeAction<CardFulfilment>(action(service, 'order.reveal'), {
        orderId,
        pin,
      }),
    submitSell: (input) =>
      invokeAction<PrestmitOrder>('giftcards.sell.submit', input),
    async uploadEvidence(orderKey, asset) {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user.id;
      if (!userId) throw new Error('Sign in again to upload gift card evidence.');
      const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
      const objectId = crypto.randomUUID();
      const path = `${userId}/${orderKey}/${objectId}.${extension}`;
      const response = await fetch(asset.uri);
      const bytes = await response.arrayBuffer();
      const upload = await supabase.storage
        .from('gift-card-evidence')
        .upload(path, bytes, {
          contentType: asset.mimeType,
          upsert: false,
        });
      if (upload.error) throw upload.error;
      return path;
    },
  };
}

function syntheticOrder(
  service: CardServiceKey,
  productTitle: string,
  amountMinor: number,
  tradeType: PrestmitOrder['tradeType'],
  options?: {
    faceCurrency?: string;
    faceValueMinor?: number;
    feeMinor?: number;
    quantity?: number;
  },
): PrestmitOrder {
  const now = new Date().toISOString();
  return {
    amountMinor,
    completedAt: tradeType === 'gift_card_sell' ? null : now,
    createdAt: now,
    currency: 'NGN',
    evidenceMode: tradeType === 'gift_card_sell' ? 'ecode' : null,
    faceCurrency: options?.faceCurrency ?? 'USD',
    faceValueMinor: options?.faceValueMinor ?? 1_000,
    feeMinor: options?.feeMinor ?? 20_000,
    fulfilmentAvailable: tradeType !== 'gift_card_sell',
    id: crypto.randomUUID(),
    isPreview: true,
    productTitle,
    quantity: options?.quantity ?? 1,
    serviceKey: service,
    status: tradeType === 'gift_card_sell' ? 'pending' : 'succeeded',
    statusMessage:
      tradeType === 'gift_card_sell'
        ? 'Your gift card is under review.'
        : 'Your card order was delivered securely.',
    tradeType,
    transactionId: tradeType === 'gift_card_sell' ? null : crypto.randomUUID(),
    updatedAt: now,
  };
}

function demoRepository(): PrestmitRepository {
  const orders: PrestmitOrder[] = [];
  const buyQuotes = new Map<string, BuyCardQuote>();
  const sellQuotes = new Map<string, SellCardQuote>();
  return {
    async getBuyCatalog(service) {
      return service === 'prepaid_cards'
        ? syntheticPrepaidCatalog
        : syntheticBuyCatalog;
    },
    async getOrder(orderId) {
      const found = orders.find((entry) => entry.id === orderId);
      if (!found) throw new Error('Preview order was not found.');
      return found;
    },
    async getOrders(service) {
      return orders.filter((entry) => entry.serviceKey === service);
    },
    async getSellCategories() {
      return {
        categories: [
          { name: 'Amazon', selectionToken: 'synthetic-amazon' },
          { name: 'Apple', selectionToken: 'synthetic-apple' },
          { name: 'Steam', selectionToken: 'synthetic-steam' },
        ],
        fetchedAt: new Date().toISOString(),
        isPreview: true,
      };
    },
    async getSellProducts(categoryToken) {
      const label = categoryToken.replace('synthetic-', '');
      return {
        category: label.charAt(0).toUpperCase() + label.slice(1),
        products: [
          {
            country: 'United States',
            currencyCode: 'USD',
            currencySymbol: '$',
            form: categoryToken.includes('apple') ? 'ecode' : 'physical_or_ecode',
            maximumFaceValueMinor: 50_000,
            minimumFaceValueMinor: 1_000,
            selectionToken: `${categoryToken}-us`,
            title: `${label.charAt(0).toUpperCase() + label.slice(1)} US`,
          },
        ],
      };
    },
    async purchase({ quoteId, service }) {
      const quote = buyQuotes.get(quoteId);
      if (!quote) throw new Error('This preview quote has expired.');
      const order = syntheticOrder(
        service,
        quote.productTitle,
        quote.amountMinor,
        service === 'prepaid_cards' ? 'prepaid_card' : 'gift_card_buy',
        {
          faceCurrency: quote.faceCurrency,
          faceValueMinor: quote.faceValueMinor,
          feeMinor: quote.feeMinor,
          quantity: quote.quantity,
        },
      );
      orders.unshift(order);
      return order;
    },
    async quoteBuy({ faceValueMinor, quantity, selectionToken, service }) {
      const catalog =
        service === 'prepaid_cards' ? syntheticPrepaidCatalog : syntheticBuyCatalog;
      const product =
        catalog.products.find((entry) => entry.selectionToken === selectionToken) ??
        catalog.products[0];
      const amountMinor = faceValueMinor * quantity * 1_600;
      const feeMinor = Math.ceil(amountMinor * 0.02);
      const quote = {
        amountMinor,
        currency: 'NGN',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        faceCurrency: product.currencyCode,
        faceValueMinor,
        feeMinor,
        productTitle: product.title,
        quantity,
        quoteId: `preview-${selectionToken}-${faceValueMinor}-${quantity}`,
        totalMinor: amountMinor + feeMinor,
      } satisfies BuyCardQuote;
      buyQuotes.set(quote.quoteId, quote);
      return quote;
    },
    async quoteSell({ faceValueMinor, selectionToken }) {
      const grossPayoutMinor = Math.round((faceValueMinor / 100) * 150_000);
      const feeMinor = Math.ceil(grossPayoutMinor * 0.02);
      const quote = {
        currency: 'NGN',
        evidenceForm: selectionToken.includes('apple')
          ? 'ecode'
          : 'physical_or_ecode',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        faceCurrency: 'USD',
        faceValueMinor,
        feeMinor,
        grossPayoutMinor,
        payoutMinor: grossPayoutMinor - feeMinor,
        productTitle: 'Preview Gift Card',
        quoteId: `preview-sell-${selectionToken}-${faceValueMinor}`,
        rateMinorPerUnit: 150_000,
      } satisfies SellCardQuote;
      sellQuotes.set(quote.quoteId, quote);
      return quote;
    },
    async refreshOrder(orderId) {
      const found = orders.find((entry) => entry.id === orderId);
      if (!found) throw new Error('Preview order was not found.');
      return found;
    },
    async reveal() {
      return {
        codes: [
          {
            cardNumber: 'SYNTHETIC-TEST-CARD',
            claimUrl: 'https://example.invalid/synthetic-card',
            pin: '0000',
          },
        ],
        deliveredAt: new Date().toISOString(),
      };
    },
    async submitSell({ quoteId }) {
      const quote = sellQuotes.get(quoteId);
      if (!quote) throw new Error('This preview quote has expired.');
      const order = syntheticOrder(
        'gift_cards',
        quote.productTitle,
        quote.payoutMinor,
        'gift_card_sell',
        {
          faceCurrency: quote.faceCurrency,
          faceValueMinor: quote.faceValueMinor,
          feeMinor: quote.feeMinor,
        },
      );
      orders.unshift(order);
      return order;
    },
    async uploadEvidence(orderKey, asset) {
      return `preview-user/${orderKey}/${asset.fileName}`;
    },
  };
}

export const prestmitRepository: PrestmitRepository = isBillyDevDemo
  ? demoRepository()
  : liveRepository();
