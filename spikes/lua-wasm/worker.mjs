import { parentPort, workerData } from 'node:worker_threads';
import { LuaFactory } from 'wasmoon';
const lua = await (new LuaFactory()).createEngine();
const r = await lua.doString(`return pcall(string.find, ${JSON.stringify(workerData.text)}, ${JSON.stringify(workerData.pattern)})`);
parentPort.postMessage(String(r));
