const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_CACHE_PRECISION = 4;
const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';

const routeCache = new Map();
const inFlightRequests = new Map();

function getOsrmBaseUrl() {
  return (
    process.env.OSRM_BASE_URL ||
    process.env.OSM_ROUTING_BASE_URL ||
    DEFAULT_OSRM_BASE_URL
  ).replace(/\/+$/, '');
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

function pruneCache() {
  while (routeCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodePolyline(encoded, precision = 5) {
  if (!encoded) return [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);

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
      latitude: latitude / factor,
      longitude: longitude / factor,
    });
  }

  return coordinates;
}

function mapOsrmInstruction(step) {
  const maneuver = step?.maneuver;
  if (!maneuver) return '';
  const modifier = maneuver.modifier ? ` ${maneuver.modifier}` : '';
  const road = step?.name ? ` onto ${step.name}` : '';
  return stripHtml(`${maneuver.type || 'Continue'}${modifier}${road}`);
}

export function hasOsmDirectionsProvider() {
  return Boolean(getOsrmBaseUrl());
}

export async function fetchCachedOsmDirections({
  origin,
  destination,
  includeTraffic = false,
  cachePrecision,
  cacheTtlSeconds,
}) {
  const normalizedOrigin = normalizeCoordinate(origin);
  const normalizedDestination = normalizeCoordinate(destination);

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
  const cached = routeCache.get(cacheKey);
  if (cached && (Date.now() - cached.createdAt) < ttlMs) {
    return { ...cloneRoute(cached.route), cacheHit: true };
  }
  if (cached) routeCache.delete(cacheKey);

  if (inFlightRequests.has(cacheKey)) {
    const route = await inFlightRequests.get(cacheKey);
    return { ...cloneRoute(route), cacheHit: true };
  }

  const requestPromise = (async () => {
    const baseUrl = getOsrmBaseUrl();
    const coordinates = `${normalizedOrigin.longitude},${normalizedOrigin.latitude};${normalizedDestination.longitude},${normalizedDestination.latitude}`;
    const params = new URLSearchParams({
      overview: 'full',
      geometries: 'polyline',
      steps: 'true',
    });

    const response = await fetch(`${baseUrl}/route/v1/driving/${coordinates}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TrustCars/1.0',
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload?.message || `OSRM directions request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    if (payload?.code !== 'Ok' || !Array.isArray(payload?.routes) || !payload.routes[0]) {
      const error = new Error(payload?.message || 'No OSRM route found');
      error.status = 502;
      throw error;
    }

    const osrmRoute = payload.routes[0];
    const firstLeg = osrmRoute.legs?.[0] || null;
    const polyline = String(osrmRoute.geometry || '').trim();
    const distanceMeters = Number(osrmRoute.distance || 0);
    const durationSeconds = Number(osrmRoute.duration || 0);
    const route = {
      polyline,
      coordinates: decodePolyline(polyline),
      distanceMeters,
      durationSeconds,
      distanceKm: distanceMeters > 0 ? distanceMeters / 1000 : null,
      durationMinutes: durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null,
      nextInstruction: mapOsrmInstruction(firstLeg?.steps?.[0]),
      includeTraffic: false,
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
