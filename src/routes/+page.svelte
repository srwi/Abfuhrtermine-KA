<script lang="ts">
  import MapView from '$lib/components/MapView.svelte';
  import Badge from '$lib/ui/badge.svelte';
  import Button from '$lib/ui/button.svelte';
  import Card from '$lib/ui/card.svelte';
  import type { CalendarFile, StreetGeometryFile } from '$lib/types';
  import type { Feature, FeatureCollection, Geometry } from 'geojson';

  export let data: {
    calendar: CalendarFile;
    geometries: StreetGeometryFile;
  };

  const entries = data.calendar.entries;
  let selectedDate = entries[0]?.date ?? '';

  const geometryByStreet = new Map(
    data.geometries.streets.map((entry) => [entry.street.toUpperCase(), entry.geometry])
  );

  $: selectedEntry = entries.find((entry) => entry.date === selectedDate) ?? entries[0];
  $: selectedStreetCollection = buildStreetCollection(selectedEntry?.streets ?? [], geometryByStreet);

  function buildStreetCollection(streets: string[], geometryLookup: Map<string, Geometry>) {
    const features: Feature[] = streets
      .map((street) => {
        const geometry = geometryLookup.get(street.toUpperCase());
        if (!geometry) return null;

        return {
          type: 'Feature',
          properties: {
            street
          },
          geometry
        } as Feature;
      })
      .filter((feature): feature is Feature => feature !== null);

    return {
      type: 'FeatureCollection',
      features
    } satisfies FeatureCollection;
  }
</script>

<svelte:head>
  <title>Sperrmüll Karlsruhe</title>
</svelte:head>

<main class="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-4 md:px-6 md:py-6">
  <section class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
    <Card className="relative overflow-hidden p-8 md:p-10">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(178,34,34,0.12),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(7,89,133,0.08),transparent_36%)]"></div>
      <div class="relative flex h-full flex-col gap-6">
        <div class="flex flex-wrap items-center gap-3">
          <Badge>Karlsruhe · {data.calendar.year}</Badge>
          <span class="text-sm font-medium text-stone-600">{entries.length} Abholtermine</span>
        </div>

        <div class="max-w-2xl space-y-4">
          <h1 class="text-4xl leading-tight text-stone-950 md:text-6xl">Sperrmüll-Termine für Karlsruhe auf einer Karte.</h1>
          <p class="max-w-xl text-base leading-7 text-stone-700 md:text-lg">
            Wähle einen Abholtermin aus und sieh sofort, welche Straßen an diesem Tag Sperrmüll haben.
            Die Daten kommen aus der offiziellen Karlsruhe-Quelle und werden jährlich per GitHub Action erneuert.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="rounded-3xl border border-white/70 bg-white/70 p-4">
            <div class="text-sm text-stone-500">Aktueller Termin</div>
            <div class="mt-2 text-lg font-semibold text-stone-950">{selectedEntry?.date ?? 'Keine Daten'}</div>
          </div>
          <div class="rounded-3xl border border-white/70 bg-white/70 p-4">
            <div class="text-sm text-stone-500">Straßen an diesem Tag</div>
            <div class="mt-2 text-lg font-semibold text-stone-950">{selectedEntry?.streets.length ?? 0}</div>
          </div>
          <div class="rounded-3xl border border-white/70 bg-white/70 p-4">
            <div class="text-sm text-stone-500">Gesamte Termine</div>
            <div class="mt-2 text-lg font-semibold text-stone-950">{data.calendar.entries.length}</div>
          </div>
        </div>
      </div>
    </Card>

    <Card className="flex flex-col gap-5 p-6 md:p-8">
      <div>
        <h2 class="text-2xl text-stone-950">Termin auswählen</h2>
        <p class="mt-2 text-sm leading-6 text-stone-600">
          Es werden nur Tage angezeigt, an denen wirklich Sperrmüll abgeholt wird.
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

      <div class="rounded-3xl border border-stone-200 bg-stone-50 p-4">
        <div class="text-sm font-semibold text-stone-500">Straßenliste</div>
        <div class="mt-3 max-h-48 overflow-auto pr-2 text-sm text-stone-800">
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

      <Button className="w-full">Karte auf Auswahl zentrieren</Button>
    </Card>
  </section>

  <section class="grid gap-4">
    <MapView streets={selectedStreetCollection} />
  </section>
</main>