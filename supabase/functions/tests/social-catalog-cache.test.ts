import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSocialBoostDatabase } from '../_shared/service-api/social-boost-database.ts';
import { SocialBoostMockAdapter } from '../_shared/providers/social-boost.ts';

Deno.test('browse catalogue sync is deduplicated, bounded and never used for checkout checks', async () => {
  const services = await new SocialBoostMockAdapter().getServices();
  let calls = 0;
  let enabled = true;
  const client = { rpc: () => {
    calls += 1;
    return Promise.resolve({ data: enabled ? services.map((item) => ({ provider_service_id: item.providerServiceId })) : [], error: null });
  } } as unknown as SupabaseClient;
  const db = createSocialBoostDatabase(client);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await Promise.all([db.syncCatalog(services, { browseCache: true }), db.syncCatalog(services, { browseCache: true })]);
    assert.equal(calls, 1);
    // A fresh runtime uses the same client/provider snapshot, not a new cache.
    await createSocialBoostDatabase(client).syncCatalog(services, { browseCache: true });
    assert.equal(calls, 1);
    enabled = false;
    assert.equal((await db.syncCatalog(services)).size, 0);
    assert.equal(calls, 2, 'quote/submit must bypass browse cache even for the identical array');
    now += 30_001;
    assert.equal((await db.syncCatalog(services, { browseCache: true })).size, 0);
    assert.equal(calls, 3);
    await db.syncCatalog([...services], { browseCache: true });
    assert.equal(calls, 4, 'a new provider snapshot must not reuse old availability');
  } finally { Date.now = originalNow; }
});

Deno.test('failed catalogue sync is not cached and separate DB clients cannot share it', async () => {
  const services = await new SocialBoostMockAdapter().getServices();
  let calls = 0;
  const client = { rpc: () => {
    calls += 1;
    return Promise.resolve(calls === 1 ? { data: null, error: { message: 'synthetic failure' } } : { data: [], error: null });
  } } as unknown as SupabaseClient;
  const db = createSocialBoostDatabase(client);
  await assert.rejects(db.syncCatalog(services, { browseCache: true }));
  assert.equal((await db.syncCatalog(services, { browseCache: true })).size, 0);
  assert.equal(calls, 2);
  const separate = { rpc: () => Promise.resolve({ data: [{ provider_service_id: 'independent' }], error: null }) } as unknown as SupabaseClient;
  assert.deepEqual(await createSocialBoostDatabase(separate).syncCatalog(services, { browseCache: true }), new Set(['independent']));
});
