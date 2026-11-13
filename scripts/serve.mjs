import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pixHandler from '../api/pix.js';
import statusHandler from '../api/pix-status.js';
import healthHandler from '../api/payment-health.js';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const handlers = { '/api/pix': pixHandler, '/api/pix-status': statusHandler, '/api/payment-health': healthHandler };
  if (handlers[url.pathname]) {
    response.status = (status) => { response.statusCode = status; return response; };
    response.json = (body) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); };
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) return response.status(413).json({ message: 'Solicitação muito grande.' });
      chunks.push(chunk);
    }
    request.body = Buffer.concat(chunks).toString() || undefined;
    return handlers[url.pathname](request, response);
  }
  try {
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error('outside root');
    const body = await readFile(file);
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404).end('Não encontrado'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
