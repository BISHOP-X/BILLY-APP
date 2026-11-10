import type { BillCategory } from './domain';

export const billCategories: BillCategory[] = [
  {
    description: 'Top up supported mobile networks worldwide.',
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
    description: 'Pay supported electricity companies worldwide.',
    icon: 'flash-outline',
    key: 'electricity',
    label: 'Electricity',
  },
];

export function findBillCategory(key: string) {
  return billCategories.find((category) => category.key === key) ?? null;
}
