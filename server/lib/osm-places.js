import {
  BULAWAYO_SERVICE_BOUNDS,
  isCoordinateInBulawayoServiceArea,
} from './service-area.js';

const DEFAULT_AUTOCOMPLETE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DETAILS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const BULAWAYO_VIEWBOX = [
  BULAWAYO_SERVICE_BOUNDS.west,
  BULAWAYO_SERVICE_BOUNDS.north,
  BULAWAYO_SERVICE_BOUNDS.east,
  BULAWAYO_SERVICE_BOUNDS.south,
].join(',');

const autocompleteCache = new Map();
const detailsCache = new Map();
const inFlightRequests = new Map();

function getNominatimBaseUrl() {
  return (
    process.env.NOMINATIM_BASE_URL ||
    process.env.OSM_GEOCODER_BASE_URL ||
    DEFAULT_NOMINATIM_BASE_URL
  ).replace(/\/+$/, '');
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

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return 0;
  const earthRadiusKm = 6371;
  const dLat = toRadians(end.latitude - start.latitude);
  const dLng = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
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
    'bulawayo',
    normalizeQuery(query).toLowerCase(),
    coordinateKey(originCoordinate),
  ].join('|');
}

function detailsCacheKey(placeId) {
  return ['bulawayo', String(placeId || '').trim()].join('|');
}

function toPlaceId(item) {
  const osmType = String(item?.osm_type || '').trim().toUpperCase().charAt(0);
  const osmId = String(item?.osm_id || '').trim();
  if (!osmType || !osmId) return null;
  return `${osmType}${osmId}`;
}

function cloneSuggestions(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : []).map((suggestion) => ({
    ...suggestion,
    coordinate: suggestion.coordinate ? { ...suggestion.coordinate } : null,
  }));
}

function buildTitle(item, query) {
  const address = item?.address || {};
  return (
    item?.name ||
    address?.amenity ||
    address?.building ||
    address?.road ||
    address?.suburb ||
    address?.city ||
    address?.town ||
    item?.display_name?.split(',')?.[0] ||
    query
  );
}

function buildSubtitle(item) {
  const address = item?.address || {};
  const parts = [
    address?.suburb,
    address?.city || address?.town || address?.village,
    address?.state,
    address?.country || 'Zimbabwe',
  ].filter(Boolean);
  return parts.join(', ') || item?.display_name || 'Zimbabwe';
}

function mapSearchResult(item, index, query, originCoordinate) {
  const coordinate = {
    latitude: Number(item?.lat),
    longitude: Number(item?.lon),
  };
  return {
    id: toPlaceId(item) || `${buildTitle(item, query)}-${index}`,
    placeId: toPlaceId(item),
    title: buildTitle(item, query),
    subtitle: buildSubtitle(item),
    coordinate,
    distanceKm: originCoordinate ? calculateDistanceKm(originCoordinate, coordinate) : 0,
  };
}

function mapLookupResult(item) {
  const coordinate = {
    latitude: Number(item?.lat),
    longitude: Number(item?.lon),
  };
  return {
    coordinate,
    title: buildTitle(item, 'Selected place'),
    subtitle: item?.display_name || buildSubtitle(item),
    context: {
      district: item?.address?.suburb || item?.address?.county || null,
      city: item?.address?.city || item?.address?.town || item?.address?.village || null,
      region: item?.address?.state || null,
      country: item?.address?.country || 'Zimbabwe',
    },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TrustCars/1.0',
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `Nominatim request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function hasOsmPlacesProvider() {
  return Boolean(getNominatimBaseUrl());
}

export async function fetchCachedOsmPlaceAutocomplete({
  query,
  originCoordinate,
  cacheTtlSeconds,
}) {
  const normalizedQuery = normalizeQuery(query);
  const normalizedOrigin = normalizeCoordinate(originCoordinate);

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
    const baseUrl = getNominatimBaseUrl();
    const params = new URLSearchParams({
      q: normalizedQuery,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
      countrycodes: 'zw',
      namedetails: '1',
      viewbox: BULAWAYO_VIEWBOX,
      bounded: '1',
    });

    const payload = await fetchJson(`${baseUrl}/search?${params.toString()}`);
    const suggestions = (Array.isArray(payload) ? payload : [])
      .map((item, index) => mapSearchResult(item, index, normalizedQuery, normalizedOrigin))
      .filter((suggestion) => isCoordinateInBulawayoServiceArea(suggestion.coordinate))
      .slice(0, 6);

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

export async function fetchCachedOsmPlaceDetails({
  placeId,
  cacheTtlSeconds,
}) {
  const normalizedPlaceId = String(placeId || '').trim();
  const cacheKey = detailsCacheKey(normalizedPlaceId);

  if (!normalizedPlaceId) {
    const error = new Error('placeId is required');
    error.status = 400;
    throw error;
  }

  const ttlMs = clampCacheTtlMs(cacheTtlSeconds, DEFAULT_DETAILS_CACHE_TTL_MS);
  const cached = getCached(detailsCache, cacheKey, ttlMs);
  if (cached && isCoordinateInBulawayoServiceArea(cached.coordinate)) {
    return { place: { ...cached, coordinate: { ...cached.coordinate } }, cacheHit: true };
  }
  if (cached) detailsCache.delete(cacheKey);

  const inFlightKey = `details|${cacheKey}`;
  if (inFlightRequests.has(inFlightKey)) {
    const place = await inFlightRequests.get(inFlightKey);
    return { place: { ...place, coordinate: { ...place.coordinate } }, cacheHit: true };
  }

  const requestPromise = (async () => {
    const baseUrl = getNominatimBaseUrl();
    const params = new URLSearchParams({
      osm_ids: normalizedPlaceId,
      format: 'jsonv2',
      addressdetails: '1',
      namedetails: '1',
    });

    const payload = await fetchJson(`${baseUrl}/lookup?${params.toString()}`);
    const item = Array.isArray(payload) ? payload[0] : null;
    const place = item ? mapLookupResult(item) : null;

    if (!place?.coordinate || !Number.isFinite(place.coordinate.latitude) || !Number.isFinite(place.coordinate.longitude)) {
      const error = new Error('Place details did not include coordinates');
      error.status = 502;
      throw error;
    }
    if (!isCoordinateInBulawayoServiceArea(place.coordinate)) {
      const error = new Error('That place is outside the Bulawayo service area');
      error.status = 422;
      throw error;
    }

    setCached(detailsCache, cacheKey, place);
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
