import { describe, expect, test } from 'vitest';
import { defaultSection, isSectionDisabled, problemSection } from '../../src/ui/state/welcome.ts';

describe('welcome sections', () => {
  test('the linked folder opens first when the browser has direct access, otherwise the any-browser section', () => {
    expect(defaultSection(true)).toBe('direct');
    expect(defaultSection(false)).toBe('upload');
  });
  test('only the two direct-access sections are disabled without direct access', () => {
    for (const id of ['direct', 'install'] as const) {
      expect(isSectionDisabled(id, false)).toBe(true);
      expect(isSectionDisabled(id, true)).toBe(false);
    }
    for (const id of ['upload', 'demo'] as const) expect(isSectionDisabled(id, false)).toBe(false);
  });
  test('a pick problem is shown in the section the pick came from', () => {
    expect(problemSection('upload')).toBe('upload');
    expect(problemSection('direct')).toBe('direct');
    expect(problemSection(null)).toBe('direct');
  });
});
