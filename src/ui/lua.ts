import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import { createLuaClient, fromWebWorker, type LuaClient } from '../lua/client.ts';
import bridge from '../lua/bridge.lua?raw';
import json from '../lua/json.lua?raw';
import shim from '../lua/shim.lua?raw';
import config from '../../vendor/plugin/config.lua?raw';
import names from '../../vendor/plugin/names.lua?raw';
import rules from '../../vendor/plugin/rules.lua?raw';
import util from '../../vendor/plugin/util.lua?raw';

/** The plugin's real Lua, in a Web Worker; a runaway pattern costs the worker, not the page. */
export function createUiLua(timeoutMs = 1500): LuaClient {
  return createLuaClient({
    spawn: () => fromWebWorker(new Worker(new URL('../lua/worker-entry.ts', import.meta.url), { type: 'module' })),
    sources: { modules: { util, rules, names, config }, shim, json, bridge, wasmUri: new URL(wasmUrl, location.href).href },
    timeoutMs,
  });
}

export const lua = createUiLua();
