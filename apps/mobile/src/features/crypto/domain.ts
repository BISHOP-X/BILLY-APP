export type CryptoOperation = 'buy' | 'receive' | 'sell' | 'send';

export type CryptoNetwork = {
  depositEnabled: boolean;
  id: string;
  name: string;
  selectionToken: string;
  withdrawEnabled: boolean;
};

export type CryptoAsset = {
  balance: string;
  locked: string;
  name: string;
  networks: CryptoNetwork[];
  symbol: string;
};

export type CryptoPortfolio = {
  assets: CryptoAsset[];
  isPreview: boolean;
  updatedAt: string;
};

export type CryptoAssetCatalog = {
  assets: CryptoAsset[];
  isPreview: boolean;
};

export type CryptoTradeQuote = {
  action: 'buy' | 'sell';
  asset: string;
  expiresAt: string;
  feeMinor: number;
  fiatAmountMinor: number;
  grossPayoutMinor?: number;
  network: string;
  payoutMinor?: number;
  quoteId: string;
  tokenAmount: string;
  totalMinor?: number;
};

export type CryptoSendQuote = {
  asset: string;
  availableBalance: string;
  expiresAt: string;
  network: string;
  networkFee: string;
  quoteId: string;
  tokenAmount: string;
};

export type CryptoAddress = {
  address?: string;
  asset: string;
  destinationTag?: string | null;
  network: string;
  state?: 'pending' | 'ready';
  status?: 'disabled' | 'ready';
};

export type CryptoOrder = {
  action: 'buy' | 'sell' | 'send';
  asset: string;
  completedAt: string | null;
  createdAt: string;
  destinationAddress: string | null;
  destinationTag: string | null;
  feeMinor: number;
  fiatAmountMinor: number | null;
  id: string;
  isPreview: boolean;
  network: string;
  status:
    | 'awaiting_transfer'
    | 'cancelled'
    | 'failed'
    | 'pending'
    | 'processing'
    | 'refunded'
    | 'reserved'
    | 'succeeded';
  statusMessage: string;
  tokenAmount: string;
  transactionHash: string | null;
  transactionId: string | null;
  updatedAt: string;
};

export interface CryptoRepository {
  assets(operation: CryptoOperation): Promise<CryptoAssetCatalog>;
  buyQuote(
    selectionToken: string,
    fiatAmountMinor: number,
  ): Promise<CryptoTradeQuote>;
  orders(): Promise<CryptoOrder[]>;
  portfolio(): Promise<CryptoPortfolio>;
  receiveAddress(selectionToken: string): Promise<CryptoAddress>;
  refreshOrder(orderId: string): Promise<CryptoOrder>;
  sellQuote(
    selectionToken: string,
    tokenAmount: string,
  ): Promise<CryptoTradeQuote>;
  sendQuote(
    selectionToken: string,
    tokenAmount: string,
  ): Promise<CryptoSendQuote>;
  submitTrade(input: {
    action: 'buy' | 'sell';
    idempotencyKey: string;
    pin: string;
    quoteId: string;
  }): Promise<CryptoOrder>;
  submitSend(input: {
    address: string;
    destinationTag?: string;
    idempotencyKey: string;
    pin: string;
    quoteId: string;
  }): Promise<CryptoOrder>;
}
