<script lang="ts">
  import MapView from '$lib/components/MapView.svelte';
  import type { CalendarFile, StreetGeometryFile } from '$lib/types';
  import { buildGeometryLookup, buildStreetCollection } from '$lib/street-geometries';

  export let data: {
    calendar: CalendarFile;
    geometries: StreetGeometryFile;
  };

  const entries = data.calendar.entries;
  let selectedDate = entries[0]?.date ?? '';

  const geometryByStreet = buildGeometryLookup(data.geometries);

  $: selectedEntry = entries.find((entry) => entry.date === selectedDate) ?? entries[0];

  $: selectedStreetCollection = buildStreetCollection(selectedEntry?.streets ?? [], geometryByStreet);
</script>

<main class="relative h-[100dvh] w-screen overflow-hidden">
  <MapView streets={selectedStreetCollection} />

  <aside
    class="glass-panel absolute right-3 top-3 z-10 flex max-h-[calc(100dvh-1.5rem)] w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col gap-4 p-5 md:right-5 md:top-5"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="inline-flex items-center rounded-full border border-amber-900/10 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
        Karlsruhe · {data.calendar.year}
      </span>
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
