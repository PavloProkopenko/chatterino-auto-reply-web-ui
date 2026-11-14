<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import { session } from '../state/app.svelte.ts';
  import Icon from './Icon.svelte';

  const state = $derived(session.hasFieldErrors ? 'blocked' : session.dirty ? 'dirty' : 'saved');
  const text = $derived(state === 'blocked' ? ru.bar.blocked : state === 'dirty' ? ru.bar.unsaved : ru.bar.saved);
</script>

<div class="savebar">
  <p class="status" data-state={state} role="status">{text}</p>
  <div class="actions">
    <button class="btn ghost icon-only" type="button" aria-label={ru.bar.undo} title="{ru.bar.undo} (Ctrl+Z)" disabled={!session.canUndo} onclick={() => session.undo()}><Icon name="undo" /></button>
    <button class="btn ghost icon-only" type="button" aria-label={ru.bar.redo} title="{ru.bar.redo} (Ctrl+Shift+Z)" disabled={!session.canRedo} onclick={() => session.redo()}><Icon name="redo" /></button>
    <button class="btn" type="button" disabled={!session.dirty} onclick={() => session.revert()}>{ru.bar.revert}</button>
    <button class="btn primary" type="button" disabled={!session.canSave} onclick={() => void session.save()}>{session.saving ? ru.bar.saving : ru.bar.save}</button>
  </div>
</div>
