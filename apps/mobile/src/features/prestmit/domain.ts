export type CardServiceKey = 'gift_cards' | 'prepaid_cards';

export type BuyCardProduct = {
  brand: string;
  categories: string[];
  currencyCode: string;
  currencySymbol: string;
  imageUrl?: string;
  isPreOrder: boolean;
  maximumFaceValueMinor: number;
  minimumFaceValueMinor: number;
  regions: string[];
  selectionToken: string;
  title: string;
};

export type BuyCardCatalog = {
  fetchedAt: string;
  isPreview: boolean;
  products: BuyCardProduct[];
};

export type SellCardCategory = {
  imageUrl?: string;
  name: string;
  selectionToken: string;
};

export type SellCardCategoryCatalog = {
  categories: SellCardCategory[];
  fetchedAt: string;
  isPreview: boolean;
};

export type SellEvidenceForm = 'ecode' | 'physical' | 'physical_or_ecode';

export type SellCardProduct = {
  country?: string;
  currencyCode: string;
  currencySymbol: string;
  form: SellEvidenceForm;
  maximumFaceValueMinor?: number;
  minimumFaceValueMinor: number;
  selectionToken: string;
  title: string;
};

export type SellCardProductCatalog = {
  category: string;
  products: SellCardProduct[];
};

export type BuyCardQuote = {
  amountMinor: number;
  currency: 'NGN';
  expiresAt: string;
  faceCurrency: string;
  faceValueMinor: number;
  feeMinor: number;
  productTitle: string;
  quantity: number;
  quoteId: string;
  totalMinor: number;
};

export type SellCardQuote = {
  currency: 'NGN';
  evidenceForm: SellEvidenceForm;
  expiresAt: string;
  faceCurrency: string;
  faceValueMinor: number;
  feeMinor: number;
  grossPayoutMinor: number;
  payoutMinor: number;
  productTitle: string;
  quoteId: string;
  rateMinorPerUnit: number;
};

export type PrestmitOrderStatus =
  | 'failed'
  | 'pending'
  | 'processing'
  | 'refunded'
  | 'rejected'
  | 'reserved'
  | 'succeeded';

export type PrestmitOrder = {
  amountMinor: number;
  completedAt: string | null;
  createdAt: string;
  currency: 'NGN';
  evidenceMode: 'ecode' | 'physical' | null;
  faceCurrency: string;
  faceValueMinor: number;
  feeMinor: number;
  fulfilmentAvailable: boolean;
  id: string;
  isPreview: boolean;
  productTitle: string;
  quantity: number;
  serviceKey: CardServiceKey;
  status: PrestmitOrderStatus;
  statusMessage: string;
  tradeType: 'gift_card_buy' | 'gift_card_sell' | 'prepaid_card';
  transactionId: string | null;
  updatedAt: string;
};

export type CardFulfilment = {
  codes: {
    cardNumber?: string;
    claimUrl?: string;
    expiresAt?: string;
    pin?: string;
  }[];
  deliveredAt: string;
};

export type EvidenceAsset = {
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png';
  uri: string;
};

export type PrestmitRepository = {
  getBuyCatalog(service: CardServiceKey): Promise<BuyCardCatalog>;
  getOrder(orderId: string, service: CardServiceKey): Promise<PrestmitOrder>;
  getOrders(service: CardServiceKey): Promise<PrestmitOrder[]>;
  getSellCategories(): Promise<SellCardCategoryCatalog>;
  getSellProducts(categoryToken: string): Promise<SellCardProductCatalog>;
  purchase(input: {
    idempotencyKey: string;
    pin: string;
    quoteId: string;
    service: CardServiceKey;
  }): Promise<PrestmitOrder>;
  quoteBuy(input: {
    faceValueMinor: number;
    quantity: number;
    selectionToken: string;
    service: CardServiceKey;
  }): Promise<BuyCardQuote>;
  quoteSell(input: {
    faceValueMinor: number;
    selectionToken: string;
  }): Promise<SellCardQuote>;
  refreshOrder(orderId: string, service: CardServiceKey): Promise<PrestmitOrder>;
  reveal(
    orderId: string,
    pin: string,
    service: CardServiceKey,
  ): Promise<CardFulfilment>;
  submitSell(input: {
    comments?: string;
    ecode?: string;
    evidenceMode: 'ecode' | 'physical';
    evidencePaths: string[];
    idempotencyKey: string;
    quoteId: string;
  }): Promise<PrestmitOrder>;
  uploadEvidence(orderKey: string, asset: EvidenceAsset): Promise<string>;
};
