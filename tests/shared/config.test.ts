import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { normalise, parseDoc, render, type Config } from '../../src/shared/config.ts';

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
const load = (name: string) => {
  const text = fixture(name);
  const r = parseDoc(text);
  if (!r.ok) throw new Error(r.error);
  return { text, doc: r.doc };
};
const edit = (config: Config, fn: (c: Config) => void): Config => {
  const copy = structuredClone(config);
  fn(copy);
  return copy;
};

describe('parseDoc', () => {
  test('rejects invalid JSON and non-objects without throwing', () => {
    expect(parseDoc('{nope').ok).toBe(false);
    expect(parseDoc('[1,2]').ok).toBe(false);
    expect(parseDoc('"x"').ok).toBe(false);
  });
  test('an empty file is treated as a missing config, not as an error', () => {
    const r = parseDoc('');
    expect(r.ok).toBe(true);
  });
});

describe('normalise', () => {
  const { doc } = load('legacy.json');
  const cfg = normalise(doc.base);

  test('{} lists become arrays', () => {
    expect(cfg.channels).toEqual([]);
    expect(cfg.ignore_users).toEqual([]);
    expect(cfg.rules[0]!.channels).toEqual([]);
  });
  test('legacy rule type/match becomes one condition and the legacy keys disappear', () => {
    expect(cfg.rules[0]!.conditions).toEqual([{ type: 'keyword', match: 'донат' }]);
    expect('type' in cfg.rules[0]!).toBe(false);
    expect('match' in cfg.rules[0]!).toBe(false);
  });
  test('legacy timer trigger becomes a whole-word condition', () => {
    expect(cfg.timers[0]!.conditions).toEqual([{ type: 'word', match: 'играет' }]);
    expect('trigger' in cfg.timers[0]!).toBe(false);
  });
  test('unknown keys survive, at the top level and inside items', () => {
    expect(cfg.future_setting).toEqual({ nested: [1, 2, 3], empty: {} });
    expect(cfg.rules[1]!.unknown_rule_key).toBe(7);
  });
  test('missing settings get the plugin defaults', () => {
    const c = normalise({});
    expect(c.per_user_cooldown).toBe(60);
    expect(c.backfire).toBe(true);
    expect(c.next_rule_id).toBe(1);
    expect(c.rules).toEqual([]);
  });
});

describe('render', () => {
  test.each(['legacy.json', 'compact.json', 'tabs-crlf.json'])('no edits => %s is byte-stable', (name) => {
    const { text, doc } = load(name);
    expect(render(doc, normalise(doc.base))).toBe(text);
  });

  test('editing one rule changes only that rule; the legacy rule keeps its shape if untouched', () => {
    const { text, doc } = load('legacy.json');
    const out = render(doc, edit(normalise(doc.base), (c) => (c.rules[1]!.reply = 'Новый ответ')));
    expect(out).toBe(text.replace('Плейлист в описании', 'Новый ответ'));
  });

  test('editing a legacy rule rewrites that item in the new shape and keeps its other fields', () => {
    const { doc } = load('legacy.json');
    const out = JSON.parse(render(doc, edit(normalise(doc.base), (c) => (c.rules[0]!.reply = 'Другой')))) as { rules: Record<string, unknown>[] };
    expect(out.rules[0]).toEqual({ id: 1, enabled: true, reply: 'Другой', channels: {}, conditions: [{ type: 'keyword', match: 'донат' }] });
    expect(out.rules[1]).toEqual(JSON.parse(fixture('legacy.json')).rules[1]);
  });

  test('a list that becomes empty is written as {} (the plugin serializer quirk), never []', () => {
    const { doc } = load('compact.json');
    const out = render(doc, edit(normalise(doc.base), (c) => (c.channels = [])));
    expect(out).toBe('{"version":1,"channels":{},"ignore_users":{},"rules":{},"next_rule_id":1,"timers":{},"redeems":{}}');
  });

  test('an untouched empty list stays exactly as the file had it', () => {
    const text = '{"version":1,"channels":[],"ignore_users":{}}';
    const r = parseDoc(text);
    if (!r.ok) throw new Error(r.error);
    expect(render(r.doc, normalise(r.doc.base))).toBe(text);
  });

  test('defaults are not written into a file that did not have them', () => {
    const { doc } = load('compact.json');
    const out = JSON.parse(render(doc, normalise(doc.base))) as Record<string, unknown>;
    expect('per_user_cooldown' in out).toBe(false);
  });

  test('a changed default-valued setting is written', () => {
    const { doc } = load('compact.json');
    const out = JSON.parse(render(doc, edit(normalise(doc.base), (c) => (c.per_user_cooldown = 5)))) as Record<string, unknown>;
    expect(out.per_user_cooldown).toBe(5);
  });

  test('adding a rule keeps the existing items byte-identical and uses the file style', () => {
    const { text, doc } = load('legacy.json');
    const out = render(
      doc,
      edit(normalise(doc.base), (c) => {
        c.rules.push({ id: 4, enabled: true, reply: 'ok', channels: [], conditions: [{ type: 'word', match: 'x' }] });
        c.next_rule_id = 5;
      }),
    );
    expect(out.endsWith('\n')).toBe(true);
    const o = JSON.parse(out) as { rules: unknown[]; next_rule_id: number };
    expect(o.rules).toHaveLength(3);
    expect(o.next_rule_id).toBe(5);
    expect(out).toContain('"channels": {}'); // new rule's empty channels written as {}
    expect(text.includes('"next_rule_id": 4')).toBe(true);
  });

  test('removing a key that the edit no longer has removes it (explicit delete)', () => {
    const { doc } = load('legacy.json');
    const out = JSON.parse(render(doc, edit(normalise(doc.base), (c) => delete c.active_until))) as Record<string, unknown>;
    expect('active_until' in out).toBe(false);
  });

  test('CRLF and tabs are kept when an edit is saved', () => {
    const { doc } = load('tabs-crlf.json');
    const out = render(doc, edit(normalise(doc.base), (c) => (c.per_user_cooldown = 30)));
    expect(out).toContain('\r\n\t"');
    expect(out.endsWith('\r\n')).toBe(true);
  });
});
