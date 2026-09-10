import {
  type CategoryKey,
  type CategoryMeta,
  QUICK,
  STREET_LIMIT,
  YEAR,
  mapPool,
  normalizeStreet
} from '../lib/shared.ts';
import type { CityFetcher, StreetScheduleDates } from './types.ts';

const GRAPHQL_URL = 'https://widgets.abfall.io/graphql';
const FREIBURG_API_KEY = 'ZTFmMTgyNzEtMGUxZC00YzhiLWI4YTMtODkxZWViNTU0NTgwOjg2Mg==';
const FREIBURG_CITY_ID = '5846';

export const FREIBURG_CATEGORIES: CategoryMeta[] = [
  { key: 'restmuell', label: 'Restmüll', color: '#4b5563' },
  { key: 'bioabfall', label: 'Bioabfall', color: '#92400e' },
  { key: 'wertstoff', label: 'Gelber Sack', color: '#eab308' },
  { key: 'papier', label: 'Papier', color: '#1d4ed8' }
];

interface GqlDistrict {
  id: string;
  name: string;
}

interface GqlStreet {
  id: string;
  name: string;
  idHouseNumber: string | null;
}

interface GqlAppointment {
  date: string;
  wasteType: {
    name: string;
  } | null;
}

async function gqlRequest<T>(query: string, variables?: Record<string, unknown>, maxRetries = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-abfallplus-api-key': FREIBURG_API_KEY
        },
        body: JSON.stringify({ query, variables })
      });

      if (!res.ok) {
        if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
          continue;
        }
        throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (json.errors && json.errors.length > 0) {
        throw new Error(`GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
      }

      if (!json.data) {
        throw new Error('GraphQL response missing data field');
      }

      return json.data;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

function mapWasteTypeToCategory(typeName: string): CategoryKey | null {
  const lower = typeName.toLowerCase();
  if (lower.includes('restabfall') || lower.includes('restmüll')) return 'restmuell';
  if (lower.includes('biotonne') || lower.includes('bioabfall') || lower.includes('biomüll')) return 'bioabfall';
  if (lower.includes('papier')) return 'papier';
  if (lower.includes('gelber sack') || lower.includes('wertstoff')) return 'wertstoff';
  return null;
}

export class FreiburgFetcher implements CityFetcher {
  readonly id = 'freiburg';
  readonly name = 'Freiburg im Breisgau';
  readonly shortName = 'FR';
  readonly center: [number, number] = [7.8421043, 47.9990077];
  readonly defaultZoom = 12;
  readonly bbox: [number, number, number, number] = [47.9035, 7.6620, 48.0711, 7.9308];
  readonly categories = FREIBURG_CATEGORIES;
  readonly defaultCategories = ['restmuell'];

  // Cache mapping street name -> idHouseNumber discovered during fetchStreets
  private streetHouseNumberMap = new Map<string, string>();

  async fetchStreets(): Promise<string[]> {
    console.log('[Freiburg] Fetching districts...');
    const districtData = await gqlRequest<{ city: { districts: GqlDistrict[] } }>(`
      query {
        city(id: "${FREIBURG_CITY_ID}") {
          districts {
            id
            name
          }
        }
      }
    `);

    const districts = districtData.city?.districts ?? [];
    console.log(`[Freiburg] Found ${districts.length} districts.`);

    const streetMap = new Map<string, string>(); // streetName -> idHouseNumber

    await mapPool(districts, QUICK ? 3 : 8, async (district) => {
      const data = await gqlRequest<{ district: { streets: GqlStreet[] } }>(
        `
        query GetDistrictStreets($id: ID!) {
          district(id: $id) {
            streets {
              id
              name
              idHouseNumber
            }
          }
        }
        `,
        { id: district.id }
      );

      for (const s of data.district?.streets ?? []) {
        if (s.name && s.idHouseNumber && !streetMap.has(s.name)) {
          streetMap.set(s.name, s.idHouseNumber);
        }
      }
    });

    this.streetHouseNumberMap = streetMap;
    const uniqueStreets = Array.from(streetMap.keys()).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[Freiburg] Found ${uniqueStreets.length} unique streets.`);
    return uniqueStreets;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    // If streetHouseNumberMap wasn't populated yet, fetch streets first
    if (this.streetHouseNumberMap.size === 0) {
      await this.fetchStreets();
    }

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[Freiburg] Fetching schedules for ${targetStreets.length} streets...`);

    const results = new Map<string, StreetScheduleDates>();
    const dateMin = `${YEAR}-01-01`;
    const dateMax = `${YEAR}-12-31`;

    const concurrency = QUICK ? 4 : 12;
    let completed = 0;

    await mapPool(targetStreets, concurrency, async (street) => {
      const hnrId = this.streetHouseNumberMap.get(street);
      const normalized = normalizeStreet(street);

      if (!hnrId) {
        results.set(normalized, {});
        return;
      }

      try {
        const data = await gqlRequest<{ appointments: GqlAppointment[] }>(
          `
          query GetAppointments($id: ID!, $min: Date, $max: Date) {
            appointments(idHouseNumber: $id, dateMin: $min, dateMax: $max) {
              date
              wasteType {
                name
              }
            }
          }
          `,
          { id: hnrId, min: dateMin, max: dateMax }
        );

        const schedule: StreetScheduleDates = {};

        for (const app of data.appointments ?? []) {
          if (!app.date || !app.wasteType?.name) continue;
          const category = mapWasteTypeToCategory(app.wasteType.name);
          if (!category) continue;

          if (!schedule[category]) {
            schedule[category] = [];
          }
          if (!schedule[category]!.includes(app.date)) {
            schedule[category]!.push(app.date);
          }
        }

        // Sort dates chronologically
        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(normalized, schedule);
      } catch (err) {
        console.warn(`[Freiburg] Error fetching schedule for ${street} (hnrId ${hnrId}):`, err);
        results.set(normalized, {});
      }

      completed++;
      if (completed % 100 === 0 || completed === targetStreets.length) {
        console.log(`[Freiburg] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
