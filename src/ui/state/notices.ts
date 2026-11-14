// Which notices the session has right now, apart from the success banner. One source for the popup's list,
// the icon's count and colour, and the "a new error opens the popup" rule. Pure: no Svelte, no DOM.

export type NoticeLevel = 'error' | 'warn' | 'info';
export type NoticeKey =
  | 'writeFailed'
  | 'staleBase'
  | 'error'
  | 'external'
  | 'versionNeedsInfo'
  | 'versionUnknown'
  | 'versionNewer'
  | 'demo'
  | 'download'
  | 'notPersistent'
  | 'reformat';

export interface Notice {
  key: NoticeKey;
  /** Same as `key`, except an error carries its text: a different error is a new one. */
  id: string;
  level: NoticeLevel;
}

export interface NoticeInput {
  source: { kind: string; canSaveInPlace: boolean; features: { versionKnown: boolean; newerThanKnown: boolean } } | null;
  persistent: boolean;
  writeFailed: unknown;
  staleBase: boolean;
  error: string | null;
  externalChange: boolean;
  exact: boolean;
}

const RANK: Record<NoticeLevel, number> = { error: 0, warn: 1, info: 2 };

export function collectNotices(i: NoticeInput): Notice[] {
  const out: Notice[] = [];
  const add = (key: NoticeKey, level: NoticeLevel, id: string = key) => out.push({ key, id, level });
  const s = i.source;
  if (i.writeFailed) add('writeFailed', 'error');
  if (s?.kind === 'demo') add('demo', 'info');
  else if (s && !s.canSaveInPlace) add('download', 'info');
  if (s && s.canSaveInPlace && !i.persistent) add('notPersistent', 'info');
  if (i.staleBase) add('staleBase', 'error');
  if (i.error) add('error', 'error', `error:${i.error}`);
  if (i.externalChange) add('external', 'info');
  if (s && !s.features.versionKnown) add(s.kind === 'upload' ? 'versionNeedsInfo' : 'versionUnknown', 'warn');
  else if (s?.features.newerThanKnown) add('versionNewer', 'info');
  if (!i.exact) add('reformat', 'info');
  // errors first; Array.prototype.sort is stable, so the order inside a level stays as above
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** Ids of error notices that were not in `previous`: these open the popup by themselves, once. */
export function newErrorIds(previous: ReadonlySet<string>, now: Notice[]): string[] {
  return now.filter((n) => n.level === 'error' && !previous.has(n.id)).map((n) => n.id);
}
