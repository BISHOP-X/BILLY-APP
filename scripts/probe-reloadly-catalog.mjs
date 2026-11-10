// Read-only provider probe. Credentials are environment-only; no orders are placed.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const clientId = process.env.RELOADLY_CLIENT_ID;
const clientSecret = process.env.RELOADLY_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Reloadly credentials are required in the environment.');
const directory = resolve('output/reloadly');
await mkdir(directory, { recursive: true });
const summary = { checkedAt: new Date().toISOString(), environment: 'live', purchasesMade: 0, products: {} };
for (const [product, path] of [
  ['giftcards', '/products?size=200&page=1'],
  ['topups', '/operators/countries/NG?includeBundles=true&includeData=true&includePin=true'],
  ['utilities', '/billers?countryISOCode=NG&size=200&page=1'],
]) {
  const base = `https://${product}.reloadly.com`;
  try {
    const authResponse = await fetch('https://auth.reloadly.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', audience: base }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!authResponse.ok) throw new Error(`Authentication HTTP ${authResponse.status}`);
    const auth = await authResponse.json();
    const headers = { Authorization: `Bearer ${auth.access_token}`, Accept: `application/com.reloadly.${product === 'topups' ? 'topups' : product}-v1+json` };
    const rows = [];
    let page = 1;
    let pages = 1;
    let meta;
    do {
      const url = new URL(path, base);
      if (url.searchParams.has('page')) url.searchParams.set('page', String(page));
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
      const data = await response.json();
      const content = Array.isArray(data) ? data : data.content;
      if (!Array.isArray(content)) throw new Error('Unrecognized catalog response; no completeness claim.');
      rows.push(...content);
      pages = Array.isArray(data) ? 1 : data.totalPages;
      meta = Array.isArray(data) ? null : { totalElements: data.totalElements, totalPages: data.totalPages, size: data.size };
      if (!Number.isInteger(pages) || pages < 1 || pages > 200) {
        if (rows.length === 0 && pages === 0) break;
        throw new Error('Unrecognized pagination; no completeness claim.');
      }
      page++;
    } while (page <= pages);
    if (meta?.totalElements !== undefined && rows.length !== meta.totalElements) throw new Error(`Incomplete catalog: ${rows.length}/${meta.totalElements}`);
    const idField = product === 'giftcards' ? 'productId' : product === 'topups' ? 'operatorId' : 'id';
    if (rows.some(row => row[idField] === undefined) || new Set(rows.map(row => row[idField])).size !== rows.length) {
      throw new Error('Missing or duplicate product identifiers; no completeness claim.');
    }
    if (product !== 'giftcards' && rows.some(row => (product === 'topups' ? row.country?.isoName : row.countryCode) !== 'NG')) {
      throw new Error('Unexpected country in Nigeria catalog.');
    }
    await writeFile(resolve(directory, `${product}-live.json`), JSON.stringify({ checkedAt: summary.checkedAt, environment: 'live', meta, rows }, null, 2));
    summary.products[product] = { ok: true, count: rows.length, pages, currencies: [...new Set(rows.map(r => r.senderCurrencyCode ?? r.senderCurrency ?? r.localTransactionCurrencyCode).filter(Boolean))], sample: rows.slice(0, 2) };
  } catch (error) {
    // Never dump request headers, credential objects, or token responses.
    summary.products[product] = { ok: false, error: error.message };
  }
}
await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (Object.values(summary.products).some(product => !product.ok)) process.exitCode = 1;
