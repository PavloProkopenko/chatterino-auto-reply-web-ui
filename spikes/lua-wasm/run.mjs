import { LuaFactory } from 'wasmoon';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const vendor = resolve('../../vendor/plugin');
const repo = resolve(process.env.PLUGIN_REPO ?? '../../../auto-reply-plugin');
const unit = readFileSync(join(repo, 'auto-reply/tests/cases/unit_rules.lua'), 'utf8');
const m = unit.match(/local cases = (\{[\s\S]*?\n {4}\})\n {4}local bad/);
if (!m) throw new Error('cannot extract cases table');
const casesSrc = m[1];
const shim = readFileSync('shim.lua', 'utf8');
const driver = readFileSync('driver.lua', 'utf8');
const mods = Object.fromEntries(['util', 'rules'].map((n) => [n, readFileSync(join(vendor, n + '.lua'), 'utf8')]));

// 1) system lua
const tmp = mkdtempSync(join(tmpdir(), 'spike-'));
writeFileSync(join(tmp, 'run.lua'),
  `package.path=${JSON.stringify(vendor + '/?.lua;')}..package.path\n${shim}\nCASES_SRC=[==[${casesSrc}]==]\nio.write((function()\n${driver}\nend)())`);
const sys = execFileSync('lua', [join(tmp, 'run.lua')], { encoding: 'utf8' });

// 2) wasmoon
const t0 = performance.now();
const lua = await (new LuaFactory()).createEngine();
const tLoad = performance.now() - t0;
for (const [n, src] of Object.entries(mods)) lua.global.set('SRC_' + n, src);
lua.global.set('CASES_SRC', casesSrc);
await lua.doString(shim);
await lua.doString(`for _, n in ipairs{"util","rules"} do package.preload[n] = assert(load(_G["SRC_"..n], "="..n)) end`);
const t1 = performance.now();
const wasm = await lua.doString(driver);
const tRun = performance.now() - t1;

const rows = wasm.split('\n').map((l) => l.split(':'));
const expectBad = rows.filter(([, got, exp]) => got !== exp).length;
console.log('cases:', rows.length, '| wasm mismatches vs expected table:', expectBad);
console.log('system lua == wasmoon output:', sys === wasm);
console.log(`wasmoon engine create ${tLoad.toFixed(0)} ms, run ${tRun.toFixed(1)} ms`);

// 3) Cyrillic spot checks
console.log('lower:', await lua.doString(`return require("util").lower and require("util").lower("ПРИВІТ Їжак") or "n/a"`));
lua.global.close();
process.exit(sys === wasm && expectBad === 0 ? 0 : 1);
