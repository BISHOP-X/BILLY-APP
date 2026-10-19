import assert from 'node:assert/strict';
import { compareNumberServices } from '../_shared/service-api/number-display.ts';

Deno.test('Display priority reorders only existing offers without changing price, stock or routing', () => {
  const offers = [
    { name: '1688', price: 3, stock: 9, provider: 'first' },
    { name: 'Telegram', price: 10, stock: 2, provider: 'second' },
    { name: 'Example', price: 4, stock: 5, provider: 'first' },
    { name: 'Google / Gmail', price: 8, stock: 1, provider: 'first' },
  ];
  const sorted = [...offers].sort(compareNumberServices);
  assert.deepEqual(sorted.map((o) => o.name), [
    'Telegram',
    'Google / Gmail',
    '1688',
    'Example',
  ]);
  assert.equal(sorted.length, offers.length);
  assert(sorted.every((o) => offers.includes(o)));
  assert(!sorted.some((o) => o.name === 'WhatsApp'));
  assert.equal(
    compareNumberServices({ name: 'Example' }, { name: 'Unknown' }),
    0,
  );
});
