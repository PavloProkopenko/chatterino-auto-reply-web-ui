import { createLuaHost, type LuaHost } from './host.ts';
import type { Port, Request, Response } from './protocol.ts';

/** Worker side: answers requests with a Lua host. Entry points adapt their runtime's port and call this. */
export function serveLuaHost(port: Port): void {
  let host: Promise<LuaHost> | undefined;
  port.onMessage((raw) => {
    const req = raw as Request;
    const reply = (r: Response) => port.postMessage(r);
    void (async () => {
      try {
        if (req.kind === 'init') {
          host = createLuaHost(req.sources);
          await host;
          reply({ id: req.id, ok: true, result: null });
          return;
        }
        if (!host) throw new Error('worker not initialised');
        const h = await host;
        const result = req.kind === 'call' ? await h.call(req.module, req.fn, ...req.args) : await h.sanitise(req.raw);
        reply({ id: req.id, ok: true, result });
      } catch (e) {
        reply({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}
