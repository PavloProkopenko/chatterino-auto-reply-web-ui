import { describe, expect, test } from 'vitest';
import { normalise, type Config, type Rule } from '../../src/shared/config.ts';
import { deleteRules, emptyRule, moveRule, moveRuleTo, moveToEdge, nameCandidates, saveRule, setRulesEnabled } from '../../src/ui/state/rules.ts';
import { fixtureText } from './fakes.ts';

const cfg = (): Config => normalise(JSON.parse(fixtureText()));
const ids = (c: Config) => c.rules.map((r) => r.id);
const rule = (id: number): Rule => ({ id, enabled: true, reply: `r${id}`, channels: [], conditions: [{ type: 'word', match: `w${id}` }] });
const many = (n: number): Config => ({ ...cfg(), rules: Array.from({ length: n }, (_, i) => rule(i + 1)), next_rule_id: n + 1 });

describe('saveRule', () => {
  test('a new rule gets next_rule_id, which then goes up', () => {
    const c = cfg();
    const id = saveRule(c, { ...emptyRule(), reply: 'привет', conditions: [{ type: 'word', match: 'hi' }] });
    expect(id).toBe(3);
    expect(c.next_rule_id).toBe(4);
    expect(ids(c)).toEqual([1, 2, 3]);
  });

  test('ids are never reused, also after a delete', () => {
    const c = cfg();
    deleteRules(c, [2]);
    expect(saveRule(c, { ...emptyRule(), reply: 'x' })).toBe(3);
    deleteRules(c, [3]);
    expect(saveRule(c, { ...emptyRule(), reply: 'y' })).toBe(4);
  });

  test('editing keeps the position, the id and keys the app does not know', () => {
    const c = cfg();
    (c.rules[0] as Rule).future_field = { keep: true };
    saveRule(c, { ...(c.rules[0] as Rule), reply: 'новый ответ' });
    expect(ids(c)).toEqual([1, 2]);
    expect(c.rules[0]).toMatchObject({ id: 1, reply: 'новый ответ', future_field: { keep: true } });
  });

  test('an optional key that the edit removes is removed', () => {
    const c = cfg();
    (c.rules[0] as Rule).name = 'старое';
    (c.rules[0] as Rule).skip_users = ['bot'];
    const rest: Rule = { ...(c.rules[0] as Rule) };
    delete rest.name;
    delete rest.skip_users;
    saveRule(c, rest);
    expect(c.rules[0]).not.toHaveProperty('name');
    expect(c.rules[0]).not.toHaveProperty('skip_users');
  });

  test('the counter is repaired when it was behind the ids', () => {
    const c = cfg();
    c.next_rule_id = 1;
    expect(saveRule(c, emptyRule())).toBe(3);
  });
});

describe('deleteRules', () => {
  test('removes only the chosen rules and leaves the counter alone', () => {
    const c = many(5);
    expect(deleteRules(c, [2, 4, 99])).toBe(2);
    expect(ids(c)).toEqual([1, 3, 5]);
    expect(c.next_rule_id).toBe(6);
  });
});

describe('moving', () => {
  test('one step up or down, clamped at the ends', () => {
    const c = many(3);
    moveRule(c, 3, -1);
    expect(ids(c)).toEqual([1, 3, 2]);
    moveRule(c, 1, -1);
    expect(ids(c)).toEqual([1, 3, 2]);
    moveRule(c, 2, 1);
    expect(ids(c)).toEqual([1, 3, 2]);
  });

  test('selected rules go to the top or bottom and keep their relative order', () => {
    const c = many(6);
    moveToEdge(c, [5, 2], 'top');
    expect(ids(c)).toEqual([2, 5, 1, 3, 4, 6]);
    moveToEdge(c, [2, 1], 'bottom');
    expect(ids(c)).toEqual([5, 3, 4, 6, 2, 1]);
  });
});

describe('moveRuleTo (drag and drop)', () => {
  test('dropping on a lower row puts the rule after it; on a higher row, before it', () => {
    const c = many(5);
    moveRuleTo(c, 1, 3);
    expect(ids(c)).toEqual([2, 3, 1, 4, 5]);
    moveRuleTo(c, 5, 2);
    expect(ids(c)).toEqual([5, 2, 3, 1, 4]);
  });
  test('dropping on itself or on an unknown id changes nothing', () => {
    const c = many(3);
    moveRuleTo(c, 2, 2);
    moveRuleTo(c, 2, 99);
    moveRuleTo(c, 99, 1);
    expect(ids(c)).toEqual([1, 2, 3]);
  });
});

describe('setRulesEnabled', () => {
  test('switches several rules and nothing else', () => {
    const c = many(3);
    setRulesEnabled(c, [1, 3], false);
    expect(c.rules.map((r) => r.enabled)).toEqual([false, true, false]);
    setRulesEnabled(c, [1], true);
    expect(c.rules.map((r) => r.enabled)).toEqual([true, true, false]);
  });
});

describe('nameCandidates', () => {
  test('proposes short names built from the reply, in the plugin\'s allowed alphabet', () => {
    const c = nameCandidates('Привет, {user}! Добро пожаловать на стрим');
    expect(c[0]).toBe('Привет');
    for (const n of c) {
      expect([...n].length).toBeLessThanOrEqual(20);
      expect(n).toMatch(/^[\p{L}\p{N}_-]+$/u);
      expect(n).toMatch(/\p{L}/u);
    }
  });
  test('nothing usable in the reply: no candidates', () => {
    expect(nameCandidates('123 456 !!!')).toEqual([]);
    expect(nameCandidates('')).toEqual([]);
  });
  test('a long first word is cut to 20 characters', () => {
    expect(nameCandidates('Достопримечательностьдостопримечательность')[0]).toHaveLength(20);
  });
});
