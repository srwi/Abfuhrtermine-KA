<script lang="ts">
  import { onMount } from 'svelte';

  // Defaults to 'light' for the prerendered markup; corrected on mount from the
  // class the inline app.html script already applied, so the map/UI never flash.
  let theme: 'light' | 'dark' = 'light';

  onMount(() => {
    theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // ignore storage failures (private mode etc.) — toggle still works for the session
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b0a08' : '#f7f3ed');
  }
</script>

<button
  type="button"
  on:click={toggle}
  aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
  title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
  class="shrink-0 rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
>
  {#if theme === 'dark'}
    <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  {:else}
    <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  {/if}
</button>
