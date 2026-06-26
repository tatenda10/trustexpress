import {
  fetchCachedOsmPlaceAutocomplete,
  fetchCachedOsmPlaceDetails,
  hasOsmPlacesProvider,
} from './osm-places.js';
import { fetchHerePlaceAutocomplete, hasHerePlacesProvider } from './here-places.js';
import {
  cacheResolvedSuggestions,
  findCachedPlaceSuggestions,
  getCachedPlaceById,
  getCachedPlaceByProviderKey,
} from './place-cache.js';

function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function getPlacesProviderName() {
  if (hasOsmPlacesProvider() && hasHerePlacesProvider()) return 'osm+here';
  if (hasOsmPlacesProvider()) return 'osm';
  if (hasHerePlacesProvider()) return 'here';
  return 'none';
}

export async function fetchCachedPlaceAutocomplete(options) {
  const normalizedQuery = normalizeQuery(options?.query);
  const cachedSuggestions = await findCachedPlaceSuggestions({
    query: normalizedQuery,
    originCoordinate: options?.originCoordinate,
  });
  if (cachedSuggestions.length > 0) {
    return { suggestions: cachedSuggestions, cacheHit: true };
  }

  if (hasOsmPlacesProvider()) {
    try {
      const osmResult = await fetchCachedOsmPlaceAutocomplete(options);
      if (Array.isArray(osmResult?.suggestions) && osmResult.suggestions.length > 0) {
        const suggestions = await cacheResolvedSuggestions({
          provider: 'osm',
          normalizedQuery,
          suggestions: osmResult.suggestions,
        });
        return {
          suggestions,
          cacheHit: Boolean(osmResult?.cacheHit),
        };
      }
    } catch (error) {
      console.warn('[maps-places] OSM autocomplete failed, trying HERE fallback', error?.message || error);
    }
  }

  if (hasHerePlacesProvider()) {
    const hereResult = await fetchHerePlaceAutocomplete(options);
    if (Array.isArray(hereResult?.suggestions) && hereResult.suggestions.length > 0) {
      const suggestions = await cacheResolvedSuggestions({
        provider: 'here',
        normalizedQuery,
        suggestions: hereResult.suggestions,
      });
      return {
        suggestions,
        cacheHit: Boolean(hereResult?.cacheHit),
      };
    }
  }

  if (getPlacesProviderName() === 'none') {
    const error = new Error('No places provider is configured');
    error.status = 503;
    throw error;
  }

  return { suggestions: [], cacheHit: false };
}

export async function fetchCachedPlaceDetails(options) {
  const cachedPlace = await getCachedPlaceById(options?.placeId);
  if (cachedPlace) {
    return { place: cachedPlace, cacheHit: true };
  }

  const normalizedPlaceId = String(options?.placeId || '').trim();
  if (normalizedPlaceId) {
    const cachedOsmPlace = await getCachedPlaceByProviderKey('osm', normalizedPlaceId);
    if (cachedOsmPlace?.place) {
      return { place: cachedOsmPlace.place, cacheHit: true };
    }
  }

  if (hasOsmPlacesProvider()) {
    try {
      const osmResult = await fetchCachedOsmPlaceDetails(options);
      if (osmResult?.place) {
        const savedSuggestions = await cacheResolvedSuggestions({
          provider: 'osm',
          normalizedQuery: osmResult.place.title || osmResult.place.subtitle || 'selected place',
          suggestions: [
            {
              providerPlaceId: osmResult.place.providerPlaceId || normalizedPlaceId || null,
              title: osmResult.place.title,
              subtitle: osmResult.place.subtitle,
              coordinate: osmResult.place.coordinate,
              context: osmResult.place.context,
              rawPayload: osmResult.place.rawPayload || null,
            },
          ],
        });

        const savedPlaceId = savedSuggestions[0]?.placeId;
        if (savedPlaceId) {
          const savedPlace = await getCachedPlaceById(savedPlaceId);
          if (savedPlace) return { place: savedPlace, cacheHit: Boolean(osmResult.cacheHit) };
        }

        return { place: osmResult.place, cacheHit: Boolean(osmResult.cacheHit) };
      }
    } catch (error) {
      console.warn('[maps-places] OSM place details failed', error?.message || error);
    }
  }

  const error = new Error('No place details provider is configured');
  error.status = getPlacesProviderName() === 'none' ? 503 : 404;
  throw error;
}
