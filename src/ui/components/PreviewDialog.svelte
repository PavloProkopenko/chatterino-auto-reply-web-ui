<script lang="ts">
  import { ru } from '../../i18n/ru.ts';
  import type { Condition, Rule, Timer } from '../../shared/config.ts';
  import Dialog from './Dialog.svelte';
  import RulePreview from './RulePreview.svelte';

  // The "Проверка" modal: the same preview as before, opened on demand. The inputs live in preview-state, so they stay filled.
  let {
    open,
    onclose,
    rules,
    timers = [],
    channels,
    focus = null,
    focusConditions = null,
  }: { open: boolean; onclose: () => void; rules: Rule[]; timers?: Timer[]; channels: string[]; focus?: { kind: 'rule' | 'timer'; id: number } | null; focusConditions?: Condition[] | null } = $props();
</script>

<Dialog {open} title={ru.rules.preview.title} {onclose}>
  <RulePreview embedded {rules} {timers} {channels} {focus} {focusConditions} />
</Dialog>
