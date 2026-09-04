import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputPath = resolve('dist', 'index.html');
const logoPath = resolve('assets', 'brand', 'billy-wordmark-transparent.png');
const original = await readFile(outputPath, 'utf8');
const logoData = await readFile(logoPath);
const logoSource = `data:image/png;base64,${logoData.toString('base64')}`;
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

const bootstrapStyles = `    <style id="billy-bootstrap-styles">
      #billy-bootstrap {
        align-items: center;
        background:
          radial-gradient(circle at 50% 42%, rgba(69, 185, 121, 0.18), transparent 34%),
          #07160d;
        color: #f5faf7;
        display: flex;
        flex-direction: column;
        gap: 18px;
        inset: 0;
        justify-content: center;
        opacity: 1;
        pointer-events: none;
        position: fixed;
        transition: opacity 220ms ease;
        z-index: 9999;
      }
      #billy-bootstrap img {
        height: auto;
        width: min(42vw, 164px);
      }
      #billy-bootstrap span {
        color: #a9b9af;
        font: 600 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      #root:not(:empty) + #billy-bootstrap {
        opacity: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        #billy-bootstrap { transition: none; }
      }
    </style>`;

const bootstrapMarkup = `<div id="billy-bootstrap" aria-label="Opening Billy">
      <img alt="Billy" src="${logoSource}" />
      <span>Opening your Billy space</span>
    </div>`;

const prepared = original
  .replace('<html lang="en">', '<html lang="en-NG">')
  .replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
  )
  .replace(headMarker, `${metadata}\n${bootstrapStyles}`)
  .replace('<div id="root"></div>', `<div id="root"></div>\n    ${bootstrapMarkup}`);

await writeFile(outputPath, prepared, 'utf8');
