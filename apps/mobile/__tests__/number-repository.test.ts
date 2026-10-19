import { numberRepository } from '@/features/numbers/repository';
import { invokeAction } from '@/features/services/supabase-service-repository';

jest.mock('@/features/services/supabase-service-repository', () => ({ invokeAction: jest.fn() }));

test.each(['', '  '])('shared catalogue omits an empty search (%j) like the short catalogue', async query => {
  await numberRepository.sharedCatalog(1, query);
  expect(invokeAction).toHaveBeenLastCalledWith('numbers.catalog', { page: 1, query: undefined, shared: true });
});

test('shared catalogue trims a real search and preserves the selected mode', async () => {
  await numberRepository.sharedCatalog(2, ' WhatsApp ');
  expect(invokeAction).toHaveBeenLastCalledWith('numbers.catalog', { page: 2, query: 'WhatsApp', shared: true });
});
