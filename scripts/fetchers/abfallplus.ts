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
import { STANDARD_CATEGORIES } from './regioit.ts';

const INIT_URL = 'https://api.abfall.io';
const GRAPHQL_URL = 'https://widgets.abfall.io/graphql';

export interface AbfallPlusConfig {
  id: string;
  name: string;
  shortName: string;
  serviceKey?: string; // 32-char service key (e.g. from https://api.abfall.io?key=...)
  apiKey?: string; // Direct x-abfallplus-api-key header value
  origin?: string; // Optional Origin header if required by provider
  cityId?: string; // Numeric city ID
  center: [number, number];
  defaultZoom: number;
  bbox: [number, number, number, number];
  categories?: CategoryMeta[];
  defaultCategories?: string[];
  mapWasteTypeToCategory?: (summary: string) => CategoryKey | null;
}

interface GqlCity {
  id: string;
  name: string;
  idHouseNumber: string | null;
  districtsCount: number;
  appointmentsSupported: boolean;
}

interface GqlDistrict {
  id: string;
  name: string;
  idHouseNumber: string | null;
}

interface GqlStreet {
  id: string;
  name: string;
  idHouseNumber: string | null;
}

interface GqlHouseNumber {
  id: string;
  name: string;
}

interface GqlAppointment {
  date: string;
  wasteType: {
    name: string;
  } | null;
}

export function defaultAbfallPlusMapWasteType(typeName: string): CategoryKey | null {
  const lower = typeName.toLowerCase();
  if (lower.includes('sperr')) return 'sperrmuell';
  if (lower.includes('rest') || lower.includes('hausmüll') || lower.includes('hausmuell') || lower.includes('grau')) {
    return 'restmuell';
  }
  if (lower.includes('bio') || lower.includes('braun') || lower.includes('grün') || lower.includes('gruen')) {
    return 'bioabfall';
  }
  if (lower.includes('papier') || lower.includes('blau') || lower.includes('pappe') || lower.includes('ppk')) {
    return 'papier';
  }
  if (lower.includes('gelb') || lower.includes('wertstoff') || lower.includes('verpackung') || lower.includes('dsd')) {
    return 'wertstoff';
  }
  return null;
}

export class AbfallPlusFetcher implements CityFetcher {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly serviceKey?: string;
  readonly origin?: string;
  readonly center: [number, number];
  readonly defaultZoom: number;
  readonly bbox: [number, number, number, number];
  readonly categories: CategoryMeta[];
  readonly defaultCategories: string[];
  readonly mapWasteType: (summary: string) => CategoryKey | null;

  private apiKey?: string;
  private cityId?: string;
  private streetHouseNumberMap = new Map<string, string>(); // streetName -> idHouseNumber

  constructor(config: AbfallPlusConfig) {
    this.id = config.id;
    this.name = config.name;
    this.shortName = config.shortName;
    this.serviceKey = config.serviceKey;
    this.apiKey = config.apiKey;
    this.origin = config.origin;
    this.cityId = config.cityId;
    this.center = config.center;
    this.defaultZoom = config.defaultZoom;
    this.bbox = config.bbox;
    this.categories = config.categories ?? STANDARD_CATEGORIES;
    this.defaultCategories = config.defaultCategories ?? ['restmuell'];
    this.mapWasteType = config.mapWasteTypeToCategory ?? defaultAbfallPlusMapWasteType;
  }

  private async ensureApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    if (!this.serviceKey) {
      throw new Error(`[${this.name}] Either apiKey or serviceKey must be provided for AbfallPlus.`);
    }

    console.log(`[${this.name}] Resolving API key from service key ${this.serviceKey}...`);
    const res = await fetch(`${INIT_URL}?key=${encodeURIComponent(this.serviceKey)}`, {
      headers: { 'user-agent': 'AbfuhrtermineApp/1.0 (+https://github.com/srwi/Abfuhrtermine-KA)' }
    });
    if (!res.ok) {
      throw new Error(`[${this.name}] Failed to resolve AbfallPlus service key: ${res.status}`);
    }
    const data = await res.json();
    if (!data.apiKey) {
      throw new Error(`[${this.name}] AbfallPlus init response missing apiKey`);
    }
    this.apiKey = data.apiKey;
    return this.apiKey!;
  }

  private async gqlRequest<T>(query: string, variables?: Record<string, unknown>, maxRetries = 3): Promise<T> {
    const apiKey = await this.ensureApiKey();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-abfallplus-api-key': apiKey
        };
        if (this.origin) {
          headers['Origin'] = this.origin;
        }

        const res = await fetch(GRAPHQL_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables })
        });

        if (!res.ok) {
          if (attempt < maxRetries && (res.status >= 500 || res.status === 429)) {
            await Bun.sleep(attempt * 500);
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
          await Bun.sleep(attempt * 500);
        }
      }
    }
    throw lastError;
  }

  async fetchStreets(): Promise<string[]> {
    await this.ensureApiKey();

    if (!this.cityId) {
      console.log(`[${this.name}] Resolving city ID in AbfallPlus...`);
      const cityData = await this.gqlRequest<{ cities: GqlCity[] }>(`
        query {
          cities {
            id
            name
            idHouseNumber
            districtsCount
            appointmentsSupported
          }
        }
      `);
      const cities = cityData.cities ?? [];
      const match =
        cities.find((c) => c.name.toLowerCase() === this.name.toLowerCase()) ??
        cities.find((c) => c.name.toLowerCase().includes(this.name.toLowerCase())) ??
        (cities.length === 1 ? cities[0] : null);

      if (!match) {
        throw new Error(
          `[${this.name}] Could not find city "${this.name}" in AbfallPlus. Available: ${cities.map((c) => c.name).join(', ')}`
        );
      }
      this.cityId = match.id;
      console.log(`[${this.name}] Resolved city ID: ${this.cityId} (${match.name})`);
    }

    console.log(`[${this.name}] Fetching city info (id: ${this.cityId})...`);
    const cData = await this.gqlRequest<{ city: { id: string; name: string; districtsCount: number } }>(`
      query {
        city(id: "${this.cityId}") {
          id
          name
          districtsCount
        }
      }
    `);

    const districtsCount = cData.city?.districtsCount ?? 0;
    const streetMap = new Map<string, string>(); // streetName -> idHouseNumber

    if (districtsCount > 0) {
      console.log(`[${this.name}] City has ${districtsCount} districts. Fetching districts...`);
      const dData = await this.gqlRequest<{ city: { districts: GqlDistrict[] } }>(`
        query {
          city(id: "${this.cityId}") {
            districts {
              id
              name
            }
          }
        }
      `);

      const districts = dData.city?.districts ?? [];
      await mapPool(districts, QUICK ? 3 : 8, async (district) => {
        const data = await this.gqlRequest<{ district: { streets: GqlStreet[] } }>(
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
          if (!s.name) continue;
          if (s.idHouseNumber && !streetMap.has(s.name)) {
            streetMap.set(s.name, s.idHouseNumber);
          } else if (!s.idHouseNumber && !streetMap.has(s.name)) {
            // Need house number lookup
            try {
              const hnrData = await this.gqlRequest<{ street: { houseNumbers: GqlHouseNumber[] } }>(
                `
                query GetHnr($streetId: ID!, $districtId: ID) {
                  street(id: $streetId) {
                    houseNumbers(idDistrict: $districtId) {
                      id
                      name
                    }
                  }
                }
                `,
                { streetId: s.id, districtId: district.id }
              );
              const first = hnrData.street?.houseNumbers?.[0];
              if (first?.id) {
                streetMap.set(s.name, first.id);
              }
            } catch {}
          }
        }
      });
    } else {
      console.log(`[${this.name}] Fetching direct street list...`);
      const sData = await this.gqlRequest<{ city: { streets: GqlStreet[] } }>(`
        query {
          city(id: "${this.cityId}") {
            streets {
              id
              name
              idHouseNumber
            }
          }
        }
      `);

      const rawStreets = sData.city?.streets ?? [];
      const streetsNeedingHnr: GqlStreet[] = [];

      for (const s of rawStreets) {
        if (!s.name) continue;
        if (s.idHouseNumber) {
          streetMap.set(s.name, s.idHouseNumber);
        } else {
          streetsNeedingHnr.push(s);
        }
      }

      if (streetsNeedingHnr.length > 0) {
        console.log(`[${this.name}] Resolving house numbers for ${streetsNeedingHnr.length} streets...`);
        await mapPool(streetsNeedingHnr, QUICK ? 4 : 12, async (s) => {
          try {
            const hnrData = await this.gqlRequest<{ street: { houseNumbers: GqlHouseNumber[] } }>(
              `
              query GetHnr($id: ID!) {
                street(id: $id) {
                  houseNumbers {
                    id
                    name
                  }
                }
              }
              `,
              { id: s.id }
            );
            const first = hnrData.street?.houseNumbers?.[0];
            if (first?.id) {
              streetMap.set(s.name, first.id);
            }
          } catch {}
        });
      }
    }

    this.streetHouseNumberMap = streetMap;
    const uniqueStreets = Array.from(streetMap.keys()).sort((a, b) => a.localeCompare(b, 'de'));
    console.log(`[${this.name}] Found ${uniqueStreets.length} unique streets with house numbers.`);
    return uniqueStreets;
  }

  async fetchSchedules(streets: string[]): Promise<Map<string, StreetScheduleDates>> {
    if (this.streetHouseNumberMap.size === 0) {
      await this.fetchStreets();
    }

    const targetStreets = STREET_LIMIT > 0 ? streets.slice(0, STREET_LIMIT) : streets;
    console.log(`[${this.name}] Fetching schedules for ${targetStreets.length} streets via AbfallPlus...`);

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
        const data = await this.gqlRequest<{ appointments: GqlAppointment[] }>(
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
          const category = this.mapWasteType(app.wasteType.name);
          if (!category) continue;

          if (!schedule[category]) {
            schedule[category] = [];
          }
          if (!schedule[category]!.includes(app.date)) {
            schedule[category]!.push(app.date);
          }
        }

        for (const cat of Object.keys(schedule) as CategoryKey[]) {
          schedule[cat]?.sort();
        }

        results.set(normalized, schedule);
      } catch (err) {
        results.set(normalized, {});
      }

      completed++;
      if (completed % 250 === 0 || completed === targetStreets.length) {
        console.log(`[${this.name}] Progress: ${completed}/${targetStreets.length} streets fetched.`);
      }
    });

    return results;
  }
}
