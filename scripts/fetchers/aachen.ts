import { RegioItFetcher } from './regioit.ts';

export class AachenFetcher extends RegioItFetcher {
  constructor() {
    super({
      id: 'aachen',
      name: 'Aachen',
      shortName: 'AC',
      serviceDomain: 'aachen',
      center: [6.083862, 50.776351],
      defaultZoom: 12,
      bbox: [50.6621, 5.9748, 50.8572, 6.2181],
      defaultCategories: ['restmuell']
    });
  }
}
