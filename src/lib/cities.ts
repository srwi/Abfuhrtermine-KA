export interface CityInfo {
  id: string;
  name: string;
  shortName: string;
  center: [number, number]; // [lng, lat]
  defaultZoom: number;
  bbox: [number, number, number, number]; // [south, west, north, east]
  defaultCategories: string[];
}

export const CITIES: CityInfo[] = [
  {
    id: 'karlsruhe',
    name: 'Karlsruhe',
    shortName: 'KA',
    center: [8.4034195, 49.0068705],
    defaultZoom: 12,
    bbox: [48.9404, 8.2774, 49.0913, 8.5417],
    defaultCategories: ['sperrmuell']
  },
  {
    id: 'freiburg',
    name: 'Freiburg im Breisgau',
    shortName: 'FR',
    center: [7.8421043, 47.9990077],
    defaultZoom: 12,
    bbox: [47.9035, 7.6620, 48.0711, 7.9308],
    defaultCategories: ['restmuell']
  },
  {
    id: 'aachen',
    name: 'Aachen',
    shortName: 'AC',
    center: [6.083862, 50.776351],
    defaultZoom: 12,
    bbox: [50.6621, 5.9748, 50.8572, 6.2181],
    defaultCategories: ['restmuell']
  },
  {
    id: 'nuernberg',
    name: 'Nürnberg',
    shortName: 'N',
    center: [11.077298, 49.453872],
    defaultZoom: 12,
    bbox: [49.3314, 10.9887, 49.5408, 11.2826],
    defaultCategories: ['restmuell']
  },
  {
    id: 'darmstadt',
    name: 'Darmstadt',
    shortName: 'DA',
    center: [8.6512, 49.8728],
    defaultZoom: 12,
    bbox: [49.7956, 8.5581, 49.9538, 8.7498],
    defaultCategories: ['restmuell']
  },
  {
    id: 'ingolstadt',
    name: 'Ingolstadt',
    shortName: 'IN',
    center: [11.3797, 48.7534],
    defaultZoom: 12,
    bbox: [48.6839, 11.2559, 48.8229, 11.5034],
    defaultCategories: ['restmuell']
  },
  {
    id: 'recklinghausen',
    name: 'Recklinghausen',
    shortName: 'RE',
    center: [7.2155, 51.6021],
    defaultZoom: 12,
    bbox: [51.5527, 7.1348, 51.6514, 7.2963],
    defaultCategories: ['restmuell']
  },
  {
    id: 'minden',
    name: 'Minden',
    shortName: 'MI',
    center: [8.8952, 52.306],
    defaultZoom: 12,
    bbox: [52.2471, 8.7921, 52.3649, 8.9983],
    defaultCategories: ['restmuell']
  },
  {
    id: 'paderborn',
    name: 'Paderborn',
    shortName: 'PB',
    center: [8.7684, 51.7275],
    defaultZoom: 12,
    bbox: [51.6542, 8.6363, 51.8008, 8.9006],
    defaultCategories: ['restmuell']
  },
  {
    id: 'ratingen',
    name: 'Ratingen',
    shortName: 'RAT',
    center: [6.8922, 51.3182],
    defaultZoom: 12,
    bbox: [51.2645, 6.8012, 51.3718, 6.9831],
    defaultCategories: ['restmuell']
  },
  {
    id: 'salzgitter',
    name: 'Salzgitter',
    shortName: 'SZ',
    center: [10.3693, 52.1179],
    defaultZoom: 12,
    bbox: [52.0131, 10.2308, 52.2227, 10.5078],
    defaultCategories: ['restmuell']
  },
  {
    id: 'flensburg',
    name: 'Flensburg',
    shortName: 'FL',
    center: [9.4322, 54.7944],
    defaultZoom: 12,
    bbox: [54.7518, 9.3573, 54.8371, 9.5072],
    defaultCategories: ['restmuell']
  },
  {
    id: 'neumuenster',
    name: 'Neumünster',
    shortName: 'NMS',
    center: [9.9921, 54.0837],
    defaultZoom: 12,
    bbox: [54.0176, 9.9256, 54.1497, 10.0585],
    defaultCategories: ['restmuell']
  },
  {
    id: 'wilhelmshaven',
    name: 'Wilhelmshaven',
    shortName: 'WHV',
    center: [8.0823, 53.57],
    defaultZoom: 12,
    bbox: [53.5021, 7.9936, 53.6378, 8.1711],
    defaultCategories: ['restmuell']
  },
  {
    id: 'bad-homburg',
    name: 'Bad Homburg',
    shortName: 'HG',
    center: [8.6042, 50.2374],
    defaultZoom: 12,
    bbox: [50.1982, 8.5412, 50.2721, 8.6651],
    defaultCategories: ['restmuell']
  },
  {
    id: 'neustadt',
    name: 'Neustadt an der Weinstraße',
    shortName: 'NW',
    center: [8.1415, 49.3524],
    defaultZoom: 12,
    bbox: [49.3082, 8.0494, 49.4005, 8.2435],
    defaultCategories: ['restmuell']
  }
];

export const CITY_MAP = new Map<string, CityInfo>(CITIES.map((c) => [c.id, c]));
export const DEFAULT_CITY = CITIES[0];

export function getCityCalendarUrl(base: string, cityId: string): string {
  return cityId === 'karlsruhe' ? `${base}/data/calendar.json` : `${base}/data/${cityId}/calendar.json`;
}

export function getCityStreetDataUrl(base: string, cityId: string): string {
  return cityId === 'karlsruhe' ? `${base}/data/street-data.json` : `${base}/data/${cityId}/street-data.json`;
}
