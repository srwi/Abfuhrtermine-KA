<script lang="ts">
  import { slide, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { CalendarEntry } from '$lib/types';

  export let entries: CalendarEntry[];
  export let value: string;

  const MONTHS = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WEEKDAYS_LONG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  const pad = (n: number) => String(n).padStart(2, '0');
  const isoToKey = (iso: string) => {
    const [y, m] = iso.split('-').map(Number);
    return y * 12 + (m - 1);
  };

  const byIso = new Map(entries.map((entry) => [entry.isoDate, entry]));
  // Only show months that actually contain a pickup date, so navigation never
  // wanders through empty months even when the data is sparse.
  const monthKeys = [...new Set(entries.map((entry) => isoToKey(entry.isoDate)))].sort((a, b) => a - b);

  const initEntry = entries.find((entry) => entry.date === value) ?? entries[0];
  let viewKey = initEntry ? isoToKey(initEntry.isoDate) : (monthKeys[0] ?? 0);
  let expanded = !value;

  $: selectedEntry = entries.find((entry) => entry.date === value);
  $: viewYear = Math.floor(viewKey / 12);
  $: viewMonth = (viewKey % 12) + 1;
  $: viewIdx = monthKeys.indexOf(viewKey);
  $: cells = buildCells(viewYear, viewMonth, selectedEntry?.isoDate);

  function buildCells(year: number, month: number, selectedIso: string | undefined) {
    const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(year, month - 1, 1 - offset + i);
      const iso = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      return {
        iso,
        day: dt.getDate(),
        inMonth: dt.getMonth() === month - 1,
        entry: byIso.get(iso),
        selected: iso === selectedIso
      };
    });
  }

  function summary(entry: CalendarEntry) {
    const [y, m, d] = entry.isoDate.split('-').map(Number);
    return `${WEEKDAYS_LONG[new Date(y, m - 1, d).getDay()]}, ${entry.date}`;
  }

  function step(delta: number) {
    const next = monthKeys[viewIdx + delta];
    if (next !== undefined) viewKey = next;
  }

  function pick(entry: CalendarEntry | undefined) {
    if (!entry) return;
    value = entry.date;
    expanded = false;
  }

  function expand() {
    if (selectedEntry) viewKey = isoToKey(selectedEntry.isoDate);
    expanded = true;
  }
</script>

{#if expanded}
  <div
    transition:slide={{ duration: 220, easing: cubicOut }}
    class="overflow-hidden rounded-2xl border border-border bg-background p-3 shadow-sm"
  >
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
            title={cell.entry ? `${cell.entry.streets.length} Straßen` : undefined}
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
{:else}
  <button
    type="button"
    transition:slide={{ duration: 220, easing: cubicOut }}
    on:click={expand}
    class="flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border border-border bg-background px-4 py-2.5 text-left shadow-sm transition hover:border-muted-foreground/50 md:py-3"
  >
    <span class="flex items-center gap-2.5 text-base text-foreground">
      <svg class="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      {#if selectedEntry}
        <span class="font-medium">{summary(selectedEntry)}</span>
        <span class="text-sm text-muted-foreground">· {selectedEntry.streets.length} Straßen</span>
      {:else}
        <span class="text-muted-foreground">Abholtag wählen</span>
      {/if}
    </span>
    <svg class="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  </button>
{/if}
