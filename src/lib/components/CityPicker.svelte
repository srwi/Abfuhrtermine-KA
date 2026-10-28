<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CityInfo } from '$lib/cities';

  export let cities: CityInfo[] = [];
  export let selectedCityId: string = '';
  export let onSelect: (cityId: string) => void;

  let isOpen = false;
  let searchQuery = '';
  let inputEl: HTMLInputElement | null = null;
  let containerEl: HTMLDivElement | null = null;

  $: currentCity = cities.find((c) => c.id === selectedCityId) ?? cities[0];

  function normalize(str: string) {
    return str
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .trim();
  }

  $: filteredCities = searchQuery.trim()
    ? cities.filter((c) => {
        const q = normalize(searchQuery);
        return normalize(c.name).includes(q) || normalize(c.shortName).includes(q) || c.id.includes(q);
      })
    : cities;

  async function open() {
    isOpen = true;
    searchQuery = '';
    await tick();
    inputEl?.focus();
  }

  function close() {
    isOpen = false;
  }

  function handleSelect(cityId: string) {
    onSelect(cityId);
    close();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Enter' && filteredCities.length > 0) {
      handleSelect(filteredCities[0].id);
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (containerEl && !containerEl.contains(event.target as Node)) {
      close();
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });
</script>

<div class="relative" bind:this={containerEl}>
  <!-- Trigger Button -->
  <button
    type="button"
    aria-label="Stadt auswählen"
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    on:click={open}
    class="flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm transition hover:border-foreground/40 hover:bg-background focus:outline-none focus:ring-1 focus:ring-primary"
  >
    <svg class="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
    <span class="max-w-[140px] truncate md:max-w-[170px]">{currentCity ? currentCity.name : 'Stadt wählen'}</span>
    <svg class="h-3 w-3 text-muted-foreground transition {isOpen ? 'rotate-180' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  <!-- Dropdown Popover -->
  {#if isOpen}
    <div
      class="glass-panel absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-border bg-background/95 p-2 shadow-xl backdrop-blur-md transition"
      on:keydown={handleKeydown}
      role="dialog"
      aria-modal="true"
    >
      <div class="relative mb-2">
        <svg class="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          bind:this={inputEl}
          bind:value={searchQuery}
          type="text"
          placeholder="Stadt suchen... ({cities.length})"
          class="w-full rounded-md border border-border bg-background/80 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div class="max-h-56 overflow-y-auto divide-y divide-border/30 text-xs">
        {#if filteredCities.length === 0}
          <div class="py-4 text-center text-xs text-muted-foreground">Keine Stadt gefunden</div>
        {:else}
          {#each filteredCities as city}
            {@const isSelected = city.id === selectedCityId}
            <button
              type="button"
              on:click={() => handleSelect(city.id)}
              class="flex w-full items-center justify-between px-2.5 py-1.5 text-left transition hover:bg-accent {isSelected ? 'font-semibold text-primary bg-accent/60' : 'text-foreground'}"
            >
              <span class="truncate">{city.name}</span>
              <span class="ml-2 shrink-0 rounded bg-border/40 px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">{city.shortName}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
