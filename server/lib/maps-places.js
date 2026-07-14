import {
  fetchCachedOsmPlaceAutocomplete,
  fetchCachedOsmPlaceDetails,
  hasOsmPlacesProvider,
} from './osm-places.js';
import {
  fetchGooglePlaceAutocomplete,
  fetchGooglePlaceDetails,
  hasGooglePlacesProvider,
} from './google-places.js';
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
  if (hasOsmPlacesProvider() && hasGooglePlacesProvider()) return 'osm+google';
  if (hasOsmPlacesProvider()) return 'osm';
  if (hasGooglePlacesProvider()) return 'google';
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
      console.warn('[maps-places] OSM autocomplete failed, trying Google fallback', error?.message || error);
    }
  }

  if (hasGooglePlacesProvider()) {
    const googleResult = await fetchGooglePlaceAutocomplete(options);
    if (Array.isArray(googleResult?.suggestions) && googleResult.suggestions.length > 0) {
      const suggestions = await cacheResolvedSuggestions({
        provider: 'google',
        normalizedQuery,
        suggestions: googleResult.suggestions,
      });
      return {
        suggestions,
        cacheHit: Boolean(googleResult?.cacheHit),
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
    const cachedGooglePlace = await getCachedPlaceByProviderKey('google', normalizedPlaceId);
    if (cachedGooglePlace?.place) {
      return { place: cachedGooglePlace.place, cacheHit: true };
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

  if (hasGooglePlacesProvider() && normalizedPlaceId) {
    try {
      const googleResult = await fetchGooglePlaceDetails({ placeId: normalizedPlaceId });
      if (googleResult?.place) {
        const savedSuggestions = await cacheResolvedSuggestions({
          provider: 'google',
          normalizedQuery: googleResult.place.title || googleResult.place.subtitle || 'selected place',
          suggestions: [
            {
              providerPlaceId: googleResult.place.providerPlaceId || normalizedPlaceId,
              title: googleResult.place.title,
              subtitle: googleResult.place.subtitle,
              coordinate: googleResult.place.coordinate,
              context: googleResult.place.context,
              rawPayload: googleResult.place.rawPayload || null,
            },
          ],
        });

        const savedPlaceId = savedSuggestions[0]?.placeId;
        if (savedPlaceId) {
          const savedPlace = await getCachedPlaceById(savedPlaceId);
          if (savedPlace) return { place: savedPlace, cacheHit: Boolean(googleResult.cacheHit) };
        }

        return { place: googleResult.place, cacheHit: Boolean(googleResult.cacheHit) };
      }
    } catch (error) {
      if (Number(error?.status) === 422) throw error;
      console.warn('[maps-places] Google place details failed', error?.message || error);
    }
  }

  const error = new Error('No place details provider is configured');
  error.status = getPlacesProviderName() === 'none' ? 503 : 404;
  throw error;
}
