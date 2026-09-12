import { once } from 'node:events';
import { createServer } from 'node:http';

// Optional controlled local HTTP acquisition. The backend must inherit its documented
// BG_EXTRACTION_QA_ADAPTER_* contract before startup; this is not a live website.
export async function localSource(env = process.env) {
  if (!env.BG_EXTRACTION_QA_ADAPTER_SOURCE_URL) return null;
  const source = new URL(env.BG_EXTRACTION_QA_ADAPTER_SOURCE_URL);
  if (source.protocol !== 'http:' || source.hostname !== '127.0.0.1' || source.pathname !== '/source') throw new Error('Unowned catalog source URL');
  const secret = env.BG_EXTRACTION_QA_ADAPTER_SECRET;
  if (!secret || secret.length < 32) throw new Error('Local catalog source secret required');
  const events = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, source).pathname;
    const authorized = request.headers['x-burnguard-qa-adapter-secret'] === secret;
    events.push({ pathname, authorized });
    if (!authorized) { response.writeHead(403).end('forbidden'); return; }
    const content = {
      '/source': ['text/html', '<!doctype html><html><head><title>Catalog local website</title><link rel="stylesheet" href="/styles.css"></head><body><img src="/brand-logo.svg" alt="Catalog brand logo"><h1>Catalog local website</h1><p>Controlled local source for real acquisition, not an external website connection.</p><button class="primary">Source button</button><section class="card"><h2>Source card</h2><p>Local component reference.</p></section></body></html>'],
      '/styles.css': ['text/css', ':root { --catalog-source-primary: #123abc; --catalog-source-background: #f1f5f9; } body { background: var(--catalog-source-background); color: #334455; font-family: Arial, sans-serif; padding: 24px; } .primary { background: var(--catalog-source-primary); color: #ffffff; border-radius: 8px; padding: 12px 24px; } .card { border: 1px solid #334455; border-radius: 12px; margin: 16px; } h1 { font-size: 32px; font-weight: 700; }'],
      '/brand-logo.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#123abc"/></svg>'],
    }[pathname];
    if (pathname === '/stall') {
      response.once('close', () => { if (!response.writableEnded) server.emit('source-aborted'); });
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<!doctype html><html><body>');
      return;
    }
    if (!content) { response.writeHead(404).end('not found'); return; }
    response.writeHead(200, { 'content-type': content[0], 'content-length': Buffer.byteLength(content[1]) }).end(content[1]);
  });
  server.listen(Number(source.port), source.hostname);
  await once(server, 'listening');
  return {
    url: source.href, stall: env.BG_EXTRACTION_QA_ADAPTER_STALL_URL, events,
    aborted: () => once(server, 'source-aborted', { signal: AbortSignal.timeout(15_000) }),
    close: async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
