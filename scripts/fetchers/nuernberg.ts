import { RegioItFetcher } from './regioit.ts';

export class NuernbergFetcher extends RegioItFetcher {
  constructor() {
    super({
      id: 'nuernberg',
      name: 'Nürnberg',
      shortName: 'N',
      serviceDomain: 'nuernberg',
      center: [11.077298, 49.453872],
      defaultZoom: 12,
      bbox: [49.3314, 10.9887, 49.5408, 11.2826],
      defaultCategories: ['restmuell']
    });
  }
}
