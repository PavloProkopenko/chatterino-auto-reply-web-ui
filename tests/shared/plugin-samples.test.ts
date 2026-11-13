import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normalise, parseDoc, render } from '../../src/shared/config.ts';

// Local cross-check with the plugin repo's private sample configs (gitignored there). Skipped when absent (CI).
// Nothing from these files is copied into this repo and no content is printed.
const dir = resolve(process.env.PLUGIN_REPO ?? '../auto-reply-plugin', 'auto-reply/tests/fixtures');
const samples = existsSync(dir) ? readdirSync(dir).filter((n) => /^config\..*\.json$/.test(n)) : [];

describe.skipIf(samples.length === 0)('plugin sample configs (PLUGIN_REPO)', () => {
  test.each(samples)('%s: parses, normalises and round-trips unchanged', (name) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const r = parseDoc(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cfg = normalise(r.doc.base);
    expect(Array.isArray(cfg.rules) && Array.isArray(cfg.channels)).toBe(true);
    // An unedited save must not change the file at all when its layout is what the detected style reproduces;
    // otherwise only the layout (never the content) may differ.
    const out = render(r.doc, cfg);
    if (r.doc.exact) expect(out).toBe(text);
    else expect(JSON.parse(out)).toEqual(JSON.parse(text));
  });
});
