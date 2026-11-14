import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkVendor, listPluginFiles } from './sync-plugin.mjs';

test('vendored copy matches its recorded hashes', () => {
  assert.deepEqual(checkVendor(), []);
});

test('drift in a vendored file is detected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-'));
  try {
    cpSync(new URL('../vendor/plugin', import.meta.url), dir, { recursive: true });
    appendFileSync(join(dir, 'rules.lua'), '\n-- tampered\n');
    assert.deepEqual(checkVendor(dir), ['rules.lua: hash differs from VERSION.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listPluginFiles takes top-level lua and info.json only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-'));
  try {
    for (const f of ['init.lua', 'b.lua', 'info.json', 'notes.txt', 'config.json']) writeFileSync(join(dir, f), 'x');
    for (const d of ['tests', 'data', '.backup']) {
      mkdirSync(join(dir, d));
      writeFileSync(join(dir, d, 'secret.lua'), 'x');
    }
    assert.deepEqual(listPluginFiles(dir), ['b.lua', 'info.json', 'init.lua']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a vendored file missing from VERSION.json and an unvendored plugin file are reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-'));
  const src = mkdtempSync(join(tmpdir(), 'src-'));
  try {
    cpSync(new URL('../vendor/plugin', import.meta.url), dir, { recursive: true });
    for (const f of listPluginFiles(dir)) writeFileSync(join(src, f), 'x');
    writeFileSync(join(dir, 'extra.lua'), 'x');
    writeFileSync(join(src, 'brand_new.lua'), 'x');
    assert.deepEqual(checkVendor(dir, src), [
      'extra.lua: not listed in VERSION.json',
      'brand_new.lua: exists in the plugin but is not vendored (run sync-plugin)',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});
