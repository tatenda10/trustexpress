import { fetchCachedOsmDirections, hasOsmDirectionsProvider } from './osm-directions.js';

export function getDirectionsProviderName() {
  if (hasOsmDirectionsProvider()) return 'osm';
  return 'none';
}

export async function fetchCachedDirections(options) {
  const provider = getDirectionsProviderName();
  if (provider === 'osm') return fetchCachedOsmDirections(options);

  const error = new Error('No directions provider is configured');
  error.status = 503;
  throw error;
}
