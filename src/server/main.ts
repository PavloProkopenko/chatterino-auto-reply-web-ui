import { delimiter } from 'node:path';
import { startServer, type Asset } from './app.ts';

// Placeholder page until the UI exists (Phase 2 replaces it with the built app).
const PLACEHOLDER: Asset = {
  type: 'text/html; charset=utf-8',
  body: '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Auto Reply</title><p>Интерфейс ещё не собран.</p></html>',
};

const roots = process.env.AUTO_REPLY_WEB_ROOTS?.split(delimiter).filter(Boolean);
const server = await startServer({
  ...(roots ? { roots } : {}),
  assets: new Map([['/', PLACEHOLDER]]),
});

// The token is in the fragment: it is never sent to a server and never appears in a log.
console.log(server.url);

const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
