import type { BillCategory } from './domain';

export const billCategories: BillCategory[] = [
  {
    description: 'Top up any supported Nigerian mobile line.',
    icon: 'phone-portrait-outline',
    key: 'airtime',
    label: 'Airtime',
  },
  {
    description: 'Browse current mobile data bundles.',
    icon: 'cellular-outline',
    key: 'data',
    label: 'Data',
  },
  {
    description: 'Verify a meter and pay electricity bills.',
    icon: 'flash-outline',
    key: 'electricity',
    label: 'Electricity',
  },
  {
    description: 'Renew or change supported TV packages.',
    icon: 'tv-outline',
    key: 'cable',
    label: 'TV',
  },
  {
    description: 'Pay supported broadband subscriptions.',
    icon: 'wifi-outline',
    key: 'internet',
    label: 'Internet',
  },
  {
    description: 'Purchase supported exam and education products.',
    icon: 'school-outline',
    key: 'education',
    label: 'Education',
  },
];

export function findBillCategory(key: string) {
  return billCategories.find((category) => category.key === key) ?? null;
}
