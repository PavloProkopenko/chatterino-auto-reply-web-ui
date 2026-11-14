<script lang="ts">
  import { onMount } from 'svelte';
  import { ru } from '../i18n/ru.ts';
  import Banners from './components/Banners.svelte';
  import ConflictDialog from './components/ConflictDialog.svelte';
  import Gate from './components/Gate.svelte';
  import HistoryDialog from './components/HistoryDialog.svelte';
  import SaveBar from './components/SaveBar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Settings from './pages/Settings.svelte';
  import { session, startLifecycle } from './state/app.svelte.ts';

  onMount(() => {
    startLifecycle();
    void session.start();
  });

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      void session.save();
    } else if (!typing(e.target) && k === 'z') {
      // inside a text field the browser's own undo handles the text; elsewhere this is the app's undo
      e.preventDefault();
      if (e.shiftKey) session.redo();
      else session.undo();
    } else if (!typing(e.target) && k === 'y') {
      e.preventDefault();
      session.redo();
    }
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (!session.canLeave) e.preventDefault();
  }

  const refresh = () => {
    if (document.visibilityState === 'visible') void session.refreshIfChanged();
  };
</script>

<svelte:window onkeydown={onKey} onbeforeunload={onBeforeUnload} onfocus={refresh} />
<svelte:document onvisibilitychange={refresh} />

{#if session.phase === 'ready'}
  <a class="skip" href="#main">{ru.skipToContent}</a>
  <div class="shell">
    <Sidebar />
    <div class="main">
      <Banners />
      <main class="scroll" id="main" tabindex="-1"><Settings /></main>
      <SaveBar />
    </div>
  </div>
{:else}
  <Gate />
{/if}

<HistoryDialog />
<ConflictDialog />
