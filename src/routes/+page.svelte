<script lang="ts">
  import { browser } from '$app/environment';
  import MapView from '$lib/components/MapView.svelte';
  import Badge from '$lib/ui/badge.svelte';
  import type { CalendarFile, StreetGeometryFile } from '$lib/types';
  import { buildGeometryLookup, buildStreetCollection, resolveStreetCollection } from '$lib/street-geometries';

  export let data: {
    calendar: CalendarFile;
    geometries: StreetGeometryFile;
  };

  const entries = data.calendar.entries;
  let selectedDate = entries[0]?.date ?? '';

  const geometryByStreet = buildGeometryLookup(data.geometries);

  $: selectedEntry = entries.find((entry) => entry.date === selectedDate) ?? entries[0];

  let selectedStreetCollection = buildStreetCollection(selectedEntry?.streets ?? [], geometryByStreet);
  let requestToken = 0;

  async function refreshSelection(streets: string[]) {
    if (!browser || streets.length === 0) return;

    const token = ++requestToken;
    const collection = await resolveStreetCollection(streets, geometryByStreet);

    if (token !== requestToken) return;

    selectedStreetCollection = collection;
  }

  $: if (browser && selectedEntry) {
    void refreshSelection(selectedEntry.streets);
  }
</script>

<svelte:head>
  <title>Sperrmüll Karlsruhe</title>
</svelte:head>

<main class="relative h-[100dvh] w-screen overflow-hidden">
  <MapView streets={selectedStreetCollection} />

  <aside
    class="glass-panel absolute right-3 top-3 z-10 flex max-h-[calc(100dvh-1.5rem)] w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col gap-4 p-5 md:right-5 md:top-5"
  >
    <div class="flex flex-wrap items-center gap-2">
      <Badge>Karlsruhe · {data.calendar.year}</Badge>
      <span class="text-xs font-medium text-stone-600">{entries.length} Abholtermine</span>
    </div>

    <div>
      <h1 class="text-xl text-stone-950">Sperrmüll-Termine</h1>
      <p class="mt-1 text-sm leading-6 text-stone-600">
        Wähle einen Abholtag und sieh, welche Straßen an diesem Tag Sperrmüll haben.
      </p>
    </div>

    <label class="space-y-2">
      <span class="text-sm font-semibold text-stone-700">Abholtag</span>
      <select
        bind:value={selectedDate}
        class="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-900 shadow-sm outline-none transition focus:border-stone-400 focus:ring-4 focus:ring-stone-900/5"
      >
        {#each entries as entry}
          <option value={entry.date}>{entry.date} · {entry.streets.length} Straßen</option>
        {/each}
      </select>
    </label>

    <div class="flex min-h-0 flex-col rounded-3xl border border-stone-200 bg-stone-50 p-4">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-stone-500">Straßenliste</span>
        <span class="text-xs font-medium text-stone-500">{selectedEntry?.streets.length ?? 0}</span>
      </div>
      <div class="mt-3 min-h-0 flex-1 overflow-auto pr-2 text-sm text-stone-800">
        {#if selectedEntry?.streets.length}
          <ul class="space-y-2">
            {#each selectedEntry.streets as street}
              <li class="rounded-2xl bg-white px-3 py-2 shadow-sm">{street}</li>
            {/each}
          </ul>
        {:else}
          <p>Für diesen Tag sind keine Straßen geladen.</p>
        {/if}
      </div>
    </div>
  </aside>
</main>
