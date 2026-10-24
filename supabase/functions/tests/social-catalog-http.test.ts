import assert from 'node:assert/strict';
import { createServiceApiHandler, type ServiceApiDependencies } from '../_shared/service-api/handler.ts';
import { SocialBoostMockAdapter } from '../_shared/providers/social-boost.ts';
import { ServiceTokenCodec, createHmacHexDigester } from '../_shared/service-api/tokens.ts';

Deno.test('full catalogue crosses the authenticated HTTP boundary compressed or plain; ordinary response limit remains intact', async () => {
  const sample = (await new SocialBoostMockAdapter().getServices())[0];
  let services = Array.from({ length: 9742 }, (_, index) => ({ ...sample, providerServiceId: String(index), name: `Synthetic service ${index}` }));
  const secret = 'synthetic-http-catalogue-secret-long-enough';
  const handler = createServiceApiHandler({
    authenticateBearer: async (bearer: string) => bearer === 'synthetic-user' ? { id: '11111111-1111-4111-8111-111111111111' } : null,
    socialBoost: {
      adapter: { mode: 'mock', adapter: { getServices: async () => services } },
      database: { syncCatalog: async () => new Set(services.map(item => item.providerServiceId)) },
      tokens: new ServiceTokenCodec(secret), digest: createHmacHexDigester(secret),
      exchangeRateMinorPerUsd: 140000, markupBps: 0,
    },
  } as unknown as ServiceApiDependencies);
  const request = (input: unknown, encoding = '', bearer = 'synthetic-user') => handler(new Request('https://billy.invalid/service-api', {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'accept-encoding': encoding },
    body: JSON.stringify({ action: 'social.catalog', input }),
  }));
  const compressed = await request({ snapshot: true }, 'gzip, deflate');
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  const bytes = await compressed.arrayBuffer();
  const decoded = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.ok(decoded.length > 512 * 1024);
  assert.ok(bytes.byteLength < decoded.length);
  assert.equal(JSON.parse(decoded).data.services.length, 9742);
  const plain = await request({ snapshot: true }, 'gzip;q=0');
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.equal((await plain.json()).data.services.length, 9742);
  const anonymous = await request({ snapshot: true }, 'gzip', 'invalid');
  assert.equal(anonymous.status, 401);
  await anonymous.body?.cancel();
  services = services.slice(0, 100).map(item => ({ ...item, name: 'x'.repeat(6000) }));
  const oversizedOrdinary = await request({ limit: 100 });
  assert.equal(oversizedOrdinary.status, 503);
  assert.equal((await oversizedOrdinary.json()).error.code, 'unavailable');
});
