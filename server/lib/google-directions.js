const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_CACHE_PRECISION = 4;

const routeCache = new Map();
const inFlightRequests = new Map();

function getDirectionsApiKey() {
  return (
    process.env.GOOGLE_MAPS_DIRECTIONS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_DIRECTIONS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.ANDROID_GOOGLE_MAPS_API_KEY ||
    process.env.IOS_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

function normalizeCoordinate(coordinate) {
  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function clampPrecision(value) {
  const precision = Number(value);
  if (!Number.isInteger(precision)) return DEFAULT_CACHE_PRECISION;
  return Math.min(Math.max(precision, 3), 5);
}

function clampCacheTtlMs(value) {
  const ttlSeconds = Number(value);
  if (!Number.isFinite(ttlSeconds)) return DEFAULT_CACHE_TTL_MS;
  return Math.min(Math.max(ttlSeconds * 1000, 60 * 1000), 24 * 60 * 60 * 1000);
}

function coordinateKey(coordinate, precision) {
  return `${coordinate.latitude.toFixed(precision)},${coordinate.longitude.toFixed(precision)}`;
}

function routeCacheKey({ origin, destination, includeTraffic, cachePrecision }) {
  const precision = clampPrecision(cachePrecision);
  return [
    'driving',
    includeTraffic ? 'traffic' : 'standard',
    coordinateKey(origin, precision),
    coordinateKey(destination, precision),
  ].join('|');
}

function cloneRoute(route) {
  if (!route) return route;
  return {
    ...route,
    coordinates: Array.isArray(route.coordinates)
      ? route.coordinates.map((coordinate) => ({ ...coordinate }))
      : [],
  };
}

function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    latitude += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    longitude += deltaLng;

    coordinates.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return coordinates;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pruneCache() {
  while (routeCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }
}

export function hasGoogleDirectionsApiKey() {
  return Boolean(getDirectionsApiKey());
}

export async function fetchCachedGoogleDirections({
  origin,
  destination,
  includeTraffic = false,
  cachePrecision,
  cacheTtlSeconds,
}) {
  const apiKey = getDirectionsApiKey();
  const normalizedOrigin = normalizeCoordinate(origin);
  const normalizedDestination = normalizeCoordinate(destination);

  if (!apiKey) {
    const error = new Error('Google Directions API key is not configured');
    error.status = 503;
    throw error;
  }
  if (!normalizedOrigin || !normalizedDestination) {
    const error = new Error('Valid origin and destination coordinates are required');
    error.status = 400;
    throw error;
  }

  const ttlMs = clampCacheTtlMs(cacheTtlSeconds);
  const cacheKey = routeCacheKey({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    includeTraffic,
    cachePrecision,
  });
  const now = Date.now();
  const cached = routeCache.get(cacheKey);

  if (cached && now - cached.createdAt <= ttlMs) {
    return { ...cloneRoute(cached.route), cacheHit: true };
  }
  if (cached) routeCache.delete(cacheKey);

  if (inFlightRequests.has(cacheKey)) {
    const route = await inFlightRequests.get(cacheKey);
    return { ...cloneRoute(route), cacheHit: true };
  }

  const requestPromise = (async () => {
    const params = new URLSearchParams({
      origin: `${normalizedOrigin.latitude},${normalizedOrigin.longitude}`,
      destination: `${normalizedDestination.latitude},${normalizedDestination.longitude}`,
      mode: 'driving',
      key: apiKey,
    });

    if (includeTraffic) {
      params.set('departure_time', 'now');
    }

    const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload?.error_message || `Directions request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    if (payload?.status !== 'OK' || !Array.isArray(payload?.routes) || !payload.routes[0]) {
      const error = new Error(payload?.error_message || 'No Google route found');
      error.status = 502;
      throw error;
    }

    const googleRoute = payload.routes[0];
    const leg = googleRoute.legs?.[0];
    const distanceMeters = Number(leg?.distance?.value || 0);
    const durationSeconds = Number(
      includeTraffic
        ? (leg?.duration_in_traffic?.value || leg?.duration?.value || 0)
        : (leg?.duration?.value || 0)
    );
    const polyline = googleRoute.overview_polyline?.points || '';

    const route = {
      polyline,
      coordinates: decodePolyline(polyline),
      distanceMeters,
      durationSeconds,
      distanceKm: distanceMeters > 0 ? distanceMeters / 1000 : null,
      durationMinutes: durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null,
      nextInstruction: stripHtml(leg?.steps?.[0]?.html_instructions || ''),
      includeTraffic: Boolean(includeTraffic),
    };

    routeCache.set(cacheKey, { createdAt: Date.now(), route });
    pruneCache();

    return route;
  })();

  inFlightRequests.set(cacheKey, requestPromise);

  try {
    const route = await requestPromise;
    return { ...cloneRoute(route), cacheHit: false };
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
