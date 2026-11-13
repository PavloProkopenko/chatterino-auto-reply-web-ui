#!/usr/bin/env node
// Copies the plugin's pure Lua modules into vendor/plugin/ and records plugin version + SHA-256 hashes.
//   node scripts/sync-plugin.mjs            copy from the plugin repo and rewrite VERSION.json
//   node scripts/sync-plugin.mjs --check    fail if vendor/plugin/ differs from VERSION.json
// Source: $PLUGIN_REPO/auto-reply (default ../auto-reply-plugin/auto-reply). The plugin repo is only read.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILES = ['util.lua', 'rules.lua', 'names.lua', 'config.lua'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor', 'plugin');
const versionFile = join(vendorDir, 'VERSION.json');

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function checkVendor(dir = vendorDir) {
  const vf = join(dir, 'VERSION.json');
  if (!existsSync(vf)) return ['VERSION.json is missing (run sync-plugin)'];
  const rec = JSON.parse(readFileSync(vf, 'utf8'));
  const problems = [];
  for (const f of FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) problems.push(`${f}: missing`);
    else if (sha256(readFileSync(p)) !== rec.files?.[f]) problems.push(`${f}: hash differs from VERSION.json`);
  }
  return problems;
}

function sync() {
  const src = resolve(root, process.env.PLUGIN_REPO ?? '../auto-reply-plugin', 'auto-reply');
  const info = join(src, 'info.json');
  if (!existsSync(info)) throw new Error(`plugin not found at ${src} (set PLUGIN_REPO)`);
  const meta = JSON.parse(readFileSync(info, 'utf8'));
  if (meta.name !== 'Auto Reply') throw new Error(`unexpected plugin name: ${meta.name}`);
  mkdirSync(vendorDir, { recursive: true });
  const files = {};
  for (const f of FILES) {
    copyFileSync(join(src, f), join(vendorDir, f));
    files[f] = sha256(readFileSync(join(vendorDir, f)));
  }
  writeFileSync(versionFile, JSON.stringify({ plugin: meta.name, version: meta.version, files }, null, 2) + '\n');
  console.log(`vendored plugin ${meta.version}: ${FILES.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = checkVendor();
    if (problems.length) {
      console.error('vendor drift:\n  ' + problems.join('\n  '));
      process.exit(1);
    }
    console.log('vendor/plugin matches VERSION.json');
  } else {
    sync();
  }
}
