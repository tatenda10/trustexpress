const DEFAULT_AUTOCOMPLETE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const autocompleteCache = new Map();
const detailsCache = new Map();
const inFlightRequests = new Map();

function getPlacesApiKey() {
  return (
    process.env.GOOGLE_MAPS_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.ANDROID_GOOGLE_MAPS_API_KEY ||
    process.env.IOS_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

function clampCacheTtlMs(value, fallbackMs) {
  const ttlSeconds = Number(value);
  if (!Number.isFinite(ttlSeconds)) return fallbackMs;
  return Math.min(Math.max(ttlSeconds * 1000, 60 * 1000), 7 * 24 * 60 * 60 * 1000);
}

function normalizeQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCoordinate(coordinate) {
  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function coordinateKey(coordinate, precision = 3) {
  if (!coordinate) return 'none';
  return `${coordinate.latitude.toFixed(precision)},${coordinate.longitude.toFixed(precision)}`;
}

function pruneCache(cache) {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function getCached(cache, key, ttlMs) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(cache, key, value) {
  cache.set(key, { createdAt: Date.now(), value });
  pruneCache(cache);
}

function autocompleteCacheKey({ query, originCoordinate }) {
  return [
    normalizeQuery(query).toLowerCase(),
    coordinateKey(originCoordinate),
  ].join('|');
}

function detailsCacheKey(placeId) {
  return String(placeId || '').trim();
}

function cloneSuggestions(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : []).map((suggestion) => ({
    ...suggestion,
    coordinate: suggestion.coordinate ? { ...suggestion.coordinate } : null,
  }));
}

function mapPrediction(prediction, index, query) {
  const title = prediction?.structured_formatting?.main_text || prediction?.description || query;
  const subtitle = prediction?.structured_formatting?.secondary_text || prediction?.description || 'Zimbabwe';

  return {
    id: prediction?.place_id || `${title}-${index}`,
    placeId: prediction?.place_id || null,
    title,
    subtitle,
    coordinate: null,
    distanceKm: 0,
  };
}

function mapPlaceDetails(result) {
  const location = result?.geometry?.location;
  if (!location) return null;

  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const district = components.find((item) => item.types?.includes('sublocality') || item.types?.includes('locality'))?.long_name;
  const city = components.find((item) => item.types?.includes('administrative_area_level_2') || item.types?.includes('locality'))?.long_name;
  const region = components.find((item) => item.types?.includes('administrative_area_level_1'))?.long_name;

  return {
    coordinate: {
      latitude: Number(location.lat),
      longitude: Number(location.lng),
    },
    title: result?.name || result?.formatted_address || 'Selected place',
    subtitle: result?.formatted_address || '',
    context: {
      district: district || null,
      city: city || null,
      region: region || null,
      country: 'Zimbabwe',
    },
  };
}

export function hasGooglePlacesApiKey() {
  return Boolean(getPlacesApiKey());
}

export async function fetchCachedPlaceAutocomplete({
  query,
  originCoordinate,
  sessionToken,
  cacheTtlSeconds,
}) {
  const apiKey = getPlacesApiKey();
  const normalizedQuery = normalizeQuery(query);
  const normalizedOrigin = normalizeCoordinate(originCoordinate);

  if (!apiKey) {
    const error = new Error('Google Places API key is not configured');
    error.status = 503;
    throw error;
  }
  if (normalizedQuery.length < 3) {
    return { suggestions: [], cacheHit: false };
  }

  const ttlMs = clampCacheTtlMs(cacheTtlSeconds, DEFAULT_AUTOCOMPLETE_CACHE_TTL_MS);
  const cacheKey = autocompleteCacheKey({ query: normalizedQuery, originCoordinate: normalizedOrigin });
  const cached = getCached(autocompleteCache, cacheKey, ttlMs);
  if (cached) return { suggestions: cloneSuggestions(cached), cacheHit: true };

  if (inFlightRequests.has(cacheKey)) {
    const suggestions = await inFlightRequests.get(cacheKey);
    return { suggestions: cloneSuggestions(suggestions), cacheHit: true };
  }

  const requestPromise = (async () => {
    const params = new URLSearchParams({
      input: normalizedQuery,
      components: 'country:zw',
      key: apiKey,
    });

    if (normalizedOrigin) {
      params.append('location', `${normalizedOrigin.latitude},${normalizedOrigin.longitude}`);
      params.append('radius', '35000');
    }
    if (sessionToken) {
      params.append('sessiontoken', String(sessionToken));
    }

    const response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload?.error_message || `Places autocomplete request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    if (payload?.status !== 'OK' && payload?.status !== 'ZERO_RESULTS') {
      const error = new Error(payload?.error_message || `Places autocomplete failed (${payload?.status || 'UNKNOWN'})`);
      error.status = 502;
      throw error;
    }

    const suggestions = (Array.isArray(payload?.predictions) ? payload.predictions : [])
      .slice(0, 6)
      .map((prediction, index) => mapPrediction(prediction, index, normalizedQuery));

    setCached(autocompleteCache, cacheKey, suggestions);
    return suggestions;
  })();

  inFlightRequests.set(cacheKey, requestPromise);

  try {
    const suggestions = await requestPromise;
    return { suggestions: cloneSuggestions(suggestions), cacheHit: false };
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

export async function fetchCachedPlaceDetails({
  placeId,
  sessionToken,
  cacheTtlSeconds,
}) {
  const apiKey = getPlacesApiKey();
  const normalizedPlaceId = detailsCacheKey(placeId);

  if (!apiKey) {
    const error = new Error('Google Places API key is not configured');
    error.status = 503;
    throw error;
  }
  if (!normalizedPlaceId) {
    const error = new Error('placeId is required');
    error.status = 400;
    throw error;
  }

  const ttlMs = clampCacheTtlMs(cacheTtlSeconds, DEFAULT_DETAILS_CACHE_TTL_MS);
  const cached = getCached(detailsCache, normalizedPlaceId, ttlMs);
  if (cached) return { place: { ...cached, coordinate: { ...cached.coordinate } }, cacheHit: true };

  const inFlightKey = `details|${normalizedPlaceId}`;
  if (inFlightRequests.has(inFlightKey)) {
    const place = await inFlightRequests.get(inFlightKey);
    return { place: { ...place, coordinate: { ...place.coordinate } }, cacheHit: true };
  }

  const requestPromise = (async () => {
    const params = new URLSearchParams({
      place_id: normalizedPlaceId,
      fields: 'geometry/location,formatted_address,name,address_component',
      key: apiKey,
    });

    if (sessionToken) {
      params.append('sessiontoken', String(sessionToken));
    }

    const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload?.error_message || `Place details request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    if (payload?.status !== 'OK' || !payload?.result) {
      const error = new Error(payload?.error_message || `Place details failed (${payload?.status || 'UNKNOWN'})`);
      error.status = 502;
      throw error;
    }

    const place = mapPlaceDetails(payload.result);
    if (!place?.coordinate) {
      const error = new Error('Place details did not include coordinates');
      error.status = 502;
      throw error;
    }

    setCached(detailsCache, normalizedPlaceId, place);
    return place;
  })();

  inFlightRequests.set(inFlightKey, requestPromise);

  try {
    const place = await requestPromise;
    return { place: { ...place, coordinate: { ...place.coordinate } }, cacheHit: false };
  } finally {
    inFlightRequests.delete(inFlightKey);
  }
}
