#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.ICON_STUDIO_PORT || 8821);
const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (!['/', '/index.html', '/VibeField%20Icon%20Studio.html'].includes(pathname)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const html = await readFile(join(here, 'dist/index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(`Icon studio: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
