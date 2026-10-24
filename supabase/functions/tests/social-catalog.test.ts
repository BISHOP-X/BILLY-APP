import assert from 'node:assert/strict';
import { handleSocialBoostAction, type SocialBoostServiceRuntime } from '../_shared/service-api/social-boost-service.ts';
import { SocialBoostMockAdapter, type SocialBoostService } from '../_shared/providers/social-boost.ts';
import { ServiceTokenCodec } from '../_shared/service-api/tokens.ts';

Deno.test('boost categories span all pages and category filtering preserves provider order', async () => {
  const sample = (await new SocialBoostMockAdapter().getServices())[0];
  const services: SocialBoostService[] = Array.from({ length: 103 }, (_, index) => ({
    ...sample, providerServiceId: String(index), platform: 'instagram',
    name: `Service ${index}`, category: index < 101 ? 'Followers' : 'Likes',
  }));
  const runtime = {
    adapter: { mode: 'mock', adapter: { getServices: () => Promise.resolve(services) } },
    database: { syncCatalog: () => Promise.resolve(new Set(services.map((service) => service.providerServiceId))) },
    tokens: new ServiceTokenCodec('synthetic-social-catalog-test-secret-long-enough'),
    digest: async (value: string) => `test-hash-${value}`,
    exchangeRateMinorPerUsd: 140_000,
    markupBps: 0,
  } as unknown as SocialBoostServiceRuntime;
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const invoke = async (input: Record<string, unknown>) => (await handleSocialBoostAction('social.catalog', input, user, runtime)).data as {
    categories: string[]; total: number; pages: number; services: { name: string; category: string; selectionToken: string }[];
  };
  const first = await invoke({ limit: 100 });
  assert.deepEqual(first.categories, ['Followers', 'Likes']);
  assert.equal(first.services.length, 100);
  assert.equal(first.pages, 2);
  const category = await invoke({ category: 'Likes', limit: 100 });
  assert.equal(category.total, 2);
  assert.deepEqual(category.services.map((service) => service.name), ['Service 101', 'Service 102']);
  assert.deepEqual(category.categories, ['Followers', 'Likes']);
  assert.equal((await invoke({ category: 'Followers', page: 2, limit: 100 })).services.length, 1);
  assert.deepEqual((await invoke({ query: 'Service 102' })).categories, ['Likes']);
  assert.equal((await invoke({ platform: 'youtube' })).total, 0);
  assert.equal((await invoke({ category: 'Missing category' })).total, 0);
  assert.equal('providerServiceId' in category.services[0], false);
  const snapshot = await invoke({ snapshot: true });
  assert.equal(snapshot.services.length, 103);
  assert.equal(snapshot.pages, 1);
  await assert.rejects(() => invoke({ snapshot: true, category: 'Likes' }), /cannot include filters/);
  await assert.rejects(() => invoke({ snapshot: 'true' }), /boolean/);
});

Deno.test('snapshot prices include configured markup and compact selections revalidate prices, availability and ownership', async () => {
  let available = true;
  const sample = (await new SocialBoostMockAdapter().getServices())[0];
  const service = { ...sample, rateMicroUsdPerThousand: 1_234_567, minimumQuantity: 1 };
  const tokens = new ServiceTokenCodec('synthetic-social-catalog-test-secret-long-enough');
  const runtime = {
    adapter: { mode: 'mock', adapter: { getServices: () => Promise.resolve([service]) } },
    database: { syncCatalog: () => Promise.resolve(new Set(available ? [service.providerServiceId] : [])) },
    tokens, digest: async () => 'opaque-stable-catalog-key', exchangeRateMinorPerUsd: 140_000, markupBps: 1250,
  } as unknown as SocialBoostServiceRuntime;
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const snapshot = (await handleSocialBoostAction('social.catalog', { snapshot: true }, user, runtime)).data as { services: { selectionToken: string; priceMinorPerThousand: number; catalogKey: string }[] };
  const item = snapshot.services[0];
  assert.equal(item.priceMinorPerThousand, 194_445); // 172840 kobo + ceil(12.5%) = 21605
  assert.equal(item.catalogKey, 'opaque-stable-catalog-key');
  assert.deepEqual(await tokens.readOpaque(item.selectionToken, 'social_service', user.id), { providerServiceId: service.providerServiceId });
  const quote = async (id = user.id) => (await handleSocialBoostAction('social.quote', { selectionToken: item.selectionToken, quantity: 1000 }, { id }, runtime)).data as { totalMinor: number };
  assert.equal((await quote()).totalMinor, item.priceMinorPerThousand);
  service.rateMicroUsdPerThousand = 2_000_000;
  assert.equal((await quote()).totalMinor, 315_000);
  await assert.rejects(() => quote('22222222-2222-4222-8222-222222222222'), /invalid or expired/);
  available = false;
  await assert.rejects(() => quote(), /no longer available/);
});
