# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, prerendered SvelteKit site that shows Karlsruhe's bulky-waste (Sperrmüll)
collection calendar on a map: pick a pickup day, see the streets highlighted. The
runtime is **Bun**, the UI is **Svelte 5 + SvelteKit (adapter-static)**, the map is
**MapLibre GL** over OpenStreetMap raster tiles. Deployed to GitHub Pages.

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

Both scripts are configured entirely through env vars. Useful ones for iterating
without a full multi-thousand-street run:

```bash
SPERRMUELL_QUICK=1 bun run data:cache          # smaller batches / lower concurrency
SPERRMUELL_LIMIT=50 bun run data:refresh       # cap streets processed
SPERRMUELL_YEAR=2026 bun run data:refresh      # target a specific year
SPERRMUELL_GEOMETRY_MODE=point bun run data:cache    # skip Overpass geometry, points only
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
and `static/data/street-geometries.json` (street → geometry). Run by CI before
every build; fast and Overpass-free.

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
geometry cache, point-fills anything missing, and runs `disambiguateMultiCluster`
— several districts reuse a street name, so it keeps the way-cluster nearest the
rest of that day's (contiguous) route.

Street-name normalization (`ß`↔`ss`, suffix `strasse`↔`straße`, uppercasing) is the
recurring footgun — the Karlsruhe source uses `strasse`, OSM uses `straße`, and a
naive global swap corrupts names like `Brahmsstrasse`. See `normalizeStreet` and
`streetAliases` in `scripts/lib/shared.ts`.

### Stage 2 — frontend (`src/routes/`, `src/lib/`)

Single prerendered page (`prerender = true` in `+page.ts`/`+layout.ts`). `+page.ts`
fetches the two JSON files at build time; `+page.svelte` holds the day selector and
street list; `MapView.svelte` owns the MapLibre map and refits bounds whenever the
selected `FeatureCollection` changes.

`src/lib/street-geometries.ts` builds the selected day's `FeatureCollection` purely
from the prebuilt file — no network at runtime. It reuses the scraper's
`normalizeStreet` so calendar names match the geometry keys; a calendar street with
no matching geometry is simply omitted from the map (it still shows in the list).

## Deployment

`.github/workflows/pages.yml` runs on push to `master`: install → `data:refresh` →
`build` (with `BASE_PATH=/Sperrmuell-KA`) → deploy to Pages. CI runs only the cheap
`data:refresh` and relies on the committed `data/` caches; `data:cache` is run
manually (locally) whenever OSM house numbers or geometry need refreshing, and its
output is committed. `BASE_PATH` is read by `svelte.config.js` to set the SvelteKit
base path for subpath hosting — local builds omit it.
