// Spike: 127.0.0.1-only server, random port, Host check, per-session token, atomic write.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

const PAGE = '<!doctype html><meta charset=utf-8><title>spike</title><p id=o>привет</p>';
const token = randomBytes(24).toString('hex');
const target = process.env.SPIKE_TARGET; // file the API may write, nothing else

function atomicWrite(path, data) {
  const tmp = join(dirname(path), `.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, data);
  renameSync(tmp, path); // POSIX: atomic; Windows: replaces if target not opened without share-delete
}

const server = http.createServer((req, res) => {
  const host = req.headers.host ?? '';
  const port = server.address().port;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(421).end('bad host'); return; }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'" });
    res.end(PAGE); return;
  }
  if (req.headers['x-session-token'] !== token) { res.writeHead(403).end('bad token'); return; }
  if (url.pathname === '/api/ping') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); return; }
  if (url.pathname === '/api/write' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!target) { res.writeHead(500).end('no target'); return; }
      atomicWrite(target, body);
      res.writeHead(200).end('written');
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ port: server.address().port, token }));
});
