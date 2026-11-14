#!/usr/bin/env node
// Copies the plugin's runtime files (every top-level *.lua plus info.json) into vendor/plugin/ and records
// plugin version + SHA-256 hashes. Subfolders (data/, tests/) are never copied.
//   node scripts/sync-plugin.mjs            copy from the plugin repo and rewrite VERSION.json
//   node scripts/sync-plugin.mjs --check    fail if vendor/plugin/ differs from VERSION.json
// Source: $PLUGIN_REPO/auto-reply (default ../auto-reply-plugin/auto-reply). The plugin repo is only read.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Runtime files of a plugin folder: top-level *.lua plus info.json, sorted. Subfolders are ignored. */
export function listPluginFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith('.lua') || e.name === 'info.json'))
    .map((e) => e.name)
    .sort();
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor', 'plugin');
const versionFile = join(vendorDir, 'VERSION.json');

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function checkVendor(dir = vendorDir, sourceDir = null) {
  const vf = join(dir, 'VERSION.json');
  if (!existsSync(vf)) return ['VERSION.json is missing (run sync-plugin)'];
  const rec = JSON.parse(readFileSync(vf, 'utf8'));
  const recorded = Object.keys(rec.files ?? {});
  const problems = [];
  for (const f of recorded) {
    const p = join(dir, f);
    if (!existsSync(p)) problems.push(`${f}: missing`);
    else if (sha256(readFileSync(p)) !== rec.files[f]) problems.push(`${f}: hash differs from VERSION.json`);
  }
  for (const f of listPluginFiles(dir)) {
    if (!recorded.includes(f)) problems.push(`${f}: not listed in VERSION.json`);
  }
  if (sourceDir) {
    for (const f of listPluginFiles(sourceDir)) {
      if (!recorded.includes(f)) problems.push(`${f}: exists in the plugin but is not vendored (run sync-plugin)`);
    }
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
  const names = listPluginFiles(src);
  for (const old of listPluginFiles(vendorDir)) if (!names.includes(old)) rmSync(join(vendorDir, old));
  const files = {};
  for (const f of names) {
    copyFileSync(join(src, f), join(vendorDir, f));
    files[f] = sha256(readFileSync(join(vendorDir, f)));
  }
  writeFileSync(versionFile, JSON.stringify({ plugin: meta.name, version: meta.version, files }, null, 2) + '\n');
  console.log(`vendored plugin ${meta.version}: ${names.join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const src = resolve(root, process.env.PLUGIN_REPO ?? '../auto-reply-plugin', 'auto-reply');
    const problems = checkVendor(vendorDir, existsSync(join(src, 'info.json')) ? src : null);
    if (problems.length) {
      console.error('vendor drift:\n  ' + problems.join('\n  '));
      process.exit(1);
    }
    console.log('vendor/plugin matches VERSION.json');
  } else {
    sync();
  }
}
