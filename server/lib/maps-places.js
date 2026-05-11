import {
  fetchCachedOsmPlaceAutocomplete,
  fetchCachedOsmPlaceDetails,
  hasOsmPlacesProvider,
} from './osm-places.js';

export function getPlacesProviderName() {
  if (hasOsmPlacesProvider()) return 'osm';
  return 'none';
}

export async function fetchCachedPlaceAutocomplete(options) {
  const provider = getPlacesProviderName();
  if (provider === 'osm') return fetchCachedOsmPlaceAutocomplete(options);

  const error = new Error('No places provider is configured');
  error.status = 503;
  throw error;
}

export async function fetchCachedPlaceDetails(options) {
  const provider = getPlacesProviderName();
  if (provider === 'osm') return fetchCachedOsmPlaceDetails(options);

  const error = new Error('No place details provider is configured');
  error.status = 503;
  throw error;
}
