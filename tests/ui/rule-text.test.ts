import { describe, expect, test } from 'vitest';
import type { Rule } from '../../src/shared/config.ts';
import { featuresFor } from '../../src/shared/features.ts';
import { describeCondition, describeConditions, gatingProblems, missingChannels, replyStart, ruleLabel } from '../../src/ui/state/rule-text.ts';

const rule = (more: Partial<Rule> = {}): Rule => ({ id: 7, enabled: true, reply: 'Привет', channels: [], conditions: [{ type: 'word', match: 'привет' }], ...more });

describe('describing conditions in plain Russian', () => {
  test('each type reads naturally', () => {
    expect(describeCondition({ type: 'word', match: 'привет' })).toBe('слово «привет»');
    expect(describeCondition({ type: 'keyword', match: '!дс' })).toBe('содержит «!дс»');
    expect(describeCondition({ type: 'anyword', match: '!донат|!donate' })).toBe('любое из: !донат, !donate');
    expect(describeCondition({ type: 'noword', match: 'лет|ей|ему' })).toBe('без слов: лет, ей, ему');
    expect(describeCondition({ type: 'mention' })).toBe('упоминает вас');
    expect(describeCondition({ type: 'flag', match: 'first' })).toBe('первое сообщение зрителя');
    expect(describeCondition({ type: 'pattern', match: '^!%a+$' })).toBe('шаблон «^!%a+$»');
  });
  test('an empty or unknown condition is still shown', () => {
    expect(describeCondition({ type: 'word', match: '' })).toContain('не заполнено');
    expect(describeCondition({ type: 'strange', match: 'x' })).toContain('strange');
  });
  test('several conditions are joined with "и"', () => {
    expect(describeConditions(rule({ conditions: [{ type: 'word', match: 'a' }, { type: 'flag', match: 'sub' }] }))).toBe('слово «a» и подписка');
  });
});

describe('labels', () => {
  test('the name when there is one, else the id', () => {
    expect(ruleLabel(rule({ name: 'greet' }))).toBe('greet');
    expect(ruleLabel(rule())).toBe('#7');
  });
  test('the start of a reply is cut on a space with an ellipsis', () => {
    expect(replyStart('короткий')).toBe('короткий');
    const cut = replyStart('слово '.repeat(30), 20);
    expect(cut.endsWith('…')).toBe(true);
    expect([...cut].length).toBeLessThanOrEqual(21);
  });
});

describe('channels that are not in the global list', () => {
  test('none missing, some missing, all missing; case does not matter; a global rule has none', () => {
    expect(missingChannels(rule(), ['a'])).toEqual({ missing: [], all: false });
    expect(missingChannels(rule({ channels: ['A'] }), ['a'])).toEqual({ missing: [], all: false });
    expect(missingChannels(rule({ channels: ['a', 'b'] }), ['a'])).toEqual({ missing: ['b'], all: false });
    expect(missingChannels(rule({ channels: ['b', 'c'] }), ['a'])).toEqual({ missing: ['b', 'c'], all: true });
    expect(missingChannels(rule({ channels: ['b'] }), [])).toEqual({ missing: ['b'], all: true });
  });
});

describe('version gating', () => {
  test('a plain rule needs nothing', () => {
    expect(gatingProblems(rule(), featuresFor(null))).toEqual([]);
  });
  test('names, channel scope and skip options need the plugin versions from the contract', () => {
    const r = rule({ name: 'x', channels: ['a'], skip_mods: true });
    expect(gatingProblems(r, featuresFor('0.2.0')).length).toBe(3);
    expect(gatingProblems(r, featuresFor('0.2.1')).length).toBe(2);
    expect(gatingProblems(r, featuresFor('0.3.0')).length).toBe(1);
    expect(gatingProblems(r, featuresFor('0.5.0'))).toEqual([]);
  });
  test('an unknown version flags every gated feature in use, with its own wording', () => {
    const known = gatingProblems(rule({ name: 'x' }), featuresFor('0.1.0'));
    const unknown = gatingProblems(rule({ name: 'x' }), featuresFor(null));
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).not.toBe(known[0]);
  });
});
