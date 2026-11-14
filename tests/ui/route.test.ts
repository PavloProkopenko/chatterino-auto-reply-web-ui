import { describe, expect, test } from 'vitest';
import { formatHash, parseHash, type Route } from '../../src/ui/state/route.ts';

describe('parseHash', () => {
  test('the list pages and settings', () => {
    expect(parseHash('#/rules')).toEqual({ page: 'rules', view: 'list' });
    expect(parseHash('#/timers')).toEqual({ page: 'timers', view: 'list' });
    expect(parseHash('#/redeems')).toEqual({ page: 'redeems', view: 'list' });
    expect(parseHash('#/settings')).toEqual({ page: 'settings', view: 'list' });
  });
  test('editor pages: new and by id', () => {
    expect(parseHash('#/rules/new')).toEqual({ page: 'rules', view: 'edit', id: null });
    expect(parseHash('#/timers/7')).toEqual({ page: 'timers', view: 'edit', id: 7 });
    expect(parseHash('#/redeems/12')).toEqual({ page: 'redeems', view: 'edit', id: 12 });
  });
  test('empty, unknown and malformed hashes fall back instead of failing', () => {
    expect(parseHash('')).toEqual({ page: 'settings', view: 'list' });
    expect(parseHash('#')).toEqual({ page: 'settings', view: 'list' });
    expect(parseHash('#/nope')).toEqual({ page: 'settings', view: 'list' });
    expect(parseHash('#/rules/abc')).toEqual({ page: 'rules', view: 'list' });
    expect(parseHash('#/rules/-3')).toEqual({ page: 'rules', view: 'list' });
    expect(parseHash('#/rules/1.5')).toEqual({ page: 'rules', view: 'list' });
    expect(parseHash('#/rules/1/extra')).toEqual({ page: 'rules', view: 'list' });
    expect(parseHash('#/settings/new')).toEqual({ page: 'settings', view: 'list' });
    expect(parseHash('#/rules/99999999999999999999')).toEqual({ page: 'rules', view: 'list' });
  });
});

describe('formatHash', () => {
  test('round trip', () => {
    const routes: Route[] = [
      { page: 'rules', view: 'list' },
      { page: 'settings', view: 'list' },
      { page: 'rules', view: 'edit', id: null },
      { page: 'timers', view: 'edit', id: 3 },
      { page: 'redeems', view: 'edit', id: 41 },
    ];
    for (const r of routes) expect(parseHash(formatHash(r))).toEqual(r);
  });
  test('the written form', () => {
    expect(formatHash({ page: 'rules', view: 'edit', id: null })).toBe('#/rules/new');
    expect(formatHash({ page: 'timers', view: 'edit', id: 3 })).toBe('#/timers/3');
    expect(formatHash({ page: 'settings', view: 'list' })).toBe('#/settings');
  });
});
