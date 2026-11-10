// Checks the actual exported startup script, including blocked browser storage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve('apps/mobile/dist');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const match = html.match(/<script src="\/(appearance-[a-f0-9]+\.js)"><\/script>/);
assert.ok(match, 'Appearance restore must be a synchronous same-origin script.');
assert.equal((html.match(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/g) ?? []).length, 0, 'No inline scripts under the strict production CSP.');
const script = await readFile(resolve(root, match[1]), 'utf8');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const policy = config.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy').value;
const scriptPolicy = policy.split(';').find(directive => directive.trim().startsWith('script-src '));
assert.ok(scriptPolicy.includes("'self'"));
assert.ok(!scriptPolicy.includes("'unsafe-inline'"));

for (const systemDark of [false, true]) {
  for (const stored of ['light', 'dark', 'system', 'invalid', null, 'blocked']) {
    const properties = {};
    const themeMeta = {};
    const documentElement = { dataset: {}, style: { setProperty: (name, value) => { properties[name] = value; } } };
    runInNewContext(script, {
      document: { documentElement, querySelector: () => themeMeta },
      localStorage: { getItem: () => { if (stored === 'blocked') throw new Error('Storage unavailable'); return stored; } },
      matchMedia: () => ({ matches: systemDark }),
    });
    const dark = stored === 'dark' || (stored !== 'light' && systemDark);
    assert.equal(documentElement.dataset.billyTheme, dark ? 'dark' : 'light');
    assert.equal(documentElement.style.colorScheme, dark ? 'dark' : 'light');
    assert.equal(properties['--billy-canvas'], dark ? '#0C1511' : '#F5F6F3');
    assert.equal(themeMeta.content, properties['--billy-canvas']);
  }
}
console.log('Exported appearance bootstrap: 12 preference/storage scenarios passed; production CSP preserved.');
