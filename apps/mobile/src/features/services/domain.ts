import type { AppIconName, ActivityStatus } from '@/features/main/domain';

export type ServiceApiErrorCode =
  | 'configuration'
  | 'conflict'
  | 'feature_disabled'
  | 'invalid_request'
  | 'network'
  | 'not_found'
  | 'provider_pending'
  | 'unauthorized'
  | 'unavailable'
  | 'unknown';

export class ServiceApiError extends Error {
  readonly code: ServiceApiErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ServiceApiErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ServiceApiError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export type FundingAccount = {
  accountName: string;
  accountNumber: string;
  assignedAt: string;
  bankName: string;
  currency: 'NGN';
  id: string;
  isPermanent: true;
  isTest?: boolean;
  status: 'active' | 'disabled';
};

export type FundingAccountResult = {
  account: FundingAccount | null;
  isPreview?: boolean;
  outcome: 'created' | 'existing' | 'unavailable';
  message: string;
};

export type BillCategoryKey =
  | 'airtime'
  | 'cable'
  | 'data'
  | 'education'
  | 'electricity'
  | 'internet';

export type BillCategory = {
  description: string;
  icon: AppIconName;
  key: BillCategoryKey;
  label: string;
};

export type BillCustomerField = {
  keyboard: 'email-address' | 'number-pad' | 'phone-pad';
  label: string;
  maxLength: number;
  placeholder: string;
};

export type BillProduct = {
  amountMinor: number | null;
  description: string;
  id: string;
  label: string;
};

export type BillService = {
  amountMode: 'custom' | 'fixed';
  customerField: BillCustomerField;
  description: string;
  id: string;
  label: string;
  maximumAmountMinor: number | null;
  minimumAmountMinor: number | null;
  products: BillProduct[];
  requiresCustomerValidation: boolean;
  subscriptionOptions?: readonly ('change' | 'renew')[];
};

export type BillCatalog = {
  category: BillCategory;
  fetchedAt: string;
  isPreview: boolean;
  services: BillService[];
};

export type BillSelection = {
  amountMinor?: number;
  category: BillCategoryKey;
  contactPhone: string;
  customerReference: string;
  productId: string | null;
  serviceId: string;
  subscriptionType?: 'change' | 'renew';
};

export type BillCustomerValidation = {
  customerName: string | null;
  customerReference: string;
  message: string;
  validated: boolean;
  validationToken: string | null;
};

export type BillQuote = {
  amountMinor: number;
  category: BillCategoryKey;
  currency: 'NGN';
  customerName: string | null;
  customerReference: string;
  expiresAt: string;
  feeMinor: number;
  id: string;
  productLabel: string | null;
  serviceLabel: string;
  totalMinor: number;
};

export type BillOrder = {
  category: BillCategoryKey;
  createdAt: string;
  customerName: string | null;
  customerReference: string;
  fulfillmentHint: string | null;
  fulfillmentLabel: string | null;
  fulfillmentValue: string | null;
  id: string;
  isPreview?: boolean;
  productLabel: string | null;
  reference: string;
  serviceLabel: string;
  status: ActivityStatus;
  transactionId: string;
};

export type KycMethod = 'bvn_basic' | 'vnin_basic';

export type KycCheckStatus =
  | 'created'
  | 'error'
  | 'pending'
  | 'rejected'
  | 'verified';

export type KycCheck = {
  completedAt: string | null;
  createdAt: string;
  dateOfBirth: string | null;
  displayName: string | null;
  id: string;
  isPreview?: boolean;
  maskedIdentifier: string;
  method: KycMethod;
  outcomeReason: string;
  phoneMasked: string | null;
  status: KycCheckStatus;
};

export type BillyServiceRepository = {
  createFundingAccount: () => Promise<FundingAccountResult>;
  getBillCatalog: (category: BillCategoryKey) => Promise<BillCatalog>;
  getBillOrderForTransaction: (
    transactionId: string,
  ) => Promise<BillOrder | null>;
  getFundingAccount: () => Promise<FundingAccountResult>;
  getKycChecks: () => Promise<KycCheck[]>;
  purchaseBill: (input: {
    idempotencyKey: string;
    pin: string;
    quoteId: string;
  }) => Promise<BillOrder>;
  quoteBill: (input: {
    selection: BillSelection;
    validationToken?: string | null;
  }) => Promise<BillQuote>;
  refreshBillOrder: (orderId: string) => Promise<BillOrder>;
  refreshKycCheck: (checkId: string) => Promise<KycCheck>;
  submitKyc: (input: {
    consentVersion: string;
    idempotencyKey: string;
    method: KycMethod;
    number: string;
  }) => Promise<KycCheck>;
  validateBillCustomer: (
    selection: BillSelection,
  ) => Promise<BillCustomerValidation>;
};
