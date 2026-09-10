import type { CategoryMeta } from '../lib/shared.ts';
import { JumoMindFetcher } from './jumomind.ts';

export const DARMSTADT_CATEGORIES: CategoryMeta[] = [
  { key: 'restmuell', label: 'Restabfall', color: '#4b5563' },
  { key: 'bioabfall', label: 'Bioabfall', color: '#92400e' },
  { key: 'wertstoff', label: 'Wertstofftonne', color: '#eab308' },
  { key: 'papier', label: 'Altpapier', color: '#1d4ed8' }
];

export class DarmstadtFetcher extends JumoMindFetcher {
  constructor() {
    super({
      id: 'darmstadt',
      name: 'Darmstadt',
      shortName: 'DA',
      serviceId: 'mymuell',
      cityId: '9934',
      center: [8.6512, 49.8728],
      defaultZoom: 12,
      bbox: [49.7956, 8.5581, 49.9538, 8.7498],
      categories: DARMSTADT_CATEGORIES,
      defaultCategories: ['restmuell']
    });
  }
}
