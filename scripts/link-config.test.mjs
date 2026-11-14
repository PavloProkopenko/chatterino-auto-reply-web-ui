import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('.', import.meta.url));

// A sandbox: <root>/app/Plugins/auto-reply (the plugin), a stubbed pgrep, and a target folder.
function setup({ running = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'link-'));
  const plugin = join(root, 'app', 'Plugins', 'auto-reply');
  mkdirSync(join(plugin, 'data'), { recursive: true });
  writeFileSync(join(plugin, 'info.json'), JSON.stringify({ name: 'Auto Reply', version: '1.0.0' }));
  writeFileSync(join(plugin, 'init.lua'), '-- init\n');
  writeFileSync(join(plugin, 'data', 'config.json'), '{"a":1}\n');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pgrep'), `#!/bin/sh\nexit ${running ? 0 : 1}\n`);
  chmodSync(join(bin, 'pgrep'), 0o755);
  const run = (script, ...args) =>
    spawnSync('bash', [join(scripts, script), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  return { root, plugin, target: join(root, 'ext'), run, backups: join(root, 'app', 'auto-reply-backups') };
}
const cleanup = (s) => rmSync(s.root, { recursive: true, force: true });

test('link: copies the plugin, links it, keeps the original OUTSIDE Plugins, writes the marker', () => {
  const s = setup();
  try {
    const r = s.run('link-config.sh', s.target, s.plugin);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(lstatSync(s.plugin).isSymbolicLink());
    assert.equal(readlinkSync(s.plugin), s.target);
    assert.equal(readFileSync(join(s.target, 'data', 'config.json'), 'utf8'), '{"a":1}\n');
    assert.equal(readFileSync(join(s.target, 'init.lua'), 'utf8'), '-- init\n');
    assert.ok(existsSync(join(s.target, 'data', '.external')));
    // the only thing inside Plugins is the link: a leftover copy would be loaded as a second plugin
    assert.deepEqual(readdirSync(join(s.root, 'app', 'Plugins')), ['auto-reply']);
    const [kept] = readdirSync(s.backups);
    assert.match(kept, /^auto-reply-\d{8}-\d{6}$/);
    assert.ok(existsSync(join(s.backups, kept, 'info.json')));
  } finally { cleanup(s); }
});

test('link: refuses while the app runs, when already linked, and for a non-empty foreign target', () => {
  const running = setup({ running: true });
  try {
    assert.notEqual(running.run('link-config.sh', running.target, running.plugin).status, 0);
    assert.ok(!lstatSync(running.plugin).isSymbolicLink());
  } finally { cleanup(running); }
  const s = setup();
  try {
    mkdirSync(s.target);
    writeFileSync(join(s.target, 'notes.txt'), 'mine');
    assert.notEqual(s.run('link-config.sh', s.target, s.plugin).status, 0);
    assert.ok(!lstatSync(s.plugin).isSymbolicLink());
    rmSync(join(s.target, 'notes.txt'));
    assert.equal(s.run('link-config.sh', s.target, s.plugin).status, 0);
    assert.notEqual(s.run('link-config.sh', join(s.root, 'other'), s.plugin).status, 0); // already a link
  } finally { cleanup(s); }
});

test('link: a target the site already installed keeps its code and receives the old config', () => {
  const s = setup();
  try {
    mkdirSync(s.target);
    writeFileSync(join(s.target, 'info.json'), JSON.stringify({ name: 'Auto Reply', version: '2.0.0' }));
    writeFileSync(join(s.target, 'init.lua'), '-- newer\n');
    assert.equal(s.run('link-config.sh', s.target, s.plugin).status, 0);
    assert.equal(readFileSync(join(s.target, 'init.lua'), 'utf8'), '-- newer\n');
    assert.equal(readFileSync(join(s.target, 'data', 'config.json'), 'utf8'), '{"a":1}\n');
  } finally { cleanup(s); }
});

test('link: an old data-only link is copied as real files', () => {
  const s = setup();
  try {
    const old = join(s.root, 'ar-data');
    mkdirSync(old);
    writeFileSync(join(old, 'config.json'), '{"fromLink":true}\n');
    rmSync(join(s.plugin, 'data'), { recursive: true });
    spawnSync('ln', ['-s', old, join(s.plugin, 'data')]);
    assert.equal(s.run('link-config.sh', s.target, s.plugin).status, 0);
    assert.ok(!lstatSync(join(s.target, 'data')).isSymbolicLink());
    assert.equal(readFileSync(join(s.target, 'data', 'config.json'), 'utf8'), '{"fromLink":true}\n');
  } finally { cleanup(s); }
});

test('unlink: restores the original folder and leaves the target alone', () => {
  const s = setup();
  try {
    assert.equal(s.run('link-config.sh', s.target, s.plugin).status, 0);
    writeFileSync(join(s.target, 'data', 'config.json'), '{"edited":true}\n');
    const r = s.run('unlink-config.sh', s.plugin);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!lstatSync(s.plugin).isSymbolicLink());
    assert.equal(readFileSync(join(s.plugin, 'data', 'config.json'), 'utf8'), '{"a":1}\n');
    assert.equal(readFileSync(join(s.target, 'data', 'config.json'), 'utf8'), '{"edited":true}\n');
    assert.notEqual(s.run('unlink-config.sh', s.plugin).status, 0); // not a link any more
  } finally { cleanup(s); }
});

test('unlink without a backup copies the files back (no marker, no .backup)', () => {
  const s = setup();
  try {
    assert.equal(s.run('link-config.sh', s.target, s.plugin).status, 0);
    rmSync(s.backups, { recursive: true });
    mkdirSync(join(s.target, '.backup'));
    assert.equal(s.run('unlink-config.sh', s.plugin).status, 0);
    assert.equal(readFileSync(join(s.plugin, 'init.lua'), 'utf8'), '-- init\n');
    assert.ok(!existsSync(join(s.plugin, 'data', '.external')));
    assert.ok(!existsSync(join(s.plugin, '.backup')));
  } finally { cleanup(s); }
});
