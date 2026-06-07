<script lang="ts">
  import { onMount } from 'svelte';
  import maplibregl, { type LngLatBoundsLike, type Map } from 'maplibre-gl';
  import type { FeatureCollection, Geometry } from 'geojson';

  export let streets: FeatureCollection;

  let mapContainer: HTMLDivElement;
  let map: Map | undefined;

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
              'line-color': '#b91c1c',
              'line-width': 5,
              'line-opacity': 0.92
            }
          },
          {
            id: 'selected-points',
            type: 'circle',
            source: 'selected-streets',
            paint: {
              'circle-color': '#b91c1c',
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
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

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

<div bind:this={mapContainer} class="h-full w-full"></div>