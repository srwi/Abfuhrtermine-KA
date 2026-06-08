<script lang="ts">
  import MapView from '$lib/components/MapView.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { CalendarFile, StreetGeometryFile } from '$lib/types';
  import { buildGeometryLookup, buildStreetCollection } from '$lib/street-geometries';

  export let data: {
    calendar: CalendarFile;
    geometries: StreetGeometryFile;
  };

  const entries = data.calendar.entries;

  // Preselect today's pickup, or the next upcoming one; fall back to the first
  // entry if every date is already in the past.
  const todayIso = new Date().toLocaleDateString('en-CA');
  const upcoming = entries.find((entry) => entry.isoDate >= todayIso);
  let selectedDate = (upcoming ?? entries[0])?.date ?? '';
  let panelOpen = true;
  let listOpen = false;

  const geometryByStreet = buildGeometryLookup(data.geometries);

  $: selectedEntry = entries.find((entry) => entry.date === selectedDate) ?? entries[0];

  $: selectedStreetCollection = buildStreetCollection(selectedEntry?.streets ?? [], geometryByStreet);
</script>

<main class="relative h-[100dvh] w-screen overflow-hidden">
  <MapView streets={selectedStreetCollection} />

  <aside
    class="glass-panel absolute inset-x-2 bottom-2 z-10 flex max-h-[78dvh] flex-col gap-3 p-4 md:inset-x-auto md:bottom-auto md:right-5 md:top-5 md:w-[21rem] md:max-h-[calc(100dvh-2.5rem)] md:gap-4 md:p-5"
    class:min-h-0={panelOpen && listOpen}
  >
    {#if panelOpen}
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center rounded-full border border-amber-900/10 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900 dark:border-amber-200/10 dark:bg-stone-800/80 dark:text-amber-200">
            Karlsruhe · {data.calendar.year}
          </span>
          <span class="text-xs font-medium text-muted-foreground">{entries.length} Abholtermine</span>
        </div>
        <div class="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Panel einklappen"
            aria-expanded="true"
            on:click={() => (panelOpen = false)}
            class="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div>
        <h1 class="text-lg text-foreground md:text-xl">Sperrmüll-Termine</h1>
        <p class="mt-1 hidden text-sm leading-6 text-muted-foreground sm:block">
          Wähle einen Abholtag und sieh, welche Straßen an diesem Tag Sperrmüll haben.
        </p>
      </div>

      <div class="space-y-1.5 md:space-y-2">
        <span class="text-sm font-semibold text-foreground">Abholtag</span>
        <DatePicker {entries} bind:value={selectedDate} />
      </div>

      <div class="flex flex-col border-t border-border pt-2" class:min-h-0={listOpen} class:flex-1={listOpen}>
        <button
          type="button"
          aria-expanded={listOpen}
          on:click={() => (listOpen = !listOpen)}
          class="-mx-1 flex shrink-0 items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-muted-foreground transition hover:text-foreground"
        >
          <span class="text-sm font-semibold">Straßenliste</span>
          <span class="flex items-center gap-2 text-xs font-medium">
            {selectedEntry?.streets.length ?? 0}
            <svg
              class="h-4 w-4 transition-transform duration-200"
              class:rotate-180={listOpen}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>
        {#if listOpen}
          <div class="min-h-0 flex-1 overflow-auto pt-1">
            {#if selectedEntry?.streets.length}
              <ul class="space-y-1 text-[13px] leading-tight text-foreground">
                {#each selectedEntry.streets as street}
                  <li>{street}</li>
                {/each}
              </ul>
            {:else}
              <p class="text-[13px] text-muted-foreground">Für diesen Tag sind keine Straßen geladen.</p>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        aria-label="Panel ausklappen"
        aria-expanded="false"
        on:click={() => (panelOpen = true)}
        class="flex w-full items-center justify-between gap-3 text-left"
      >
        <span class="text-sm font-semibold text-foreground">
          {selectedEntry?.date ?? ''} · {selectedEntry?.streets.length ?? 0} Straßen
        </span>
        <svg class="h-5 w-5 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
    {/if}
  </aside>
</main>
