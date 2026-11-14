import { tick } from 'svelte';

/**
 * After an item moved, its row is a new DOM node and the keyboard focus is lost. Put it back on the same action
 * (or its neighbour at the end of the list). Rows carry `data-item="<id>"`, buttons `data-act="up|down|edit"`.
 */
export async function refocusAfterMove(id: number, delta: -1 | 1): Promise<void> {
  await tick();
  const row = document.querySelector(`[data-item="${id}"]`);
  const pick = (act: string) => row?.querySelector<HTMLButtonElement>(`[data-act="${act}"]:not(:disabled)`);
  (pick(delta === 1 ? 'down' : 'up') ?? pick(delta === 1 ? 'up' : 'down') ?? pick('edit'))?.focus();
}
