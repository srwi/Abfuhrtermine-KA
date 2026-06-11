<script lang="ts">
  import { onMount } from 'svelte';
  import maplibregl, {
    type DataDrivenPropertyValueSpecification,
    type LngLatBoundsLike,
    type Map as MapLibreMap
  } from 'maplibre-gl';
  import type { FeatureCollection, Geometry } from 'geojson';
  import type { CategoryMeta } from '$lib/types';

  export let streets: FeatureCollection;
  // Category metadata (key -> label/color) from calendar.json; drives the
  // per-category line/point colors and the popup label.
  export let categories: CategoryMeta[] = [];

  const labelByKey = new Map(categories.map((c) => [c.key, c.label]));
  // MapLibre 'match' expression coloring each feature by its `category` property.
  // Needs at least one case; fall back to red when no categories are known.
  const categoryColor: DataDrivenPropertyValueSpecification<string> =
    categories.length > 0
      ? (['match', ['get', 'category'], ...categories.flatMap((c) => [c.key, c.color]), '#b91c1c'] as unknown as DataDrivenPropertyValueSpecification<string>)
      : '#b91c1c';

  let mapContainer: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let geolocate: maplibregl.GeolocateControl | undefined;

  // Driven by the app's own styled button in +page.svelte. We keep MapLibre's
  // GeolocateControl (for its marker / accuracy circle / tracking) but hide its
  // default button via CSS and activate it programmatically.
  export function locate() {
    geolocate?.trigger();
  }

  const center: [number, number] = [8.4034195, 49.0068705];

  function getCoordinates(geometry: Geometry | null | undefined): unknown {
    return geometry && 'coordinates' in geometry ? geometry.coordinates : undefined;
  }

  function fitGeometryBounds(collection: FeatureCollection): LngLatBoundsLike | undefined {
    const coordinates: number[][] = [];

    const collect = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (value.length > 0 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        coordinates.push([value[0], value[1]]);
        return;
      }

      for (const item of value) {
        collect(item);
      }
    };

    for (const feature of collection.features) {
      collect(getCoordinates(feature.geometry));
    }

    if (coordinates.length === 0) return undefined;

    let minLng = coordinates[0][0];
    let minLat = coordinates[0][1];
    let maxLng = coordinates[0][0];
    let maxLat = coordinates[0][1];

    for (const [lng, lat] of coordinates) {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }

    return [
      [minLng, minLat],
      [maxLng, maxLat]
    ];
  }

  function updateSelectedData(collection: FeatureCollection) {
    if (!map) return;

    const source = map.getSource('selected-streets') as maplibregl.GeoJSONSource | undefined;
    source?.setData(collection);

    const bounds = fitGeometryBounds(collection);
    if (bounds) {
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 80, right: 80 },
        duration: 500,
        maxZoom: 15
      });
    }
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap-Mitwirkende'
          },
          'selected-streets': {
            type: 'geojson',
            data: streets
          }
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm'
          },
          {
            id: 'selected-lines',
            type: 'line',
            source: 'selected-streets',
            paint: {
              'line-color': categoryColor,
              'line-width': 5,
              'line-opacity': 0.92
            }
          },
          {
            id: 'selected-lines-hit',
            type: 'line',
            source: 'selected-streets',
            paint: {
              'line-color': '#b91c1c',
              'line-width': 18,
              'line-opacity': 0
            },
            filter: ['==', '$type', 'LineString']
          },
          {
            id: 'selected-points',
            type: 'circle',
            source: 'selected-streets',
            paint: {
              'circle-color': categoryColor,
              'circle-radius': 7,
              'circle-opacity': 0.92,
              'circle-stroke-color': '#fff7ed',
              'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
          }
        ]
      },
      center,
      zoom: 12.4,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false
    });

    // Keep pinch-to-zoom, but stop two-finger rotation.
    map.touchZoomRotate.disableRotation();

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');

    geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: true
    });
    map.addControl(geolocate, 'top-right');

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'street-popup',
      offset: 12
    });

    const showPopup = (event: maplibregl.MapLayerMouseEvent) => {
      const props = event.features?.[0]?.properties;
      const street = props?.street;
      if (typeof street !== 'string') return;
      const label = labelByKey.get(props?.category);
      map!.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(event.lngLat).setText(label ? `${street} · ${label}` : street).addTo(map!);
    };

    const hidePopup = () => {
      map!.getCanvas().style.cursor = '';
      popup.remove();
    };

    for (const layer of ['selected-lines-hit', 'selected-points']) {
      map.on('mousemove', layer, showPopup);
      map.on('mouseleave', layer, hidePopup);
    }

    map.on('load', () => {
      updateSelectedData(streets);
    });

    return () => {
      map?.remove();
    };
  });

  $: if (map) {
    updateSelectedData(streets);
  }
</script>

<div bind:this={mapContainer} class="map-shell h-full w-full"></div>

<style>
  /* The OSM raster tiles are light-only. In dark mode invert the WebGL canvas
     and rotate the hue 180° — this darkens the basemap while leaving saturated
     hues (the red street overlay) roughly unchanged. Controls and popups live in
     separate DOM nodes, so they keep their own styling. */
  :global(html.dark) .map-shell :global(.maplibregl-canvas) {
    filter: invert(1) hue-rotate(180deg) brightness(1.05) contrast(0.92);
  }

  /* MapLibre ships only a light theme for the attribution control, and it sits
     outside the inverted canvas (see above), so in dark mode it would stay a
     white pill with black text. Re-skin it with the app's semantic tokens.
     Selectors are MapLibre's own documented control classes. */
  :global(html.dark) .map-shell :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    background-color: rgb(var(--background) / 0.85);
    color: rgb(var(--foreground));
  }
  :global(html.dark) .map-shell :global(.maplibregl-ctrl-attrib a) {
    color: rgb(var(--muted-foreground));
  }
  /* The ⓘ glyph is a baked-in dark SVG; invert just this 24px button to flip the
     glyph light (and its translucent backdrop with it) without re-embedding the SVG. */
  :global(html.dark) .map-shell :global(.maplibregl-ctrl-attrib-button) {
    filter: invert(1);
  }

  /* The GeolocateControl is driven by the app's own styled button (see
     +page.svelte) via geolocate.trigger(), so hide MapLibre's default control.
     Nothing else lives in the top-right corner. */
  .map-shell :global(.maplibregl-ctrl-top-right) {
    display: none;
  }

  /* The attribution lives in the top-left corner (out of the way of the panel on
     mobile). On desktop (md+) the panel sits top-right, so drop attribution to the
     bottom-left where it reads as a conventional map credit. */
  @media (min-width: 768px) {
    .map-shell :global(.maplibregl-ctrl-top-left) {
      top: auto;
      bottom: 0;
    }
  }
</style>