import { isBillyDevDemo } from '@/features/main/repository';
import { invokeAction } from '@/features/services/supabase-service-repository';

import type {
  SocialBoostCatalog,
  SocialBoostOrder,
  SocialBoostQuote,
  SocialBoostRefill,
  SocialBoostRepository,
  SocialBoostService,
} from './domain';

const previewServices: SocialBoostService[] = [
  {
    cancelAvailable: true,
    category: 'Instagram Followers',
    inputKind: 'default',
    maximumQuantity: 100_000,
    minimumQuantity: 100,
    name: 'Stable Followers',
    platform: 'instagram',
    rateMicroUsdPerThousand: 900_000,
    refillAvailable: true,
    selectionToken: 'preview-social-1001',
    type: 'Default',
  },
  {
    cancelAvailable: true,
    category: 'TikTok Views',
    inputKind: 'default',
    maximumQuantity: 1_000_000,
    minimumQuantity: 500,
    name: 'Video Views',
    platform: 'tiktok',
    rateMicroUsdPerThousand: 120_000,
    refillAvailable: false,
    selectionToken: 'preview-social-1002',
    type: 'Default',
  },
  {
    cancelAvailable: false,
    category: 'YouTube Engagement',
    inputKind: 'comments',
    maximumQuantity: 1_000,
    minimumQuantity: 5,
    name: 'Custom Comments',
    platform: 'youtube',
    rateMicroUsdPerThousand: 8_000_000,
    refillAvailable: false,
    selectionToken: 'preview-social-1003',
    type: 'Custom Comments',
  },
  {
    cancelAvailable: true,
    category: 'X / Twitter Engagement',
    inputKind: 'default',
    maximumQuantity: 50_000,
    minimumQuantity: 50,
    name: 'Post Likes',
    platform: 'twitter',
    rateMicroUsdPerThousand: 1_100_000,
    refillAvailable: false,
    selectionToken: 'preview-social-1004',
    type: 'Default',
  },
];

function liveRepository(): SocialBoostRepository {
  return {
    cancelOrder: (orderId) =>
      invokeAction<SocialBoostOrder>('social.order.cancel', { orderId }),
    catalog: (input = {}) =>
      invokeAction<SocialBoostCatalog>('social.catalog', input),
    createRefill: (input) =>
      invokeAction<SocialBoostRefill>('social.refill.request', input),
    orders: () => invokeAction<SocialBoostOrder[]>('social.orders'),
    quote: (selectionToken, quantity) =>
      invokeAction<SocialBoostQuote>('social.quote', {
        quantity,
        selectionToken,
      }),
    refreshOrder: (orderId) =>
      invokeAction<SocialBoostOrder>('social.order.refresh', { orderId }),
    refills: (orderId) =>
      invokeAction<SocialBoostRefill[]>('social.refills', { orderId }),
    submitOrder: (input) =>
      invokeAction<SocialBoostOrder>('social.order.submit', input),
  };
}

function demoRepository(): SocialBoostRepository {
  const orders: SocialBoostOrder[] = [];
  const refills: SocialBoostRefill[] = [];
  const quotes = new Map<string, SocialBoostQuote & { service: SocialBoostService }>();

  return {
    async catalog(input = {}) {
      const query = input.query?.trim().toLowerCase() ?? '';
      const platform = input.platform;
      const filtered = previewServices.filter(
        (service) =>
          (!platform || platform === 'all' || service.platform === platform) &&
          (!query ||
            `${service.name} ${service.category} ${service.type}`
              .toLowerCase()
              .includes(query)),
      );
      const platformCounts = previewServices.reduce<Record<string, number>>(
        (counts, service) => {
          counts[service.platform] = (counts[service.platform] ?? 0) + 1;
          return counts;
        },
        {},
      );
      return {
        isPreview: true,
        page: 1,
        pages: 1,
        platformCounts,
        platforms: Object.keys(platformCounts) as SocialBoostCatalog['platforms'],
        services: filtered,
        total: filtered.length,
      };
    },
    async quote(selectionToken, quantity) {
      const service = previewServices.find(
        (candidate) => candidate.selectionToken === selectionToken,
      );
      if (!service) throw new Error('This preview service is no longer available.');
      if (
        quantity < service.minimumQuantity ||
        quantity > service.maximumQuantity
      ) {
        throw new Error(
          `Quantity must be between ${service.minimumQuantity.toLocaleString()} and ${service.maximumQuantity.toLocaleString()}.`,
        );
      }
      const amountMinor = Math.ceil(
        (service.rateMicroUsdPerThousand * quantity * 160_000) /
          (1_000 * 1_000_000),
      );
      const feeMinor = Math.ceil(amountMinor * 0.3);
      const quote: SocialBoostQuote = {
        amountMinor,
        category: service.category,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        feeMinor,
        inputKind: service.inputKind,
        platform: service.platform,
        productTitle: service.name,
        quantity,
        quoteId: `preview-social-quote-${Date.now()}-${quantity}`,
        totalMinor: amountMinor + feeMinor,
      };
      quotes.set(quote.quoteId, { ...quote, service });
      return quote;
    },
    async submitOrder(input) {
      const quote = quotes.get(input.quoteId);
      if (!quote) throw new Error('This preview quote has expired.');
      const now = new Date().toISOString();
      const order: SocialBoostOrder = {
        amountMinor: quote.amountMinor,
        cancelAvailable: quote.service.cancelAvailable,
        category: quote.category,
        completedAt: null,
        createdAt: now,
        deliveredQuantity: null,
        feeMinor: quote.feeMinor,
        id: crypto.randomUUID(),
        isPreview: true,
        platform: quote.platform,
        productTitle: quote.productTitle,
        quantity: quote.quantity,
        refillAvailable: quote.service.refillAvailable,
        refundMinor: 0,
        serviceType: quote.service.type,
        status: 'pending',
        statusMessage: 'Preview Social Boost order accepted.',
        target: input.target,
        totalMinor: quote.totalMinor,
        transactionId: crypto.randomUUID(),
        updatedAt: now,
      };
      orders.unshift(order);
      return order;
    },
    async orders() {
      return structuredClone(orders);
    },
    async refreshOrder(orderId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) throw new Error('Preview Social Boost order was not found.');
      order.updatedAt = new Date().toISOString();
      if (order.status === 'cancellation_requested') {
        order.status = 'cancelled';
        order.refundMinor = order.totalMinor;
        order.deliveredQuantity = 0;
        order.completedAt = order.updatedAt;
        order.statusMessage = 'Preview order cancelled and refunded.';
      } else if (['pending', 'processing'].includes(order.status)) {
        order.status = 'succeeded';
        order.deliveredQuantity = order.quantity;
        order.completedAt = order.updatedAt;
        order.statusMessage = 'Preview delivery completed.';
      }
      return structuredClone(order);
    },
    async cancelOrder(orderId) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order || !order.cancelAvailable) {
        throw new Error('This preview order cannot be cancelled.');
      }
      order.status = 'cancellation_requested';
      order.statusMessage =
        'Preview cancellation requested. Refund follows confirmation.';
      order.updatedAt = new Date().toISOString();
      return structuredClone(order);
    },
    async createRefill({ orderId }) {
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order || order.status !== 'succeeded' || !order.refillAvailable) {
        throw new Error('This preview order is not eligible for a refill.');
      }
      const now = new Date().toISOString();
      const refill: SocialBoostRefill = {
        completedAt: null,
        createdAt: now,
        id: crypto.randomUUID(),
        orderId,
        status: 'pending',
        statusMessage: 'Preview refill requested.',
        updatedAt: now,
      };
      refills.unshift(refill);
      return refill;
    },
    async refills(orderId) {
      return structuredClone(
        refills.filter((refill) => !orderId || refill.orderId === orderId),
      );
    },
  };
}

export const socialBoostRepository = isBillyDevDemo
  ? demoRepository()
  : liveRepository();
