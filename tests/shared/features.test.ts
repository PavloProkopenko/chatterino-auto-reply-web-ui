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
  test('auto reload exists since 0.7.0', () => {
    expect(featuresFor('0.6.1').autoReload).toBe(false);
    expect(featuresFor('0.7.0').autoReload).toBe(true);
    expect(featuresFor(null).autoReload).toBe(false);
  });
  test('0.4.0 lacks skip_mods / skip_users', () => {
    expect(featuresFor('0.4.0')).toMatchObject({ names: true, ruleChannels: true, timerConditions: true, skipUsers: false });
  });
  test('0.2.0 lacks names and everything after', () => {
    expect(featuresFor('0.2.0')).toMatchObject({ names: false, ruleChannels: false, timerConditions: false, skipUsers: false });
  });
  test('a plugin newer than the UI knows is fully enabled but flagged', () => {
    expect(featuresFor('1.0.0')).toMatchObject({ skipUsers: true, newerThanKnown: true });
    expect(KNOWN_PLUGIN_VERSION).toBe('0.10.0');
  });
  test('the "known" version can be the bundled one: the installed plugin is not flagged as newer than the bundle it equals', () => {
    expect(featuresFor('0.8.2', '0.8.2').newerThanKnown).toBe(false);
    expect(featuresFor('0.8.3', '0.8.2').newerThanKnown).toBe(true);
    expect(featuresFor('0.8.1', '0.8.2').newerThanKnown).toBe(false);
  });
  test('the plugin notices a web login while running since 0.8.2', () => {
    expect(featuresFor('0.8.1').helixSync).toBe(false);
    expect(featuresFor('0.8.2').helixSync).toBe(true);
    expect(featuresFor(null).helixSync).toBe(false);
  });
  test('the noword condition type exists since 0.10.0', () => {
    expect(featuresFor('0.9.0').noword).toBe(false);
    expect(featuresFor('0.10.0').noword).toBe(true);
    expect(featuresFor(null).noword).toBe(false);
  });
  test('mute exceptions (unprotect_users) exist since 0.9.0', () => {
    expect(featuresFor('0.8.3').protectOverride).toBe(false);
    expect(featuresFor('0.9.0').protectOverride).toBe(true);
    expect(featuresFor(null).protectOverride).toBe(false);
  });
  test('the Twitch API exists since 0.8.0', () => {
    expect(featuresFor('0.7.2').helix).toBe(false);
    expect(featuresFor('0.8.0').helix).toBe(true);
    expect(featuresFor(null).helix).toBe(false);
  });
  test('an unknown version (no info.json) enables nothing optional and says so', () => {
    expect(featuresFor(null)).toMatchObject({ names: false, skipUsers: false, versionKnown: false });
  });
  test('garbage version strings count as unknown', () => {
    expect(featuresFor('weird')).toMatchObject({ versionKnown: false });
  });
});
