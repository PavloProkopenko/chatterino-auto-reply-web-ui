<script lang="ts">
  import { onMount } from 'svelte';
  import { ru } from '../i18n/ru.ts';
  import Banners from './components/Banners.svelte';
  import ConflictDialog from './components/ConflictDialog.svelte';
  import FreshFileDialog from './components/FreshFileDialog.svelte';
  import Gate from './components/Gate.svelte';
  import HistoryDialog from './components/HistoryDialog.svelte';
  import SaveBar from './components/SaveBar.svelte';
  import TopBar from './components/TopBar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import RedeemEditPage from './pages/RedeemEditPage.svelte';
  import Redeems from './pages/Redeems.svelte';
  import RuleEditPage from './pages/RuleEditPage.svelte';
  import Rules from './pages/Rules.svelte';
  import Settings from './pages/Settings.svelte';
  import TimerEditPage from './pages/TimerEditPage.svelte';
  import Timers from './pages/Timers.svelte';
  import { session, twitch } from './state/app.svelte.ts';
  import { router } from './state/route.svelte.ts';

  // about every 10 s; the e2e build sets VITE_POLL_MS to something short so tests need not wait
  const POLL_MS = Number(import.meta.env.VITE_POLL_MS) || 10_000;

  onMount(() => {
    void session.start();
    // The plugin can save at any moment and a page cannot watch a file: look now and then while the tab is in view.
    const timer = setInterval(() => document.visibilityState === 'visible' && void session.refreshIfChanged(), POLL_MS);
    return () => clearInterval(timer);
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
    if (document.visibilityState === 'visible') {
      void session.refreshIfChanged();
      void twitch.refresh(); // a login made in chat shows up when the tab is back in view
    }
  };

  // the login belongs to the open folder: read it when a folder opens, forget it when another opens or none
  $effect(() => {
    void session.pluginFolder;
    void twitch.refresh();
  });
</script>

<svelte:window onkeydown={onKey} onbeforeunload={onBeforeUnload} onfocus={refresh} />
<svelte:document onvisibilitychange={refresh} />

{#if session.phase === 'ready'}
  <a class="skip" href="#main">{ru.skipToContent}</a>
  <div class="shell">
    <Sidebar />
    <div class="main">
      <TopBar />
      <Banners />
      <main class="scroll" id="main" tabindex="-1">
        {#if router.current.page === 'rules'}{#if router.current.view === 'edit'}<RuleEditPage id={router.current.id} />{:else}<Rules />{/if}
        {:else if router.current.page === 'timers'}{#if router.current.view === 'edit'}<TimerEditPage id={router.current.id} />{:else}<Timers />{/if}
        {:else if router.current.page === 'redeems'}{#if router.current.view === 'edit'}<RedeemEditPage id={router.current.id} />{:else}<Redeems />{/if}
        {:else}<Settings />{/if}
      </main>
      <SaveBar />
    </div>
  </div>
{:else}
  <Gate />
{/if}

<HistoryDialog />
<ConflictDialog />
<FreshFileDialog />
