import {
  billyDataSource,
  isBillyDevDemo,
} from '@/features/main/repository';

import { createDemoServiceRepository } from './demo-service-repository';
import type { BillyServiceRepository } from './domain';
import { createSupabaseServiceRepository } from './supabase-service-repository';

export const billyServiceRepository: BillyServiceRepository = isBillyDevDemo
  ? createDemoServiceRepository()
  : createSupabaseServiceRepository();

export const billyServiceDataSource = billyDataSource;
