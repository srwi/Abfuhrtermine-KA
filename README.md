# Abfuhrtermine Karlsruhe

> [!NOTE]
> This started off as a fork of [skjerns/Sperrmuell-KA](https://github.com/skjerns/Sperrmuell-KA),
> but quickly turned into a full rewrite with some additional features.

A small static web app that shows Karlsruhe's waste-collection calendar on a map.
Pick a pickup day and the streets collected on that day light up in each waste
type's color, so you can see at a glance when your street is next in line. It
covers all five types the city publishes — **Sperrmüll** (the annual bulky-waste
pickup) plus the recurring **Restmüll**, **Bioabfall**, **Wertstoff** and
**Papier** — each a toggle on the map, with Sperrmüll shown by default.

**[→ Open the waste-collection calendar](https://srwi.github.io/Sperrmuell-KA/)**

## Development

```bash
bun run dev      # local dev server
bun run build    # static build into build/
bun run check    # type checking (svelte-kit sync + svelte-check)
```

## Refreshing the data

The data lives in two stages. Committed OSM caches in `data/` hold the slow,
rate-limited work; the cheap Karlsruhe scrape turns them into the JSON the frontend
renders (`static/data/*.json`). CI runs only the cheap scrape before every deploy.

```bash
bun run data:cache     # slow: rebuild the committed OSM caches in data/ (run on demand)
bun run data:refresh   # cheap: scrape Karlsruhe, regenerate static/data/*.json
```

Run `data:cache` only when OSM house numbers or street geometry need refreshing, and
commit its output. Year-by-year, `data:refresh` is all you need.

A few environment variables tune the scripts. `SPERRMUELL_YEAR` builds against a
specific calendar year (defaults to the current year); `QUICK` and `LIMIT` keep the
slow cache build small while iterating:

```bash
SPERRMUELL_YEAR=2026 bun run data:refresh   # target a specific calendar year
SPERRMUELL_QUICK=1 bun run data:cache       # smaller batches / lower concurrency
SPERRMUELL_LIMIT=50 bun run data:cache      # cap streets processed
```

For the full architecture (the three-stage pipeline, the placeholder-date quirk,
street-name normalization), see [CLAUDE.md](CLAUDE.md).

## Sperrmüll hunting etiquette

Half the point of knowing the pickup schedule is getting first pick of someone
else's perfectly good bookshelf the evening before. Taking usable items from the
curb is a Karlsruhe tradition, but it is a polite one. A few unwritten rules:

- Don't make a mess.
- An unchained bike near a Sperrmüll pile may or may not actually be Sperrmüll, so
  make sure before you ride off with it.
- If an electrical device looks to be in good condition, consider not stripping its
  wire, so someone else can still use it.
- Be polite with each other and don't fight over stuff that innocent residents are
  still carrying out to the curb.
- And in general, just don't be a dick.

Happy hunting and leave the curb the same or better than you found it.
