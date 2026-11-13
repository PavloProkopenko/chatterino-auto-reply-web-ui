// Entry for Node worker_threads in tests (run with --experimental-strip-types). The browser uses src/lua/worker-entry.ts.
import { parentPort } from 'node:worker_threads';
import { serveLuaHost } from '../../src/lua/serve.ts';

if (!parentPort) throw new Error('must run as a worker');
const port = parentPort;
serveLuaHost({
  postMessage: (m) => port.postMessage(m),
  onMessage: (cb) => port.on('message', cb),
});
