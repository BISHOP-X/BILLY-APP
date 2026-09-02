import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist');
const port = Number.parseInt(process.env.BILLY_WEB_PORT ?? '8087', 10);
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.ttf', 'font/ttf'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

async function resolveRequest(pathname) {
  const requested = resolve(root, `.${decodeURIComponent(pathname)}`);
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    return resolve(root, 'index.html');
  }

  try {
    const file = await stat(requested);
    if (file.isFile()) return requested;
  } catch {
    // Application routes intentionally fall through to the SPA document.
  }

  return resolve(root, 'index.html');
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const filePath = await resolveRequest(url.pathname);
  response.setHeader(
    'Content-Type',
    contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
  );
  response.setHeader(
    'Cache-Control',
    filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
  );
  createReadStream(filePath).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Billy web preview: http://127.0.0.1:${port}`);
});
