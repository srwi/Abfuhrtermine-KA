<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { base } from '$app/paths';
  import type { Geometry } from 'geojson';
  import MapView from '$lib/components/MapView.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { CalendarFile, StreetGeometryFile } from '$lib/types';
  import { buildGeometryLookup, buildStreetCollection } from '$lib/street-geometries';

  export let data: {
    calendar: CalendarFile;
  };

  const entries = data.calendar.entries;

  // Always preselect the next pickup strictly after today (skip today even if it
  // is itself a pickup day); fall back to the first entry if every date is past.
  const todayIso = new Date().toLocaleDateString('en-CA');
  const upcoming = entries.find((entry) => entry.isoDate > todayIso);
  let selectedDate = (upcoming ?? entries[0])?.date ?? '';
  let panelOpen = true;
  let listOpen = false;
  let mapView: MapView;

  // The geometry file is multi-MB, so it is fetched client-side after first
  // paint rather than through the prerender load. The street list renders from
  // the calendar immediately; map lines appear once this resolves.
  let geometryByStreet = new Map<string, Geometry>();

  onMount(async () => {
    try {
      const response = await fetch(`${base}/data/street-geometries.json`);
      if (response.ok) {
        geometryByStreet = buildGeometryLookup((await response.json()) as StreetGeometryFile);
      }
    } catch {
      // Leave the map overlay empty if geometry can't be loaded; the list still works.
    }
  });

  // On mobile the panel covers most of the map, so collapse it after a day is
  // picked to reveal the highlighted streets; on desktop (md+) it stays open.
  function handleSelect() {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) {
      panelOpen = false;
    }
  }

  $: selectedEntry = entries.find((entry) => entry.date === selectedDate) ?? entries[0];

  $: selectedStreetCollection = buildStreetCollection(selectedEntry?.streets ?? [], geometryByStreet);
</script>

<main class="relative h-[100dvh] w-screen overflow-hidden">
  <MapView bind:this={mapView} streets={selectedStreetCollection} />

  <button
    type="button"
    aria-label="Meinen Standort anzeigen"
    title="Meinen Standort anzeigen"
    on:click={() => mapView?.locate()}
    class="glass-panel absolute right-2 top-2 z-10 p-3 text-foreground transition hover:bg-background/90 md:bottom-5 md:right-5 md:top-auto md:p-3.5"
  >
    <svg class="h-5 w-5 md:h-6 md:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  </button>

  <aside
    class="glass-panel absolute inset-x-2 bottom-2 z-10 flex flex-col p-4 md:inset-x-auto md:bottom-auto md:right-5 md:top-5 md:w-[21rem] md:p-5"
  >
    {#if panelOpen}
      <div transition:slide={{ duration: 250, easing: cubicOut }} class="flex flex-col gap-3 md:gap-4">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h1 class="text-lg text-foreground md:text-xl">Sperrmüll-Termine</h1>
            <p class="text-xs font-medium text-muted-foreground">Karlsruhe · {data.calendar.year}</p>
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

        <div class="space-y-1.5 md:space-y-2">
          <span class="text-sm font-semibold text-foreground">Abholtag</span>
          <DatePicker {entries} bind:value={selectedDate} on:select={handleSelect} />
        </div>

        <div class="flex flex-col">
          <button
            type="button"
            aria-expanded={listOpen}
            on:click={() => (listOpen = !listOpen)}
            class="-mx-1 flex shrink-0 items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-muted-foreground transition hover:text-foreground"
          >
            <span class="text-sm font-semibold text-foreground">Straßenliste</span>
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
            <div class="max-h-[32dvh] overflow-auto pt-1 md:max-h-[55dvh]">
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
      </div>
    {:else}
      <button
        type="button"
        transition:slide={{ duration: 250, easing: cubicOut }}
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
