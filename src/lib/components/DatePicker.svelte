<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { CalendarDay } from '$lib/types';

  // The days to mark as pickup days — already filtered to the enabled categories
  // by the parent, so the highlight reacts to the category toggles.
  export let days: CalendarDay[];
  export let value: string;

  const dispatch = createEventDispatcher<{ select: string }>();

  const MONTHS = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  const pad = (n: number) => String(n).padStart(2, '0');
  const isoToKey = (iso: string) => {
    const [y, m] = iso.split('-').map(Number);
    return y * 12 + (m - 1);
  };

  // value is the selected ISO date ("2026-06-15"). Recompute the marked days and
  // navigable months whenever `days` changes (the parent re-filters on toggle).
  $: byIso = new Map(days.map((day) => [day.isoDate, day]));
  // Only show months that actually contain a pickup date, so navigation never
  // wanders through empty months even when the data is sparse.
  $: monthKeys = [...new Set(days.map((day) => isoToKey(day.isoDate)))].sort((a, b) => a - b);

  let viewKey = isoToKey(value || days[0]?.isoDate || `${new Date().getFullYear()}-01-01`);
  // Keep the view on a month that still has pickups after a toggle change.
  $: if (monthKeys.length > 0 && !monthKeys.includes(viewKey)) {
    viewKey = monthKeys.reduce((best, k) => (Math.abs(k - viewKey) < Math.abs(best - viewKey) ? k : best));
  }

  $: viewYear = Math.floor(viewKey / 12);
  $: viewMonth = (viewKey % 12) + 1;
  $: viewIdx = monthKeys.indexOf(viewKey);
  // Pass `byIso` in explicitly so Svelte tracks it as a dependency: toggling a
  // category rebuilds `days`/`byIso` without changing the view month or `value`,
  // and a dependency referenced only inside the function body would not retrigger.
  $: cells = buildCells(viewYear, viewMonth, value, byIso);

  function buildCells(year: number, month: number, selectedIso: string | undefined, marks: Map<string, CalendarDay>) {
    const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(year, month - 1, 1 - offset + i);
      const iso = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      return {
        iso,
        day: dt.getDate(),
        inMonth: dt.getMonth() === month - 1,
        entry: marks.get(iso),
        selected: iso === selectedIso
      };
    });
  }

  function step(delta: number) {
    const next = monthKeys[viewIdx + delta];
    if (next !== undefined) viewKey = next;
  }

  function pick(day: CalendarDay | undefined) {
    if (!day) return;
    value = day.isoDate;
    dispatch('select', day.isoDate);
  }
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-background p-3 shadow-sm">
  <div class="flex items-center justify-between gap-2 px-1">
    <button
      type="button"
      aria-label="Vorheriger Monat"
      disabled={viewIdx <= 0}
      on:click={() => step(-1)}
      class="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
    </button>
    <span class="text-sm font-semibold text-foreground">{MONTHS[viewMonth - 1]} {viewYear}</span>
    <button
      type="button"
      aria-label="Nächster Monat"
      disabled={viewIdx < 0 || viewIdx >= monthKeys.length - 1}
      on:click={() => step(1)}
      class="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
    </button>
  </div>

  <div class="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
    {#each WEEKDAYS as weekday}
      <span>{weekday}</span>
    {/each}
  </div>

  {#key viewKey}
    <div in:fade={{ duration: 150 }} class="mt-1 grid grid-cols-7 gap-1">
      {#each cells as cell (cell.iso)}
        <button
          type="button"
          disabled={!cell.entry}
          on:click={() => pick(cell.entry)}
          class="flex h-9 items-center justify-center rounded-lg text-sm transition
            {cell.selected
              ? 'bg-red-700 font-semibold text-white shadow-sm'
              : cell.entry
                ? 'bg-red-50 font-semibold text-red-700 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25'
                : cell.inMonth
                  ? 'text-muted-foreground/40'
                  : 'text-muted-foreground/25'}"
        >
          {cell.day}
        </button>
      {/each}
    </div>
  {/key}
</div>
