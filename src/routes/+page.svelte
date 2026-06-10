<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { base } from '$app/paths';
  import MapView from '$lib/components/MapView.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import type { CalendarFile, CategoryKey, StreetDataFile } from '$lib/types';
  import { buildStreetLookup, selectStreetsForDay, buildFeatureCollection, type StreetEntry } from '$lib/street-data';

  export let data: {
    calendar: CalendarFile;
  };

  const { categories, days } = data.calendar;
  const colorByKey = new Map(categories.map((c) => [c.key, c.color]));

  // Sperrmüll is enabled by default so the map isn't flooded on first load; the
  // recurring categories are opt-in via the toggles.
  let enabledKeys: CategoryKey[] = categories.some((c) => c.key === 'sperrmuell') ? ['sperrmuell'] : categories.slice(0, 1).map((c) => c.key);
  $: enabledSet = new Set(enabledKeys);

  function toggle(key: CategoryKey) {
    enabledKeys = enabledKeys.includes(key) ? enabledKeys.filter((k) => k !== key) : [...enabledKeys, key];
  }

  // Days that carry at least one enabled category — the picker highlights these.
  $: visibleDays = days.filter((day) => day.categories.some((c) => enabledSet.has(c)));

  // Preselect the next pickup strictly after today among the default categories;
  // fall back to the first such day if every date is past.
  const todayIso = new Date().toLocaleDateString('en-CA');
  const initialDays = days.filter((day) => enabledKeys.some((k) => day.categories.includes(k)));
  let selectedDate = (initialDays.find((day) => day.isoDate > todayIso) ?? initialDays[0])?.isoDate ?? '';

  // After a toggle change, keep the selection on a day that still has data.
  $: if (visibleDays.length > 0 && !visibleDays.some((day) => day.isoDate === selectedDate)) {
    selectedDate = (visibleDays.find((day) => day.isoDate >= selectedDate) ?? visibleDays[visibleDays.length - 1]).isoDate;
  }

  let panelOpen = true;
  let listOpen = false;
  let mapView: MapView;

  // The street-data file is multi-MB, so it is fetched client-side after first
  // paint. The list and map populate once this resolves.
  let streetLookup = new Map<string, StreetEntry>();
  let dataLoaded = false;

  onMount(async () => {
    try {
      const response = await fetch(`${base}/data/street-data.json`);
      if (response.ok) {
        streetLookup = buildStreetLookup((await response.json()) as StreetDataFile);
      }
    } catch {
      // Leave the overlay empty if the data can't be loaded.
    } finally {
      dataLoaded = true;
    }
  });

  // On mobile the panel covers most of the map, so collapse it after a day is
  // picked to reveal the highlighted streets; on desktop (md+) it stays open.
  function handleSelect() {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) {
      panelOpen = false;
    }
  }

  $: selectedDay = days.find((day) => day.isoDate === selectedDate);
  // Index into calendar.days — matches the indices stored in each street's schedule.
  $: dayIndex = days.findIndex((day) => day.isoDate === selectedDate);
  $: selectedStreets = selectStreetsForDay(streetLookup, dayIndex, enabledSet);
  $: selectedCollection = buildFeatureCollection(selectedStreets);
</script>

<main class="relative h-[100dvh] w-screen overflow-hidden">
  <MapView bind:this={mapView} {categories} streets={selectedCollection} />

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
    class="glass-panel absolute inset-x-2 bottom-2 z-10 flex max-h-[calc(100dvh-1rem)] flex-col p-4 md:inset-x-auto md:bottom-auto md:right-5 md:top-5 md:max-h-[calc(100dvh-2.5rem)] md:w-[21rem] md:p-5"
  >
    {#if panelOpen}
      <div transition:slide={{ duration: 250, easing: cubicOut }} class="flex min-h-0 flex-col gap-3 md:gap-4">
        <div class="flex shrink-0 items-start justify-between gap-2">
          <div>
            <h1 class="text-lg text-foreground md:text-xl">Abfuhrtermine</h1>
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

        <div class="shrink-0 space-y-1.5 md:space-y-2">
          <span class="text-sm font-semibold text-foreground">Abfallart</span>
          <div class="flex flex-wrap gap-1.5">
            {#each categories as category}
              {@const active = enabledSet.has(category.key)}
              <button
                type="button"
                aria-pressed={active}
                on:click={() => toggle(category.key)}
                class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition
                  {active ? 'border-transparent text-white shadow-sm' : 'border-border text-muted-foreground hover:text-foreground'}"
                style={active ? `background:${category.color}` : ''}
              >
                {#if !active}
                  <span class="h-2 w-2 rounded-full" style="background:{category.color}"></span>
                {/if}
                {category.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="shrink-0 space-y-1.5 md:space-y-2">
          <span class="text-sm font-semibold text-foreground">Abholtag</span>
          <DatePicker days={visibleDays} bind:value={selectedDate} on:select={handleSelect} />
        </div>

        <div class="flex min-h-0 flex-col">
          <button
            type="button"
            aria-expanded={listOpen}
            on:click={() => (listOpen = !listOpen)}
            class="-mx-1 flex shrink-0 items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-muted-foreground transition hover:text-foreground"
          >
            <span class="text-sm font-semibold text-foreground">Straßenliste</span>
            <span class="flex items-center gap-2 text-xs font-medium">
              {selectedStreets.length}
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
          <!-- grid-template-rows 0fr→1fr animates the reveal without fighting flex
               sizing the way a height transition would; min-h-0 + the inner
               overflow-auto keep only the list (not the whole panel) scrolling. -->
          <div
            class="grid min-h-0 transition-[grid-template-rows] duration-[250ms] ease-out"
            style:grid-template-rows={listOpen ? '1fr' : '0fr'}
            aria-hidden={!listOpen}
          >
            <div class="min-h-0 overflow-hidden">
              <div class="h-full min-h-0 overflow-auto pt-1">
                {#if selectedStreets.length}
                  <ul class="space-y-1 text-[13px] leading-tight text-foreground">
                    {#each selectedStreets as item}
                      <li class="flex items-center gap-2">
                        <span class="flex shrink-0 gap-1">
                          {#each item.categories as cat}
                            <span class="h-2 w-2 rounded-full" style="background:{colorByKey.get(cat)}" title={cat}></span>
                          {/each}
                        </span>
                        <span>{item.street}</span>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="text-[13px] text-muted-foreground">
                    {dataLoaded ? 'Für diesen Tag sind keine Straßen geladen.' : 'Lädt…'}
                  </p>
                {/if}
              </div>
            </div>
          </div>
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
          {selectedDay?.date ?? ''} · {selectedStreets.length} Straßen
        </span>
        <svg class="h-5 w-5 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
    {/if}
  </aside>
</main>
