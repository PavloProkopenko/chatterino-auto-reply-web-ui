export interface LifecycleOptions {
  onExit: () => void;
  /** Exit if no browser tab connects within this time after start. */
  firstTabMs?: number;
  /** Exit this long after the last tab has gone. */
  byeGraceMs?: number;
  /** A tab that sends nothing for this long is considered gone (crash, sleep, background throttling is far shorter). */
  silenceMs?: number;
}

/**
 * Decides when the app should exit by itself. Each open tab has its own id and sends heartbeats; closing a tab
 * sends a `bye`. The app exits when the last tab is gone for `byeGraceMs`, so a page reload (bye, then a new tab)
 * and a throttled background tab never end it.
 */
export function createLifecycle(opts: LifecycleOptions) {
  const firstTabMs = opts.firstTabMs ?? 60_000;
  const byeGraceMs = opts.byeGraceMs ?? 10_000;
  const silenceMs = opts.silenceMs ?? 180_000;
  const tabs = new Map<string, number>();
  let everConnected = false;
  let exited = false;
  let first: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let sweep: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    clearTimeout(first);
    clearTimeout(exitTimer);
    clearInterval(sweep);
    first = exitTimer = sweep = undefined;
  };
  const exit = () => {
    if (exited) return;
    exited = true;
    stop();
    opts.onExit();
  };
  const scheduleExit = () => {
    if (exitTimer === undefined && !exited) exitTimer = setTimeout(exit, byeGraceMs);
  };
  const cancelExit = () => {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  };

  return {
    start() {
      first = setTimeout(() => {
        if (!everConnected) exit();
      }, firstTabMs);
      sweep = setInterval(() => {
        const now = Date.now();
        for (const [id, seen] of tabs) if (now - seen > silenceMs) tabs.delete(id);
        if (everConnected && tabs.size === 0) scheduleExit();
      }, 15_000);
      first.unref?.();
      sweep.unref?.();
    },
    heartbeat(tabId: string) {
      everConnected = true;
      tabs.set(tabId, Date.now());
      cancelExit();
    },
    bye(tabId: string) {
      tabs.delete(tabId);
      if (tabs.size === 0) scheduleExit();
    },
    stop,
  };
}

export type Lifecycle = ReturnType<typeof createLifecycle>;
