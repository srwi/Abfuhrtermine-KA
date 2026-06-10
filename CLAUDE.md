# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, prerendered SvelteKit site that shows Karlsruhe's bulky-waste (Sperrmüll)
collection calendar on a map: pick a pickup day, see the streets highlighted. The
runtime is **Bun**, the UI is **Svelte 5 + SvelteKit (adapter-static)**, the map is
**MapLibre GL** over OpenStreetMap raster tiles. Deployed to GitHub Pages.

`README.md` is the user-facing overview (what the app does + how to refresh data);
this file is the detailed engineering reference. Keep the two in sync when the
data pipeline or commands change.

**Language convention.** Code, comments, and script log output are written in
**English**; the user-facing UI is in **German** (it's a Karlsruhe-local tool, so UI
strings in `src/` stay German). The word *Sperrmüll* is kept verbatim everywhere —
in German UI, in English comments, and in the source-site match strings.

## Commands

```bash
bun run dev            # local dev server (vite)
bun run build          # static build into build/  (set BASE_PATH for subpath hosting)
bun run check          # svelte-kit sync + svelte-check type checking
bun run data:cache     # Overpass-heavy: (re)build the committed caches in data/
bun run data:refresh   # cheap Karlsruhe-only scrape, regenerates static/data/*.json
```

There is no test suite. `bun run check` is the only verification gate. (Note: the
`scripts/` Bun files are outside the svelte-check tsconfig, so type errors there are
not caught by `bun run check` — run the scripts to validate them.)

Three env vars tune the scripts (all other knobs are now plain constants in
`scripts/lib/shared.ts`, `build-cache.ts`, and `refresh-data.ts` — edit them there
if you need to change batch sizes, retries, Overpass endpoint, etc.):

```bash
SPERRMUELL_YEAR=2026 bun run data:refresh      # target a specific calendar year (default: current year)
SPERRMUELL_QUICK=1 bun run data:cache          # smaller batches / lower concurrency
SPERRMUELL_LIMIT=50 bun run data:cache         # cap streets processed
```

## Architecture

The app is a **three-part pipeline**: a slow Overpass cache build, then a cheap
scrape that produces the JSON data files, then a purely static frontend that
renders them. Scripts share `scripts/lib/shared.ts` (the `declare const Bun` blocks
are intentional — the scripts are *not* part of the SvelteKit type world); the
frontend shares only the file contracts in `src/lib/types.ts`.

### Stage 0 — cache build (`scripts/build-cache.ts`, `bun run data:cache`)

Does **all** the slow, rate-limited, intermittently-flaky Overpass/OSM work and
writes two **committed** caches into `data/`:

- `data/osm-house-numbers.json` — normalized street → real OSM house numbers
  (year-independent). An empty array means "asked Overpass, none found".
- `data/geometry-cache.json` — normalized street → raw GeoJSON line/point ways,
  fetched in shrinking batches because Overpass intermittently returns partial
  `200 OK`s; genuinely unmapped streets fall back to a point.

Run **on demand**, not on every build. Progress is written after every Overpass
batch, so it is resumable without any signal handling. Because the results are
committed, CI never touches Overpass.

### Stage 1 — scrape (`scripts/refresh-data.ts`, `bun run data:refresh`)

The source site (`web4.karlsruhe.de/.../akal_<year>.php`) has no public calendar —
you can only POST a street + house number and read back a date. This script reads
the committed caches and probes **only** the (un-throttled, parallelizable)
Karlsruhe site, then writes `static/data/calendar.json` (pickup dates → streets)
and `static/data/street-geometries.json` (street → geometry). Both outputs are
committed; the build just renders whatever is committed. Run on demand by the
`refresh.yml` workflow (or locally) — fast and Overpass-free.

Per street: if the OSM cache has house numbers we probe those real addresses (the
**primary path**); otherwise we probe a fixed fallback list (the **fallback path**).

**The placeholder-date quirk.** For a shifting set of house numbers the source
returns a fixed *placeholder* date instead of "Adresse ist unbekannt", even for
streets that don't exist. We do **not** try to enumerate that house-number set (a
black-box behavior that could change) — we only measure the placeholder *date*
each run via canary probes (`detectPlaceholderDates`). Probing real OSM addresses
then sidesteps the quirk: the primary path trusts the date (deferring the
placeholder date only in favor of any non-placeholder date seen across the street's
numbers), so ~24 real streets that genuinely fall on the placeholder date are kept;
the fallback path distrusts the placeholder date outright (provably safe — no
OSM-less street legitimately falls on it), dropping phantom squares/Gewann.
`#unknown` / `#nodate` distinguish "address doesn't exist" from "exists but no date".

Geometry assembly here is pure computation (no network): it loads the committed
geometry cache, **omits** any street without a real (non-point) geometry rather than
plotting a meaningless dot — the point-fallbacks live only in the Stage 0 cache —
then rounds coordinates to ~1 m and runs `disambiguateMultiCluster` (several
districts reuse a street name, so it keeps the way-cluster nearest the rest of that
day's contiguous route). An omitted street still shows in the list, just not on the map.

Street-name normalization (`ß`↔`ss`, suffix `strasse`↔`straße`, uppercasing) is the
recurring footgun — the Karlsruhe source uses `strasse`, OSM uses `straße`, and a
naive global swap corrupts names like `Brahmsstrasse`. See `normalizeStreet` and
`streetAliases` in `scripts/lib/shared.ts`.

### Stage 2 — frontend (`src/routes/`, `src/lib/`)

Single prerendered page (`prerender = true` in `+page.ts`/`+layout.ts`). `+page.ts`
fetches only the small `calendar.json` at build time — SvelteKit inlines a `load`
result into the prerendered HTML, so the multi-MB `street-geometries.json` is fetched
**client-side after mount** (in `+page.svelte`) instead, to keep `index.html` small
and not block first paint. `+page.svelte` holds the day selector (`DatePicker.svelte`,
a German month/weekday calendar), the collapsible street list, a geolocation button
wired to MapLibre's `GeolocateControl`, and a light/dark theme toggle
(`ThemeToggle.svelte`). `MapView.svelte` owns the MapLibre map and refits bounds
whenever the selected `FeatureCollection` changes; dark mode is a CSS inversion of the
light-only OSM raster basemap (the red street overlay survives the hue-rotate).

`src/lib/street-geometries.ts` builds the selected day's `FeatureCollection` purely
from the prebuilt file — no network at runtime. It reuses the scraper's
`normalizeStreet` so calendar names match the geometry keys; a calendar street with
no matching geometry is simply omitted from the map (it still shows in the list).

## Deployment

Two GitHub Actions workflows, deliberately split so deploys never touch the data
pipeline:

- `.github/workflows/pages.yml` — runs on every push to `master` (and manual
  `workflow_dispatch`): install → `build` (with `BASE_PATH=/Sperrmuell-KA`) → deploy
  to Pages. It does **not** scrape or build caches; it just renders the committed
  `static/data/*.json`.
- `.github/workflows/refresh.yml` — **on-demand only** (`workflow_dispatch`): install
  → `data:refresh` → commit the regenerated `static/data/*.json`. That commit's push
  to `master` then triggers `pages.yml`, so a refresh and its deploy are two separate
  workflows chained by the push.

`data:refresh` relies on the committed `data/` caches and never touches Overpass;
`data:cache` is run manually (locally) whenever OSM house numbers or geometry need
refreshing, and its output is committed. `BASE_PATH` is read by `svelte.config.js` to
set the SvelteKit base path for subpath hosting — local builds omit it.
