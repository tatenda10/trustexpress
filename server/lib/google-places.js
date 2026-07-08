import { isCoordinateInBulawayoServiceArea } from './service-area.js';
import { BULAWAYO_CENTER_COORDINATE } from './service-area.js';

const DEFAULT_GOOGLE_BASE_URL = 'https://maps.googleapis.com/maps/api/place';
const SERVICE_AREA_BIAS_RADIUS_METERS = 20000;

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

function getGoogleApiKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_DIRECTIONS_API_KEY ||
    ''
  ).trim();
}

function getGoogleBaseUrl() {
  return (process.env.GOOGLE_PLACES_BASE_URL || DEFAULT_GOOGLE_BASE_URL).replace(/\/+$/, '');
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
    const error = new Error(payload?.error_message || `Google Places request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  // Google returns HTTP 200 with a status field describing the actual result.
  const status = String(payload?.status || '').toUpperCase();
  if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
    const error = new Error(payload?.error_message || `Google Places error: ${status}`);
    error.status = status === 'OVER_QUERY_LIMIT' ? 429 : 502;
    throw error;
  }
  return payload;
}

function splitAddress(formattedAddress, name) {
  const address = String(formattedAddress || '').trim();
  if (!address) return { title: name || 'Selected place', subtitle: 'Zimbabwe' };
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (name && parts.length) {
    return { title: name, subtitle: parts.join(', ') };
  }
  const [first, ...rest] = parts;
  return {
    title: name || first || address,
    subtitle: rest.length ? rest.join(', ') : (parts.join(', ') || 'Zimbabwe'),
  };
}

function mapTextSearchResult(item, index, query, originCoordinate) {
  const coordinate = normalizeCoordinate({
    latitude: item?.geometry?.location?.lat,
    longitude: item?.geometry?.location?.lng,
  });
  const { title, subtitle } = splitAddress(item?.formatted_address, item?.name);

  return {
    providerPlaceId: String(item?.place_id || '').trim() || null,
    title: title || query || `Result ${index + 1}`,
    subtitle,
    coordinate,
    distanceKm: originCoordinate && coordinate ? calculateDistanceKm(originCoordinate, coordinate) : 0,
    context: {
      district: null,
      city: null,
      region: null,
      country: 'Zimbabwe',
    },
    rawPayload: item,
  };
}

export function hasGooglePlacesProvider() {
  return Boolean(getGoogleApiKey());
}

export async function fetchGooglePlaceAutocomplete({ query, originCoordinate }) {
  const normalizedQuery = normalizeQuery(query);
  const normalizedOrigin = normalizeCoordinate(originCoordinate) || BULAWAYO_CENTER_COORDINATE;

  if (normalizedQuery.length < 3) {
    return { suggestions: [], cacheHit: false };
  }

  const params = new URLSearchParams({
    query: normalizedQuery,
    key: getGoogleApiKey(),
    region: 'zw',
    language: 'en',
    location: `${normalizedOrigin.latitude},${normalizedOrigin.longitude}`,
    radius: String(SERVICE_AREA_BIAS_RADIUS_METERS),
  });

  const payload = await fetchJson(`${getGoogleBaseUrl()}/textsearch/json?${params.toString()}`);
  const suggestions = (Array.isArray(payload?.results) ? payload.results : [])
    .map((item, index) => mapTextSearchResult(item, index, normalizedQuery, normalizedOrigin))
    .filter((suggestion) => suggestion.coordinate && isCoordinateInBulawayoServiceArea(suggestion.coordinate))
    .slice(0, 6);

  return { suggestions, cacheHit: false };
}

export async function fetchGooglePlaceDetails({ placeId }) {
  const normalizedPlaceId = String(placeId || '').trim();
  if (!normalizedPlaceId) {
    const error = new Error('placeId is required');
    error.status = 400;
    throw error;
  }

  const params = new URLSearchParams({
    place_id: normalizedPlaceId,
    key: getGoogleApiKey(),
    language: 'en',
    fields: 'name,formatted_address,geometry',
  });

  const payload = await fetchJson(`${getGoogleBaseUrl()}/details/json?${params.toString()}`);
  const item = payload?.result || null;
  const coordinate = normalizeCoordinate({
    latitude: item?.geometry?.location?.lat,
    longitude: item?.geometry?.location?.lng,
  });

  if (!item || !coordinate) {
    const error = new Error('Place details did not include coordinates');
    error.status = 502;
    throw error;
  }
  if (!isCoordinateInBulawayoServiceArea(coordinate)) {
    const error = new Error('That place is outside the Bulawayo service area');
    error.status = 422;
    throw error;
  }

  const { title, subtitle } = splitAddress(item?.formatted_address, item?.name);
  return {
    place: {
      providerPlaceId: normalizedPlaceId,
      coordinate,
      title,
      subtitle,
      context: {
        district: null,
        city: null,
        region: null,
        country: 'Zimbabwe',
      },
      rawPayload: item,
    },
    cacheHit: false,
  };
}
