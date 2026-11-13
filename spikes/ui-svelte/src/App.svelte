<script>
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { ru } from './ru.js';
  let rules = $state(Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i, name: 'правило' + i, type: 'word' })));
  const move = (i, d) => {
    if (i + d < 0 || i + d >= rules.length) return;
    const r = [...rules]; [r[i], r[i + d]] = [r[i + d], r[i]]; rules = r;
  };
  const sort = (e) => (rules = e.detail.items);
</script>
<main>
  <h1>{ru.rules}</h1>
  <ul use:dndzone={{ items: rules, flipDurationMs: 150 }} onconsider={sort} onfinalize={sort}>
    {#each rules as rule, i (rule.id)}
      <li animate:flip={{ duration: 150 }}>
        <span aria-label={ru.priority}>⠿</span>
        <span>{i + 1}.</span>
        <input aria-label={ru.name} bind:value={rule.name} />
        <select aria-label={ru.type} bind:value={rule.type}>
          <option value="word">{ru.word}</option><option value="keyword">{ru.keyword}</option>
        </select>
        <button onclick={() => move(i, -1)}>{ru.up}</button><button onclick={() => move(i, 1)}>{ru.down}</button>
      </li>
    {/each}
  </ul>
</main>
