import { DEV, expect, test } from './harness.ts';

// The real browser layer (handles, permissions, IndexedDB) exercised in Chromium. The page imports the actual source
// modules from the Vite dev server; the browser's private file system (OPFS) stands in for a user's folder because it
// has the same handle API and, unlike a native dialog, can be driven by a test.
const sample = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, channels: ['a'], ...extra }, null, 2) + '\n';

test('folder access: plugin info, reading, atomic replace, creating the file, no stray files', async ({ page }) => {
  {
    await page.goto(DEV + '/');
    const r = await page.evaluate(async (cfg) => {
      const fs = await import('/data/fs-access.ts');
      const root = await navigator.storage.getDirectory();
      const plugin = await root.getDirectoryHandle('plugin-a', { create: true });
      const w = await (await plugin.getFileHandle('info.json', { create: true })).createWritable();
      await w.write(JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
      await w.close();
      const access = fs.folderConfigAccess(plugin);
      const out: Record<string, unknown> = {};
      out.info = await fs.readPluginInfo(plugin);
      out.missingRead = await access.read(); // no data/ folder yet: missing, not an error
      out.missingStat = await access.stat();
      await access.write(cfg); // creates data/ and config.json
      const read = await access.read();
      out.readBack = read?.text === cfg;
      out.stat = await access.stat();
      await access.write(cfg.replace('"a"', '"b"'));
      out.replaced = (await access.read())?.text.includes('"b"');
      const data = await plugin.getDirectoryHandle('data');
      const names: string[] = [];
      for await (const [name] of (data as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) names.push(name);
      out.names = names;
      out.permission = await fs.permissionOf(plugin, true);
      await root.removeEntry('plugin-a', { recursive: true });
      return out;
    }, sample());
    expect(r.info).toEqual({ name: 'Auto Reply', version: '0.5.0' });
    expect(r.missingRead).toBeNull();
    expect(r.missingStat).toBeNull();
    expect(r.readBack).toBe(true);
    expect(r.stat).toMatchObject({ size: sample().length });
    expect(r.replaced).toBe(true);
    expect(r.names).toEqual(['config.json']); // no .crswap or temp leftovers
    expect(r.permission).toBe('granted');
  }
});

test('errors are mapped: busy file, refused permission, blocked folder, cancelled dialog', async ({ page }) => {
  {
    await page.goto(DEV + '/');
    const r = await page.evaluate(async () => {
      const fs = await import('/data/fs-access.ts');
      const ports = await import('/data/ports.ts');
      const out: Record<string, unknown> = {};
      const failing = (name: string) =>
        fs.handleFileAccess(async () => ({
          getFile: async () => { throw new DOMException('no', name); },
          createWritable: async () => { throw new DOMException('no', name); },
        }) as unknown as FileSystemFileHandle);
      for (const [name, key] of [['NoModificationAllowedError', 'busy'], ['InvalidStateError', 'busy'], ['NotAllowedError', 'permission'], ['QuotaExceededError', 'other']] as const) {
        try { await failing(name).write('x'); out[name] = 'no error'; } catch (e) { out[name] = e instanceof ports.FileWriteError ? e.reason : String(e); }
        void key;
      }
      try { await failing('NotAllowedError').read(); out.read = 'no error'; } catch (e) { out.read = (e as Error).name; }
      const picker = (err: Error | null) => ({ showDirectoryPicker: async () => { if (err) throw err; return {}; }, showOpenFilePicker: async () => [] }) as never;
      out.cancel = await fs.pickFolder(picker(new DOMException('The user aborted a request.', 'AbortError')));
      try { await fs.pickFolder(picker(new DOMException('Contains system files', 'SecurityError'))); out.blocked = 'no error'; } catch (e) { out.blocked = (e as Error).name; }
      try { await fs.pickFolder(picker(new DOMException('Can’t open this folder because it contains system files.', 'AbortError'))); out.blockedAbort = 'no error'; } catch (e) { out.blockedAbort = (e as Error).name; }
      out.supported = fs.directAccessSupported();
      out.unsupported = fs.directAccessSupported({} as never);
      return out;
    });
    expect(r).toMatchObject({
      NoModificationAllowedError: 'busy', InvalidStateError: 'busy', NotAllowedError: 'permission', QuotaExceededError: 'other',
      read: 'PermissionNeededError', cancel: null, blocked: 'BlockedPickError', blockedAbort: 'BlockedPickError', supported: true, unsupported: false,
    });
  }
});

test('persistence: the chosen folder and its backups survive a reload; forgetting wipes both', async ({ page }) => {
  {
    await page.goto(DEV + '/');
    await page.evaluate(async (cfg) => {
      const fs = await import('/data/fs-access.ts');
      const persistence = await import('/data/persistence.ts');
      const root = await navigator.storage.getDirectory();
      const plugin = await root.getDirectoryHandle('plugin-b', { create: true });
      // a valid plugin folder, so the app (which reopens the remembered folder on reload) accepts it
      const info = await (await plugin.getFileHandle('info.json', { create: true })).createWritable();
      await info.write(JSON.stringify({ name: 'Auto Reply', version: '0.5.0' }));
      await info.close();
      await fs.folderConfigAccess(plugin).write(cfg);
      const p = await persistence.openPersistence();
      await p.forget();
      await p.saveSource({ id: 'src-1', kind: 'folder', handle: plugin, name: plugin.name });
      const backups = p.backups('src-1');
      for (let i = 0; i < 3; i++) await backups.add(`text ${i}`, 1000 + i);
      await p.backups('other-source').add('not mine', 5);
    }, sample());

    await page.reload();
    const r = await page.evaluate(async () => {
      const fs = await import('/data/fs-access.ts');
      const persistence = await import('/data/persistence.ts');
      const store = await import('/data/store.ts');
      const p = await persistence.openPersistence();
      const src = await p.loadSource();
      const out: Record<string, unknown> = { persistent: p.persistent, kind: src?.kind, name: src?.name, id: src?.id };
      out.permission = src ? await fs.permissionOf(src.handle, false) : null;
      const backups = p.backups('src-1');
      out.listed = (await backups.list()).map((b) => b.id.slice(-4)); // newest first
      await backups.prune(2);
      out.afterPrune = (await backups.list()).length;
      out.otherUntouched = (await p.backups('other-source').list()).length;
      // the full store over real handles and real IndexedDB
      const file = fs.folderConfigAccess(src!.handle as FileSystemDirectoryHandle);
      const s = store.createConfigStore({ file, backups: p.backups('src-1') });
      const loaded = await s.load();
      if (loaded.status !== 'ok') throw new Error('load ' + loaded.status);
      const edited = structuredClone(loaded.config);
      edited.per_user_cooldown = 33;
      const saved = await s.save(loaded.snapshot.hash, edited);
      out.saved = saved.status;
      out.after = JSON.parse((await file.read())!.text).per_user_cooldown;
      out.backupMade = (await s.listBackups()).length;
      await p.forget();
      out.afterForget = { source: await p.loadSource(), backups: (await p.backups('src-1').list()).length, other: (await p.backups('other-source').list()).length };
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('plugin-b', { recursive: true });
      return out;
    });
    expect(r).toMatchObject({ persistent: true, kind: 'folder', name: 'plugin-b', id: 'src-1', permission: 'granted', afterPrune: 2, otherUntouched: 1, saved: 'saved', after: 33 });
    expect(r.listed).toEqual(['0002', '0001', '0000'].map((_, i) => (r.listed as string[])[i]));
    expect((r.listed as string[]).length).toBe(3);
    expect(r.backupMade).toBeGreaterThanOrEqual(1);
    expect(r.afterForget).toEqual({ source: null, backups: 0, other: 1 });
  }
});
