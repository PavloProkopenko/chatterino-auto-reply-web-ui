/**
 * Drag-and-drop ordering for a list of rows. Spread `order.row(id)` on each row: it carries `draggable`, the drag
 * events and the highlight attribute. `enabled` is false while the list is filtered (the order on screen is not the real one).
 */
export class DragOrder {
  dragId = $state<number | null>(null);
  overId = $state<number | null>(null);
  #enabled: () => boolean;
  #move: (id: number, targetId: number) => void;

  constructor(opts: { enabled: () => boolean; move: (id: number, targetId: number) => void }) {
    this.#enabled = opts.enabled;
    this.#move = opts.move;
  }

  row(id: number) {
    const enabled = this.#enabled();
    return {
      draggable: enabled,
      'data-draggable': enabled,
      'data-over': this.overId === id && this.dragId !== id,
      ondragstart: (e: DragEvent) => {
        this.dragId = id;
        e.dataTransfer?.setData('text/plain', String(id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      ondragover: (e: DragEvent) => {
        if (this.dragId === null || !this.#enabled()) return;
        e.preventDefault();
        this.overId = id;
      },
      ondragleave: () => {
        if (this.overId === id) this.overId = null;
      },
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        const from = this.dragId;
        this.dragId = this.overId = null;
        if (from !== null && from !== id) this.#move(from, id);
      },
      ondragend: () => {
        this.dragId = this.overId = null;
      },
    };
  }
}
