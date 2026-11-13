import { LuaFactory } from 'wasmoon';

/** Lua sources the host needs; read from disk in tests and the server, injected through Vite in the browser. */
export interface LuaSources {
  /** Plugin modules by require() name: util, rules, names, config. */
  modules: Record<string, string>;
  shim: string;
  json: string;
  bridge: string;
}

export interface SanitiseResult {
  config: Record<string, unknown>;
  warning: string | null;
  /** Raw text the plugin would have saved as config.json.bad, or null. */
  badCopy: string | null;
}

export interface LuaHost {
  /** Call `require(module)[fn](...args)`; arguments and results are JSON values. Lua nil results come back as null. */
  call(module: string, fn: string, ...args: unknown[]): Promise<unknown[]>;
  /** Run the plugin's own config.load() sanitiser on raw config text. */
  sanitise(raw: string): Promise<SanitiseResult>;
  close(): void;
}

export async function createLuaHost(sources: LuaSources): Promise<LuaHost> {
  const lua = await new LuaFactory().createEngine();
  const preload = (name: string, src: string) => {
    lua.global.set('__src', src);
    lua.doStringSync(`package.preload[${JSON.stringify(name)}] = assert(load(__src, ${JSON.stringify('=' + name)}))`);
  };
  lua.doStringSync(sources.shim);
  preload('chatterino.json', sources.json);
  for (const [name, src] of Object.entries(sources.modules)) preload(name, src);
  lua.doStringSync(sources.bridge);

  const callBridge = lua.global.get('__call') as (m: string, f: string, p: string) => string;
  const sanitiseBridge = lua.global.get('__sanitise') as (raw: string) => string;

  return {
    async call(module, fn, ...args) {
      const a: Record<string, unknown> = {};
      args.forEach((v, i) => {
        if (v !== undefined && v !== null) a[String(i + 1)] = v;
      });
      const out = JSON.parse(callBridge(module, fn, JSON.stringify({ n: args.length, a }))) as { n: number; r?: Record<string, unknown> };
      return Array.from({ length: out.n }, (_, i) => out.r?.[String(i + 1)] ?? null);
    },
    async sanitise(raw) {
      const out = JSON.parse(sanitiseBridge(raw)) as { config: Record<string, unknown>; warning?: string; bad?: string };
      return { config: out.config, warning: out.warning ?? null, badCopy: out.bad ?? null };
    },
    close() {
      lua.global.close();
    },
  };
}
