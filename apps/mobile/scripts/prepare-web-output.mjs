import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const outputPath = resolve('dist', 'index.html');
const logoPath = resolve('assets', 'brand', 'billy-wordmark-transparent.png');
const original = await readFile(outputPath, 'utf8');
const logoData = await readFile(logoPath);
const logoSource = `data:image/png;base64,${logoData.toString('base64')}`;
const headMarker = '    <title>Billy</title>';
// A same-origin file keeps the pre-paint preference restore compatible with
// Billy's strict script-src policy; do not enable unsafe-inline for this.
const appearanceBootstrap = `(function () {
  var choice = 'system';
  try { choice = localStorage.getItem('billy.appearance.v1') || 'system'; } catch (_) {}
  var dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.billyTheme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--billy-canvas', dark ? '#0C1511' : '#F5F6F3');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0C1511' : '#F5F6F3';
})();`;
const appearanceScript = `appearance-${createHash('sha256').update(appearanceBootstrap).digest('hex').slice(0, 16)}.js`;

if (!original.includes(headMarker)) {
  throw new Error('Billy web export is missing its expected document title.');
}

const metadata = `${headMarker}
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#F5F6F3" />
    <script src="/${appearanceScript}"></script>
    <meta name="format-detection" content="telephone=no" />
    <meta name="robots" content="noindex, nofollow" />
    <meta
      name="description"
      content="Use Billy to access bills, gift cards, virtual cards, crypto and digital services."
    />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Billy" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/site.webmanifest" />`;

const bootstrapStyles = `    <style id="billy-bootstrap-styles">
      html, body, #root {
        background: var(--billy-canvas, #f5f6f3);
      }
      #billy-bootstrap {
        align-items: center;
        background: var(--billy-canvas, #f5f6f3);
        color: #f5faf7;
        display: flex;
        flex-direction: column;
        gap: 18px;
        inset: 0;
        justify-content: center;
        opacity: 1;
        pointer-events: none;
        position: fixed;
        transition: opacity 120ms ease, visibility 0s linear 120ms;
        z-index: 9999;
      }
      #billy-bootstrap img {
        height: auto;
        width: min(42vw, 164px);
      }
      html[data-billy-theme="light"] #billy-bootstrap img { filter: brightness(0) saturate(100%); }
      #billy-bootstrap span {
        color: #a9b9af;
        font: 600 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      html[data-billy-ready="true"] #billy-bootstrap {
        opacity: 0;
        visibility: hidden;
      }
      @media (prefers-reduced-motion: reduce) {
        #billy-bootstrap { transition: none; }
      }
    </style>`;

const bootstrapMarkup = `<div id="billy-bootstrap" aria-label="Getting Billy ready">
      <img alt="Billy" src="${logoSource}" />
    </div>`;

const prepared = original
  .replace(
    '<html lang="en">',
    '<html lang="en-NG">',
  )
  .replace('<body>', '<body style="margin:0">')
  .replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
  )
  .replace(headMarker, `${metadata}\n${bootstrapStyles}`)
  .replace('<div id="root"></div>', `<div id="root"></div>\n    ${bootstrapMarkup}`);

await writeFile(resolve('dist', appearanceScript), appearanceBootstrap, 'utf8');
await writeFile(outputPath, prepared, 'utf8');
