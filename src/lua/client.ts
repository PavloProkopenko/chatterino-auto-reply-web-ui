import type { LuaSources, SanitiseResult } from './host.ts';
import type { Port, Request, Response } from './protocol.ts';

export interface WorkerHandle extends Port {
  onError(callback: (error: Error) => void): void;
  terminate(): void;
}

/** Adapt a browser Web Worker to a WorkerHandle. */
export function fromWebWorker(w: Worker): WorkerHandle {
  return {
    postMessage: (m) => w.postMessage(m),
    onMessage: (cb) => w.addEventListener('message', (e) => cb(e.data)),
    onError: (cb) => w.addEventListener('error', (e) => cb(new Error(e.message))),
    terminate: () => w.terminate(),
  };
}

export class LuaTimeoutError extends Error {
  constructor(ms: number) {
    super(`Lua evaluation exceeded ${ms} ms and was stopped`);
    this.name = 'LuaTimeoutError';
  }
}

export interface LuaClientOptions {
  spawn: () => WorkerHandle;
  sources: LuaSources;
  /** Per-request limit; the worker is killed and replaced when it is exceeded. */
  timeoutMs: number;
}

export interface LuaClient {
  call(module: string, fn: string, ...args: unknown[]): Promise<unknown[]>;
  sanitise(raw: string): Promise<SanitiseResult>;
  close(): void;
}

/** Runs the Lua host in a worker. Requests run one at a time; a request that times out costs the worker, not the page. */
export function createLuaClient(opts: LuaClientOptions): LuaClient {
  let worker: WorkerHandle | undefined;
  let ready: Promise<void> | undefined;
  let nextId = 1;
  let pending: { id: number; resolve: (v: unknown) => void; reject: (e: Error) => void } | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const kill = (reason: Error) => {
    worker?.terminate();
    worker = undefined;
    ready = undefined;
    pending?.reject(reason);
    pending = undefined;
  };

  const send = (req: Request, timeoutMs: number): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => kill(new LuaTimeoutError(timeoutMs)), timeoutMs);
      pending = {
        id: req.id,
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      worker!.postMessage(req);
    });

  const ensure = (): Promise<void> => {
    if (ready) return ready;
    const w = opts.spawn();
    worker = w;
    w.onMessage((m) => {
      const r = m as Response;
      if (w !== worker || !pending || pending.id !== r.id) return;
      const p = pending;
      pending = undefined;
      if (r.ok) p.resolve(r.result);
      else p.reject(new Error(r.error));
    });
    w.onError((e) => {
      if (w === worker) kill(e);
    });
    // Starting WASM and loading the Lua modules gets a generous limit of its own.
    ready = send({ id: nextId++, kind: 'init', sources: opts.sources }, Math.max(opts.timeoutMs, 10000)).then(() => undefined);
    ready.catch(() => undefined);
    return ready;
  };

  const run = (make: (id: number) => Request): Promise<unknown> => {
    const job = queue.then(async () => {
      await ensure();
      return send(make(nextId++), opts.timeoutMs);
    });
    queue = job.catch(() => undefined);
    return job;
  };

  return {
    call: (module, fn, ...args) => run((id) => ({ id, kind: 'call', module, fn, args })) as Promise<unknown[]>,
    sanitise: (raw) => run((id) => ({ id, kind: 'sanitise', raw })) as Promise<SanitiseResult>,
    close: () => kill(new Error('client closed')),
  };
}
