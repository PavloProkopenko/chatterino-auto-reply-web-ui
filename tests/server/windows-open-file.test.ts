import { open, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createStore } from '../../src/server/store.ts';

// Phase 0 left "atomic replace while another process holds the file" UNVERIFIED on Windows. This runs in CI on
// windows-latest. Limit: Node always opens files with FILE_SHARE_DELETE, so it cannot imitate a program (like the
// Qt app) that opens config.json without delete sharing; that case is covered only by the retry/backoff tests.
describe.skipIf(process.platform !== 'win32')('saving while another handle has the file open (Windows)', () => {
  test('replace-by-rename succeeds with a reader holding the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'win-'));
    try {
      const file = join(dir, 'config.json');
      await writeFile(file, JSON.stringify({ version: 1, rules: {} }, null, 2) + '\n');
      const store = createStore();
      const l = await store.load(file);
      if (l.status !== 'ok') throw new Error('load failed');
      const held = await open(file, 'r');
      try {
        const cfg = structuredClone(l.config);
        cfg.per_user_cooldown = 5;
        const r = await store.save(file, l.snapshot.hash, cfg);
        expect(r.status).toBe('saved');
      } finally {
        await held.close();
      }
      expect(JSON.parse(await readFile(file, 'utf8')).per_user_cooldown).toBe(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
