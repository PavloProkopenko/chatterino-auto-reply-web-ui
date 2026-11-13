import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkVendor } from './sync-plugin.mjs';

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
