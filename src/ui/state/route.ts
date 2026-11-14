export type Page = 'rules' | 'timers' | 'redeems' | 'settings';
export type EditablePage = 'rules' | 'timers' | 'redeems';

export type Route = { page: Page; view: 'list' } | { page: EditablePage; view: 'edit'; id: number | null };

const EDITABLE: EditablePage[] = ['rules', 'timers', 'redeems'];
const isPage = (s: string): s is Page => s === 'settings' || (EDITABLE as string[]).includes(s);

/** `#/rules`, `#/rules/new`, `#/rules/3`. Anything unknown or malformed gives the nearest list, never an error. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter((p, i, a) => !(p === '' && i === a.length - 1));
  const [page, rest, ...more] = parts;
  if (!page || !isPage(page)) return { page: 'settings', view: 'list' };
  if (page === 'settings' || rest === undefined || more.length > 0) return { page, view: 'list' };
  if (rest === 'new') return { page, view: 'edit', id: null };
  if (/^\d+$/.test(rest)) {
    const id = Number(rest);
    if (Number.isSafeInteger(id)) return { page, view: 'edit', id };
  }
  return { page, view: 'list' };
}

export function formatHash(r: Route): string {
  if (r.view === 'list') return `#/${r.page}`;
  return `#/${r.page}/${r.id === null ? 'new' : r.id}`;
}
