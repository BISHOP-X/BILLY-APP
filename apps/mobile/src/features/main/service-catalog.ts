import type { ServiceKey, ServiceSummary } from './domain';

export const serviceCatalog: readonly (
  Pick<ServiceSummary, 'description' | 'icon' | 'key' | 'label' | 'sortOrder'>
)[] = [
  {
    description: 'Electricity, airtime, data, television, and other everyday payments.',
    icon: 'receipt-outline',
    key: 'bills',
    label: 'Pay Bills',
    sortOrder: 10,
  },
  {
    description: 'Buy or sell supported gift cards with clear quotes and order tracking.',
    icon: 'gift-outline',
    key: 'gift_cards',
    label: 'Gift Cards',
    sortOrder: 20,
  },
  {
    description: 'Explore supported digital assets, networks, quotes, and transaction requests.',
    icon: 'logo-bitcoin',
    key: 'crypto',
    label: 'Crypto',
    sortOrder: 30,
  },
  {
    description: 'Order a temporary number and follow incoming SMS securely in Billy.',
    icon: 'globe-outline',
    key: 'foreign_numbers',
    label: 'Foreign Numbers',
    sortOrder: 40,
  },
  {
    description: 'Browse social growth services and track orders from submission to completion.',
    icon: 'megaphone-outline',
    key: 'social_boost',
    label: 'Social Boost',
    sortOrder: 50,
  },
  {
    description: 'Request and manage eligible prepaid virtual cards when this service launches.',
    icon: 'card-outline',
    key: 'prepaid_cards',
    label: 'Prepaid Cards',
    sortOrder: 60,
  },
] as const;

export function isServiceKey(value: string): value is ServiceKey {
  return serviceCatalog.some((service) => service.key === value);
}

export function catalogService(key: ServiceKey) {
  return serviceCatalog.find((service) => service.key === key)!;
}
