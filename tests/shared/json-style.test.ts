import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { detectStyle, formatJson } from '../../src/shared/json-style.ts';

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

describe('detectStyle', () => {
  test('2-space pretty, LF, trailing newline', () => {
    expect(detectStyle(fixture('legacy.json'))).toEqual({ indent: 2, eol: '\n', trailingNewline: true });
  });
  test('compact without trailing newline', () => {
    expect(detectStyle(fixture('compact.json'))).toEqual({ indent: 0, eol: '\n', trailingNewline: false });
  });
  test('tabs and CRLF', () => {
    expect(detectStyle(fixture('tabs-crlf.json'))).toEqual({ indent: '\t', eol: '\r\n', trailingNewline: true });
  });
  test('defaults for an empty or unknown text: 2-space pretty with trailing newline', () => {
    expect(detectStyle('')).toEqual({ indent: 2, eol: '\n', trailingNewline: true });
  });
});

describe('formatJson re-emits the detected style', () => {
  test.each(['legacy.json', 'compact.json', 'tabs-crlf.json'])('%s is byte-stable', (name) => {
    const text = fixture(name);
    expect(formatJson(JSON.parse(text), detectStyle(text))).toBe(text);
  });
});
