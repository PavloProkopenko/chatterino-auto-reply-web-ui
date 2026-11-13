// Browser Web Worker entry: `new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })`.
import { serveLuaHost } from './serve.ts';

serveLuaHost({
  postMessage: (m) => self.postMessage(m),
  onMessage: (cb) => self.addEventListener('message', (e) => cb((e as MessageEvent).data)),
});
