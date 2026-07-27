import { billyDemoScenario } from '@/features/main/repository';

import { billCategories, findBillCategory } from './catalog';
import {
  ServiceApiError,
  type BillCatalog,
  type BillCategoryKey,
  type BillCustomerValidation,
  type BillOrder,
  type BillQuote,
  type BillSelection,
  type BillService,
  type BillyServiceRepository,
  type FundingAccount,
  type KycCheck,
} from './domain';

const DEMO_DELAY_MS = 240;
const QUOTE_LIFETIME_MS = 5 * 60_000;

let demoFundingAccount: FundingAccount | null = null;
const demoQuotes = new Map<string, BillQuote>();
const demoOrdersByOperation = new Map<
  string,
  { order: BillOrder; quoteId: string }
>();
const demoOrdersById = new Map<string, BillOrder>();
const demoKycChecks: KycCheck[] = [];

const customerFields = {
  email: {
    keyboard: 'email-address',
    label: 'Account email',
    maxLength: 120,
    placeholder: 'name@example.com',
  },
  meter: {
    keyboard: 'number-pad',
    label: 'Meter number',
    maxLength: 20,
    placeholder: 'Enter meter number',
  },
  phone: {
    keyboard: 'phone-pad',
    label: 'Phone number',
    maxLength: 14,
    placeholder: '0801 234 5678',
  },
  smartcard: {
    keyboard: 'number-pad',
    label: 'Smartcard or IUC number',
    maxLength: 20,
    placeholder: 'Enter account number',
  },
} as const;

/**
 * Synthetic, development-only fixtures. Live catalog data is always fetched
 * through Billy's server adapter and never compiled into a production build.
 */
const demoCatalogServices: Record<BillCategoryKey, BillService[]> = {
  airtime: ['MTN', 'Airtel', 'Glo', '9mobile'].map((label) => ({
    amountMode: 'custom',
    customerField: customerFields.phone,
    description: `Instant ${label} airtime top-up.`,
    id: `demo-airtime-${label.toLowerCase()}`,
    label,
    maximumAmountMinor: 5_000_000,
    minimumAmountMinor: 5_000,
    products: [],
    requiresCustomerValidation: false,
  })),
  data: [
    {
      label: 'MTN',
      products: [
        ['1 GB', 50_000, '30 days'],
        ['2.5 GB', 90_000, '30 days'],
        ['5 GB', 150_000, '30 days'],
      ],
    },
    {
      label: 'Airtel',
      products: [
        ['1 GB', 50_000, '30 days'],
        ['3 GB', 100_000, '30 days'],
        ['6 GB', 200_000, '30 days'],
      ],
    },
    {
      label: 'Glo',
      products: [
        ['1.5 GB', 50_000, '30 days'],
        ['4.5 GB', 100_000, '30 days'],
      ],
    },
    {
      label: '9mobile',
      products: [
        ['1 GB', 50_000, '30 days'],
        ['3.5 GB', 150_000, '30 days'],
      ],
    },
  ].map(({ label, products }) => ({
    amountMode: 'fixed',
    customerField: customerFields.phone,
    description: `Current ${label} data bundles.`,
    id: `demo-data-${label.toLowerCase()}`,
    label,
    maximumAmountMinor: null,
    minimumAmountMinor: null,
    products: products.map(([name, amountMinor, duration], index) => ({
      amountMinor: amountMinor as number,
      description: duration as string,
      id: `demo-${label.toLowerCase()}-data-${index + 1}`,
      label: name as string,
    })),
    requiresCustomerValidation: false,
  })),
  electricity: ['Ikeja Electric', 'Eko Electric'].map((label) => ({
    amountMode: 'custom',
    customerField: customerFields.meter,
    description: 'Prepaid and postpaid meter payments.',
    id: `demo-electricity-${label.toLowerCase().replace(/\s+/g, '-')}`,
    label,
    maximumAmountMinor: 20_000_000,
    minimumAmountMinor: 100_000,
    products: [
      {
        amountMinor: null,
        description: 'Token is returned after successful payment.',
        id: 'prepaid',
        label: 'Prepaid meter',
      },
      {
        amountMinor: null,
        description: 'Pay an existing postpaid account.',
        id: 'postpaid',
        label: 'Postpaid meter',
      },
    ],
    requiresCustomerValidation: true,
  })),
  cable: [
    {
      label: 'DStv',
      products: [
        ['Padi', 360_000],
        ['Yanga', 510_000],
        ['Compact', 1_570_000],
      ],
    },
    {
      label: 'GOtv',
      products: [
        ['Smallie', 190_000],
        ['Jinja', 390_000],
        ['Max', 850_000],
      ],
    },
    {
      label: 'StarTimes',
      products: [
        ['Nova', 210_000],
        ['Basic', 400_000],
        ['Classic', 600_000],
      ],
    },
    {
      label: 'Showmax',
      products: [
        ['Mobile', 160_000],
        ['Entertainment', 350_000],
      ],
    },
  ].map(({ label, products }) => ({
    amountMode: 'fixed',
    customerField:
      label === 'Showmax' ? customerFields.phone : customerFields.smartcard,
    description: `Renew or change a ${label} subscription.`,
    id: `demo-tv-${label.toLowerCase()}`,
    label,
    maximumAmountMinor: null,
    minimumAmountMinor: null,
    products: products.map(([name, amountMinor], index) => ({
      amountMinor: amountMinor as number,
      description: 'Current preview package',
      id: `demo-${label.toLowerCase()}-${index + 1}`,
      label: name as string,
    })),
    requiresCustomerValidation: label !== 'Showmax',
    subscriptionOptions:
      label === 'DStv' || label === 'GOtv'
        ? (['renew', 'change'] as const)
        : undefined,
  })),
  internet: [
    {
      amountMode: 'fixed',
      customerField: customerFields.email,
      description: 'Verify a Smile account and choose a current bundle.',
      id: 'demo-internet-smile',
      label: 'Smile',
      maximumAmountMinor: null,
      minimumAmountMinor: null,
      products: [
        {
          amountMinor: 1_000_000,
          description: '30-day preview bundle',
          id: 'demo-smile-1',
          label: 'Unlimited Essential',
        },
        {
          amountMinor: 1_500_000,
          description: '30-day preview bundle',
          id: 'demo-smile-2',
          label: 'Unlimited Premium',
        },
      ],
      requiresCustomerValidation: true,
    },
    {
      amountMode: 'fixed',
      customerField: customerFields.phone,
      description: 'Purchase a supported Spectranet voucher.',
      id: 'demo-internet-spectranet',
      label: 'Spectranet',
      maximumAmountMinor: null,
      minimumAmountMinor: null,
      products: [
        {
          amountMinor: 500_000,
          description: 'Preview voucher',
          id: 'demo-spectranet-1',
          label: '₦5,000 voucher',
        },
        {
          amountMinor: 1_000_000,
          description: 'Preview voucher',
          id: 'demo-spectranet-2',
          label: '₦10,000 voucher',
        },
      ],
      requiresCustomerValidation: false,
    },
  ],
  education: [
    {
      amountMode: 'fixed',
      customerField: customerFields.phone,
      description: 'Purchase a supported examination PIN.',
      id: 'demo-education-waec',
      label: 'WAEC',
      maximumAmountMinor: null,
      minimumAmountMinor: null,
      products: [
        {
          amountMinor: 250_000,
          description: 'One synthetic result-checker PIN',
          id: 'demo-waec-pin',
          label: 'Result checker',
        },
      ],
      requiresCustomerValidation: false,
    },
    {
      amountMode: 'fixed',
      customerField: {
        keyboard: 'number-pad',
        label: 'Profile code',
        maxLength: 20,
        placeholder: 'Enter JAMB profile code',
      },
      description: 'Verify a profile and purchase a supported product.',
      id: 'demo-education-jamb',
      label: 'JAMB',
      maximumAmountMinor: null,
      minimumAmountMinor: null,
      products: [
        {
          amountMinor: 470_000,
          description: 'Synthetic registration product',
          id: 'demo-jamb-registration',
          label: 'Registration',
        },
      ],
      requiresCustomerValidation: true,
    },
  ],
};

async function demoDelay() {
  await new Promise((resolve) => setTimeout(resolve, DEMO_DELAY_MS));
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0\d{10}$/.test(digits)) return digits;
  throw new ServiceApiError(
    'invalid_request',
    'Enter a valid 11-digit Nigerian phone number.',
  );
}

function requireService(selection: BillSelection) {
  const service = demoCatalogServices[selection.category].find(
    (candidate) => candidate.id === selection.serviceId,
  );
  if (!service) {
    throw new ServiceApiError(
      'invalid_request',
      'That service is no longer in the current catalog.',
    );
  }
  return service;
}

function requireSelection(selection: BillSelection) {
  const service = requireService(selection);
  const renewing = selection.subscriptionType === 'renew';
  const customerReference = selection.customerReference.trim();
  if (
    customerReference.length < 3 ||
    customerReference.length > service.customerField.maxLength
  ) {
    throw new ServiceApiError(
      'invalid_request',
      `Enter a valid ${service.customerField.label.toLowerCase()}.`,
    );
  }

  if (!selection.contactPhone) {
    throw new ServiceApiError(
      'invalid_request',
      'Enter a phone number for this payment.',
    );
  }
  normalizePhone(selection.contactPhone);
  if (
    service.customerField.keyboard === 'phone-pad' &&
    !customerReference.includes('@')
  ) {
    normalizePhone(customerReference);
  }

  const product = selection.productId
    ? service.products.find((candidate) => candidate.id === selection.productId)
    : null;

  if (service.products.length > 0 && !product && !renewing) {
    throw new ServiceApiError(
      'invalid_request',
      'Choose a current product or account type.',
    );
  }

  const amountMinor = renewing
    ? 510_000
    : (product?.amountMinor ?? selection.amountMinor);
  if (
    typeof amountMinor !== 'number' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    (service.minimumAmountMinor !== null &&
      amountMinor < service.minimumAmountMinor) ||
    (service.maximumAmountMinor !== null &&
      amountMinor > service.maximumAmountMinor)
  ) {
    throw new ServiceApiError(
      'invalid_request',
      'Enter an amount within the current service limits.',
    );
  }

  return { amountMinor, product, service };
}

function createDemoQuoteId() {
  return `demo-quote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDemoOrderReference() {
  return `BLY-DEMO-${String(Date.now()).slice(-8)}`;
}

function fundingAccount(now = new Date()): FundingAccount {
  return {
    accountName: 'Amina Bello',
    accountNumber: '2754186302',
    assignedAt: now.toISOString(),
    bankName: 'Paga',
    currency: 'NGN',
    id: 'demo-funding-account',
    isPermanent: true,
    isTest: true,
    status: 'active',
  };
}

function checkFromInput(
  method: 'bvn_basic' | 'vnin_basic',
  number: string,
): KycCheck {
  const now = new Date().toISOString();
  const status =
    number === '11111111111'
      ? 'rejected'
      : number === '22222222222'
        ? 'pending'
        : number === '00000000000'
          ? 'error'
          : 'verified';
  const label = method === 'bvn_basic' ? 'BVN' : 'NIN';

  return {
    completedAt: status === 'pending' ? null : now,
    createdAt: now,
    dateOfBirth: status === 'verified' ? '1995-06-18' : null,
    displayName: status === 'verified' ? 'Amina Bello' : null,
    id: `demo-kyc-${Date.now()}`,
    isPreview: true,
    maskedIdentifier: `*******${number.slice(-4)}`,
    method,
    outcomeReason:
      status === 'verified'
        ? `${label} details were verified.`
        : status === 'pending'
          ? 'The verification is still being reviewed.'
          : status === 'rejected'
            ? `The ${label} details could not be verified.`
            : 'The verification service is temporarily unavailable.',
    phoneMasked: status === 'verified' ? '080*******78' : null,
    status,
  };
}

export function createDemoServiceRepository(): BillyServiceRepository {
  return {
    async createFundingAccount() {
      await demoDelay();
      if (!demoFundingAccount) demoFundingAccount = fundingAccount();
      return {
        account: demoFundingAccount,
        isPreview: true,
        message: 'Your reusable Billy funding account is ready.',
        outcome: 'created',
      };
    },
    async getBillCatalog(category) {
      await demoDelay();
      const categorySummary = findBillCategory(category);
      if (!categorySummary) {
        throw new ServiceApiError('not_found', 'Bill category was not found.');
      }
      return {
        category: categorySummary,
        fetchedAt: new Date().toISOString(),
        isPreview: true,
        services: structuredClone(demoCatalogServices[category]),
      } satisfies BillCatalog;
    },
    async getBillOrderForTransaction(transactionId) {
      await demoDelay();
      const order = [...demoOrdersById.values()].find(
        (candidate) => candidate.transactionId === transactionId,
      );
      return order ? structuredClone(order) : null;
    },
    async getFundingAccount() {
      await demoDelay();
      return {
        account: demoFundingAccount,
        isPreview: true,
        message: demoFundingAccount
          ? 'Use this account whenever you want to add money.'
          : 'Create your reusable Billy funding account once.',
        outcome: demoFundingAccount ? 'existing' : 'unavailable',
      };
    },
    async getKycChecks() {
      await demoDelay();
      return structuredClone(demoKycChecks);
    },
    async purchaseBill({ idempotencyKey, pin, quoteId }) {
      await demoDelay();
      if (!/^[0-9]{6}$/.test(pin)) {
        throw new ServiceApiError(
          'invalid_request',
          'Enter your complete 6-digit transaction PIN.',
        );
      }
      if (idempotencyKey.length < 16) {
        throw new ServiceApiError(
          'invalid_request',
          'Billy could not secure this transaction request.',
        );
      }
      const previousOperation = demoOrdersByOperation.get(idempotencyKey);
      if (previousOperation) {
        if (previousOperation.quoteId !== quoteId) {
          throw new ServiceApiError(
            'conflict',
            'This secure request key was already used for another payment.',
          );
        }
        return structuredClone(previousOperation.order);
      }
      const quote = demoQuotes.get(quoteId);
      if (!quote || new Date(quote.expiresAt).getTime() <= Date.now()) {
        throw new ServiceApiError(
          'conflict',
          'This quote expired. Review the latest price and try again.',
        );
      }

      const pending = billyDemoScenario === 'pending';
      const transactionId = `demo-bill-tx-${Date.now()}`;
      demoQuotes.delete(quoteId);
      const order: BillOrder = {
        category: quote.category,
        createdAt: new Date().toISOString(),
        customerName: quote.customerName,
        customerReference: quote.customerReference,
        fulfillmentHint:
          quote.category === 'electricity'
            ? 'Enter this token on your prepaid meter.'
            : null,
        fulfillmentLabel:
          !pending && quote.category === 'electricity'
            ? 'Electricity token'
            : !pending && ['education', 'internet'].includes(quote.category)
              ? 'Delivery code'
              : null,
        fulfillmentValue:
          !pending && quote.category === 'electricity'
            ? '4839-2057-6610-2844-0291'
            : !pending && ['education', 'internet'].includes(quote.category)
              ? 'BILLY-DEMO-482901'
              : null,
        id: `demo-bill-order-${Date.now()}`,
        productLabel: quote.productLabel,
        reference: createDemoOrderReference(),
        serviceLabel: quote.serviceLabel,
        status: pending ? 'pending' : 'succeeded',
        transactionId,
      };
      demoOrdersByOperation.set(idempotencyKey, { order, quoteId });
      demoOrdersById.set(order.id, order);
      return structuredClone(order);
    },
    async quoteBill({ selection }) {
      await demoDelay();
      const { amountMinor, product, service } = requireSelection(selection);
      const id = createDemoQuoteId();
      const quote: BillQuote = {
        amountMinor,
        category: selection.category,
        currency: 'NGN',
        customerName: service.requiresCustomerValidation
          ? 'Amina Bello'
          : null,
        customerReference: selection.customerReference.trim(),
        expiresAt: new Date(Date.now() + QUOTE_LIFETIME_MS).toISOString(),
        feeMinor: 0,
        id,
        productLabel: selection.subscriptionType === 'renew'
          ? 'Current package renewal'
          : (product?.label ?? null),
        serviceLabel: service.label,
        totalMinor: amountMinor,
      };
      demoQuotes.set(id, quote);
      return structuredClone(quote);
    },
    async refreshBillOrder(orderId) {
      await demoDelay();
      const order = demoOrdersById.get(orderId);
      if (!order) {
        throw new ServiceApiError('not_found', 'Bill order was not found.');
      }
      if (order.status === 'pending') {
        order.status = 'succeeded';
        if (order.category === 'electricity') {
          order.fulfillmentHint =
            'Enter this token on your prepaid meter.';
          order.fulfillmentLabel = 'Electricity token';
          order.fulfillmentValue = '4839-2057-6610-2844-0291';
        }
      }
      return structuredClone(order);
    },
    async refreshKycCheck(checkId) {
      await demoDelay();
      const check = demoKycChecks.find((candidate) => candidate.id === checkId);
      if (!check) {
        throw new ServiceApiError(
          'not_found',
          'Identity check was not found.',
        );
      }
      if (check.status === 'pending') {
        const completedAt = new Date().toISOString();
        Object.assign(check, {
          completedAt,
          dateOfBirth: '1995-06-18',
          displayName: 'Amina Bello',
          outcomeReason: 'Identity details were verified.',
          phoneMasked: '080*******78',
          status: 'verified',
        } satisfies Partial<KycCheck>);
      }
      return structuredClone(check);
    },
    async submitKyc({ consentVersion, idempotencyKey, method, number }) {
      await demoDelay();
      if (!consentVersion || idempotencyKey.length < 16) {
        throw new ServiceApiError(
          'invalid_request',
          'Review the verification consent before continuing.',
        );
      }
      if (!/^[0-9]{11}$/.test(number)) {
        throw new ServiceApiError(
          'invalid_request',
          `Enter a valid 11-digit ${method === 'bvn_basic' ? 'BVN' : 'NIN'}.`,
        );
      }
      const existing = demoKycChecks.find(
        (check) =>
          check.method === method &&
          check.maskedIdentifier === `*******${number.slice(-4)}`,
      );
      if (existing) return structuredClone(existing);

      const check = checkFromInput(method, number);
      demoKycChecks.unshift(check);
      return structuredClone(check);
    },
    async validateBillCustomer(selection) {
      await demoDelay();
      const { service } = requireSelection(selection);
      const validation: BillCustomerValidation = {
        customerName: service.requiresCustomerValidation
          ? 'Amina Bello'
          : null,
        customerReference: selection.customerReference.trim(),
        message: service.requiresCustomerValidation
          ? 'Account details confirmed.'
          : 'This service does not require account verification.',
        validated: true,
        validationToken: null,
      };
      return validation;
    },
  };
}

export function resetDemoServiceState() {
  demoFundingAccount = null;
  demoQuotes.clear();
  demoOrdersByOperation.clear();
  demoOrdersById.clear();
  demoKycChecks.splice(0, demoKycChecks.length);
}

export { billCategories };
