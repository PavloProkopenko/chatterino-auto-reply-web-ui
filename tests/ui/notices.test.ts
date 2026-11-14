import { describe, expect, test } from 'vitest';
import { collectNotices, newErrorIds, type NoticeInput } from '../../src/ui/state/notices.ts';

const base = (over: Partial<NoticeInput> = {}): NoticeInput => ({
  source: { kind: 'folder', canSaveInPlace: true, features: { versionKnown: true, newerThanKnown: false } },
  persistent: true,
  writeFailed: false,
  staleBase: false,
  error: null,
  externalChange: false,
  exact: true,
  ...over,
});
const keys = (i: NoticeInput) => collectNotices(i).map((n) => n.key);

describe('collectNotices', () => {
  test('a healthy folder session has no notices', () => {
    expect(collectNotices(base())).toEqual([]);
    expect(collectNotices(base({ source: null }))).toEqual([]);
  });
  test('modes: demo and download are info; a private window is info', () => {
    expect(collectNotices(base({ source: { kind: 'demo', canSaveInPlace: false, features: { versionKnown: true, newerThanKnown: false } } }))).toEqual([{ key: 'demo', id: 'demo', level: 'info' }]);
    expect(keys(base({ source: { kind: 'upload', canSaveInPlace: false, features: { versionKnown: true, newerThanKnown: false } } }))).toEqual(['download']);
    expect(keys(base({ persistent: false }))).toEqual(['notPersistent']);
  });
  test('a private window is only a notice when saving in place (as the banner was)', () => {
    expect(keys(base({ persistent: false, source: { kind: 'upload', canSaveInPlace: false, features: { versionKnown: true, newerThanKnown: false } } }))).toEqual(['download']);
  });
  test('version notices: needs info (upload) / unknown / newer', () => {
    const f = (versionKnown: boolean, newerThanKnown: boolean, kind = 'folder', canSaveInPlace = true) => base({ source: { kind, canSaveInPlace, features: { versionKnown, newerThanKnown } } });
    expect(collectNotices(f(false, false, 'upload', true))).toEqual([{ key: 'versionNeedsInfo', id: 'versionNeedsInfo', level: 'warn' }]);
    expect(collectNotices(f(false, false))).toEqual([{ key: 'versionUnknown', id: 'versionUnknown', level: 'warn' }]);
    expect(collectNotices(f(true, true))).toEqual([{ key: 'versionNewer', id: 'versionNewer', level: 'info' }]);
  });
  test('errors come first, then warnings, then info; the order inside a level is stable', () => {
    const all = base({
      writeFailed: true, staleBase: true, error: 'boom', externalChange: true, exact: false, persistent: false,
      source: { kind: 'folder', canSaveInPlace: true, features: { versionKnown: false, newerThanKnown: false } },
    });
    expect(collectNotices(all).map((n) => n.level)).toEqual(['error', 'error', 'error', 'warn', 'info', 'info', 'info']);
    expect(keys(all)).toEqual(['writeFailed', 'staleBase', 'error', 'versionUnknown', 'notPersistent', 'external', 'reformat']);
  });
  test('an error notice is identified by its text, so a different error counts as new', () => {
    expect(collectNotices(base({ error: 'a' }))[0]?.id).toBe('error:a');
    expect(collectNotices(base({ error: 'b' }))[0]?.id).toBe('error:b');
  });
});

describe('newErrorIds', () => {
  test('only errors that were not there before open the popup', () => {
    const n1 = collectNotices(base({ writeFailed: true }));
    expect(newErrorIds(new Set(), n1)).toEqual(['writeFailed']);
    expect(newErrorIds(new Set(['writeFailed']), n1)).toEqual([]);
    const n2 = collectNotices(base({ writeFailed: true, externalChange: true }));
    expect(newErrorIds(new Set(['writeFailed']), n2)).toEqual([]); // a new info notice does not open it
    expect(newErrorIds(new Set(), collectNotices(base({ persistent: false })))).toEqual([]);
  });
});
