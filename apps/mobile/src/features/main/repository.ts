import {
  BillyRepositoryError,
  type BillyDataSource,
  type DemoScenario,
} from './domain';
import { createDemoRepository } from './demo-repository';
import { createSupabaseRepository } from './supabase-repository';

const requestedMode = process.env.EXPO_PUBLIC_BILLY_DATA_MODE?.trim().toLowerCase();
const requestedScenario =
  process.env.EXPO_PUBLIC_BILLY_DEMO_SCENARIO?.trim().toLowerCase();
const isExplicitTesterBuild =
  process.env.EXPO_PUBLIC_BILLY_TESTER_BUILD?.trim().toLowerCase() === 'true';

const validScenarios = new Set<DemoScenario>([
  'error',
  'funded',
  'maintenance',
  'new-user',
  'offline',
  'pending',
]);

export const billyDataSource: BillyDataSource =
  requestedMode === 'demo' ? 'demo' : 'supabase';

export const isBillyDevDemo =
  billyDataSource === 'demo' && (__DEV__ || isExplicitTesterBuild);

if (billyDataSource === 'demo' && !isBillyDevDemo) {
  throw new BillyRepositoryError(
    'configuration',
    'Billy demo data is disabled outside development and signed tester builds.',
  );
}

export const billyDemoScenario: DemoScenario =
  requestedScenario && validScenarios.has(requestedScenario as DemoScenario)
    ? (requestedScenario as DemoScenario)
    : 'funded';

export const billyMainRepository =
  billyDataSource === 'demo'
    ? createDemoRepository(billyDemoScenario)
    : createSupabaseRepository();
