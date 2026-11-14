import { formatHash, parseHash, type Route } from './route.ts';

/** The current page, kept in the URL hash so the browser's Back button and a reload keep working. */
class Router {
  current = $state.raw<Route>(typeof location === 'undefined' ? { page: 'settings', view: 'list' } : parseHash(location.hash));

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('hashchange', () => (this.current = parseHash(location.hash)));
  }

  /** Go somewhere new: adds a history entry, so Back returns here. */
  go(route: Route): void {
    const hash = formatHash(route);
    if (location.hash === hash) this.current = route;
    else location.hash = hash; // fires hashchange
  }

  /** Swap the current entry (leaving an editor, or a page that no longer exists) without adding history. */
  replace(route: Route): void {
    history.replaceState(null, '', formatHash(route));
    this.current = route;
  }
}

export const router = new Router();
