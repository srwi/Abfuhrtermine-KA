<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { base } from '$app/paths';
  import MapView from '$lib/components/MapView.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { CITIES, CITY_MAP, DEFAULT_CITY, type CityInfo } from '$lib/cities';
  import type { CalendarFile, CategoryKey, StreetDataFile } from '$lib/types';
  import { buildStreetLookup, selectStreetsForDay, buildFeatureCollection, type StreetEntry } from '$lib/street-data';

  export let data: {
    calendar: CalendarFile;
  };

  let selectedCityId = DEFAULT_CITY.id;
  let currentCity: CityInfo = DEFAULT_CITY;
  $: currentCity = CITY_MAP.get(selectedCityId) ?? DEFAULT_CITY;

  let currentCalendar: CalendarFile = data.calendar;
  $: categories = currentCalendar.categories;
  $: days = currentCalendar.days;
  $: colorByKey = new Map(categories.map((c) => [c.key, c.color]));

  let enabledKeys: CategoryKey[] = (DEFAULT_CITY.defaultCategories as CategoryKey[]).filter((k) =>
    data.calendar.categories.some((c) => c.key === k)
  );
  if (enabledKeys.length === 0 && data.calendar.categories.length > 0) {
    enabledKeys = [data.calendar.categories[0].key];
  }
  $: enabledSet = new Set(enabledKeys);

  function toggle(key: CategoryKey) {
    enabledKeys = enabledKeys.includes(key) ? enabledKeys.filter((k) => k !== key) : [...enabledKeys, key];
  }

  // Days that carry at least one enabled category — the picker highlights these.
  $: visibleDays = days.filter((day) => day.categories.some((c) => enabledSet.has(c)));

  // Preselect the next pickup strictly after today among the default categories;
  // fall back to the first such day if every date is past.
  const todayIso = new Date().toLocaleDateString('en-CA');
  $: initialDays = days.filter((day) => enabledKeys.some((k) => day.categories.includes(k)));
  let selectedDate = '';
  $: if (!selectedDate && initialDays.length > 0) {
    selectedDate = (initialDays.find((day) => day.isoDate > todayIso) ?? initialDays[0])?.isoDate ?? '';
  }

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

  async function loadCityData(cityId: string) {
    dataLoaded = false;
    const city = CITY_MAP.get(cityId) ?? DEFAULT_CITY;

    try {
      const calPath = cityId === 'karlsruhe'
        ? `${base}/data/calendar.json`
        : `${base}/data/${cityId}/calendar.json`;

      const calRes = await fetch(calPath);
      if (calRes.ok) {
        currentCalendar = (await calRes.json()) as CalendarFile;
        const defaults = (city.defaultCategories as CategoryKey[]).filter((k) =>
          currentCalendar.categories.some((c) => c.key === k)
        );
        enabledKeys = defaults.length > 0 ? defaults : [currentCalendar.categories[0]?.key].filter(Boolean);

        const newInitialDays = currentCalendar.days.filter((day) =>
          enabledKeys.some((k) => day.categories.includes(k))
        );
        selectedDate = (newInitialDays.find((day) => day.isoDate > todayIso) ?? newInitialDays[0])?.isoDate ?? '';
      }

      const streetPath = cityId === 'karlsruhe'
        ? `${base}/data/street-data.json`
        : `${base}/data/${cityId}/street-data.json`;

      const streetRes = await fetch(streetPath);
      if (streetRes.ok) {
        streetLookup = buildStreetLookup((await streetRes.json()) as StreetDataFile);
      } else {
        streetLookup = new Map();
      }
    } catch (err) {
      console.error(`Failed to load data for ${cityId}:`, err);
      streetLookup = new Map();
    } finally {
      dataLoaded = true;
    }
  }

  async function handleCityChange(newCityId: string) {
    selectedCityId = newCityId;
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('stadt', newCityId);
      window.history.replaceState({}, '', url.toString());
    }
    await loadCityData(newCityId);
  }

  onMount(async () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlCity = params.get('stadt') || params.get('city');
      if (urlCity && CITY_MAP.has(urlCity.toLowerCase())) {
        selectedCityId = urlCity.toLowerCase();
        await loadCityData(selectedCityId);
        return;
      }
    }

    await loadCityData(DEFAULT_CITY.id);
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
  <MapView bind:this={mapView} {categories} streets={selectedCollection} center={currentCity.center} zoom={currentCity.defaultZoom} />

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
            <h1 class="text-lg font-bold text-foreground md:text-xl">Abfuhrtermine</h1>
            <div class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <select
                aria-label="Stadt auswählen"
                bind:value={selectedCityId}
                on:change={() => handleCityChange(selectedCityId)}
                class="cursor-pointer rounded-md border border-border bg-background/80 px-2 py-0.5 font-medium text-foreground outline-none transition hover:border-foreground/40 focus:ring-1 focus:ring-primary"
              >
                {#each CITIES as city}
                  <option value={city.id}>{city.name}</option>
                {/each}
              </select>
              <span>· {currentCalendar.year}</span>
            </div>
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
                style={active ? `background-color: ${category.color}` : ''}
              >
                <span
                  class="h-2 w-2 rounded-full border border-black/10 transition"
                  style="background-color: {category.color}"
                ></span>
                {category.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="shrink-0 space-y-1.5 md:space-y-2">
          <span class="text-sm font-semibold text-foreground">Datum</span>
          <DatePicker
            days={visibleDays}
            bind:value={selectedDate}
            on:select={handleSelect}
          />
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={listOpen}
            on:click={() => (listOpen = !listOpen)}
            class="flex w-full items-center justify-between text-left text-sm font-semibold text-foreground"
          >
            <span>
              {selectedDay?.date ?? ''} · {selectedStreets.length} Straßen
            </span>
            <svg
              class="h-4 w-4 text-muted-foreground transition-transform duration-200 {listOpen ? 'rotate-180' : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <div
            class="grid transition-[grid-template-rows] duration-200 ease-out {listOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}"
          >
            <div class="overflow-hidden">
              <div class="mt-2 max-h-48 overflow-y-auto pr-1">
                {#if selectedStreets.length > 0}
                  <ul class="space-y-1 text-xs">
                    {#each selectedStreets as entry}
                      <li class="flex items-center justify-between gap-2 py-0.5 text-foreground/90">
                        <span class="truncate" title={entry.street}>{entry.street}</span>
                        <div class="flex shrink-0 gap-1">
                          {#each entry.categories as catKey}
                            <span
                              class="inline-block h-2 w-2 rounded-full"
                              style="background-color: {colorByKey.get(catKey)}"
                              title={categories.find((c) => c.key === catKey)?.label}
                            ></span>
                          {/each}
                        </div>
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
          {currentCity.shortName} · {selectedDay?.date ?? ''} · {selectedStreets.length} Straßen
        </span>
        <svg class="h-5 w-5 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
    {/if}
  </aside>
</main>
