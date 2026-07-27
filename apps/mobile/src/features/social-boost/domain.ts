export type SocialBoostPlatform =
  | 'discord'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'other'
  | 'pinterest'
  | 'snapchat'
  | 'soundcloud'
  | 'spotify'
  | 'telegram'
  | 'threads'
  | 'tiktok'
  | 'twitch'
  | 'twitter'
  | 'youtube';

export type SocialBoostInputKind =
  | 'comments'
  | 'default'
  | 'group_invites'
  | 'hashtags'
  | 'package'
  | 'poll'
  | 'seo'
  | 'subscriptions'
  | 'usernames';

export type SocialBoostService = {
  cancelAvailable: boolean;
  category: string;
  inputKind: SocialBoostInputKind;
  maximumQuantity: number;
  minimumQuantity: number;
  name: string;
  platform: SocialBoostPlatform;
  rateMicroUsdPerThousand: number;
  refillAvailable: boolean;
  selectionToken: string;
  type: string;
};

export type SocialBoostCatalog = {
  isPreview: boolean;
  page: number;
  pages: number;
  platformCounts: Record<string, number>;
  platforms: SocialBoostPlatform[];
  services: SocialBoostService[];
  total: number;
};

export type SocialBoostQuote = {
  amountMinor: number;
  category: string;
  expiresAt: string;
  feeMinor: number;
  inputKind: SocialBoostInputKind;
  platform: SocialBoostPlatform;
  productTitle: string;
  quantity: number;
  quoteId: string;
  totalMinor: number;
};

export type SocialBoostOrderStatus =
  | 'cancelled'
  | 'cancellation_requested'
  | 'failed'
  | 'manual_review'
  | 'partial'
  | 'pending'
  | 'processing'
  | 'refunded'
  | 'reserved'
  | 'succeeded';

export type SocialBoostOrder = {
  amountMinor: number;
  cancelAvailable: boolean;
  category: string;
  completedAt: string | null;
  createdAt: string;
  deliveredQuantity: number | null;
  feeMinor: number;
  id: string;
  isPreview: boolean;
  platform: SocialBoostPlatform;
  productTitle: string;
  quantity: number;
  refillAvailable: boolean;
  refundMinor: number;
  serviceType: string;
  status: SocialBoostOrderStatus;
  statusMessage: string;
  target: string;
  totalMinor: number;
  transactionId: string;
  updatedAt: string;
};

export type SocialBoostRefill = {
  completedAt: string | null;
  createdAt: string;
  id: string;
  orderId: string;
  status: 'failed' | 'manual_review' | 'pending' | 'processing' | 'succeeded';
  statusMessage: string;
  updatedAt: string;
};

export type SocialBoostOrderInput = {
  answerNumber?: number;
  comments?: string;
  groupLink?: string;
  hashtags?: string;
  idempotencyKey: string;
  intervalMinutes?: number;
  keywords?: string;
  pin: string;
  quoteId: string;
  runs?: number;
  target: string;
  username?: string;
  usernames?: string;
};

export interface SocialBoostRepository {
  cancelOrder(orderId: string): Promise<SocialBoostOrder>;
  catalog(input?: {
    limit?: number;
    page?: number;
    platform?: string;
    query?: string;
  }): Promise<SocialBoostCatalog>;
  createRefill(input: {
    idempotencyKey: string;
    orderId: string;
  }): Promise<SocialBoostRefill>;
  orders(): Promise<SocialBoostOrder[]>;
  quote(
    selectionToken: string,
    quantity: number,
  ): Promise<SocialBoostQuote>;
  refreshOrder(orderId: string): Promise<SocialBoostOrder>;
  refills(orderId?: string): Promise<SocialBoostRefill[]>;
  submitOrder(input: SocialBoostOrderInput): Promise<SocialBoostOrder>;
}
