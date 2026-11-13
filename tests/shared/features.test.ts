import { describe, expect, test } from 'vitest';
import { compareVersions, featuresFor, KNOWN_PLUGIN_VERSION } from '../../src/shared/features.ts';

describe('compareVersions', () => {
  test.each([
    ['0.5.0', '0.4.9', 1],
    ['0.2.1', '0.2.1', 0],
    ['0.10.0', '0.9.0', 1],
    ['1.0.0', '0.99.99', 1],
    ['0.3', '0.3.0', 0],
  ])('%s vs %s', (a, b, expected) => expect(Math.sign(compareVersions(a, b))).toBe(expected));
});

describe('featuresFor (CONTRACT section 5)', () => {
  test('0.5.0 has everything', () => {
    expect(featuresFor('0.5.0')).toMatchObject({ names: true, ruleChannels: true, timerConditions: true, skipUsers: true, newerThanKnown: false });
  });
  test('0.4.0 lacks skip_mods / skip_users', () => {
    expect(featuresFor('0.4.0')).toMatchObject({ names: true, ruleChannels: true, timerConditions: true, skipUsers: false });
  });
  test('0.2.0 lacks names and everything after', () => {
    expect(featuresFor('0.2.0')).toMatchObject({ names: false, ruleChannels: false, timerConditions: false, skipUsers: false });
  });
  test('a plugin newer than the UI knows is fully enabled but flagged', () => {
    expect(featuresFor('0.9.0')).toMatchObject({ skipUsers: true, newerThanKnown: true });
    expect(KNOWN_PLUGIN_VERSION).toBe('0.5.0');
  });
  test('an unknown version (no info.json) enables nothing optional and says so', () => {
    expect(featuresFor(null)).toMatchObject({ names: false, skipUsers: false, versionKnown: false });
  });
  test('garbage version strings count as unknown', () => {
    expect(featuresFor('weird')).toMatchObject({ versionKnown: false });
  });
});
