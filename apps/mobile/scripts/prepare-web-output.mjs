import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputPath = resolve('dist', 'index.html');
const original = await readFile(outputPath, 'utf8');
const headMarker = '    <title>Billy</title>';

if (!original.includes(headMarker)) {
  throw new Error('Billy web export is missing its expected document title.');
}

const metadata = `${headMarker}
    <meta name="theme-color" content="#0B4829" />
    <meta name="format-detection" content="telephone=no" />
    <meta name="robots" content="noindex, nofollow" />
    <meta
      name="description"
      content="Use Billy to access bills, gift cards, virtual cards, crypto and digital services."
    />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Billy" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/site.webmanifest" />`;

const prepared = original
  .replace('<html lang="en">', '<html lang="en-NG">')
  .replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
  )
  .replace(headMarker, metadata);

await writeFile(outputPath, prepared, 'utf8');
