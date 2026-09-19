import { query } from '../db/connection.js';

export const BULAWAYO_SERVICE_BOUNDS = {
  west: 28.35,
  south: -20.32,
  east: 28.78,
  north: -19.82,
};

export const GWERU_SERVICE_BOUNDS = {
  west: 29.62,
  south: -19.62,
  east: 30.03,
  north: -19.28,
};

export const BULAWAYO_GEO_LOCK_ENABLED =
  String(process.env.TRUST_ENABLE_BULAWAYO_GEO_LOCK ?? 'true').toLowerCase() !== 'false';

export const SERVICE_AREA_LABEL = 'Bulawayo and Gweru';

export const TRUST_EXPRESS_SERVICE_AREAS = [
  {
    key: 'bulawayo',
    label: 'Bulawayo',
    bounds: BULAWAYO_SERVICE_BOUNDS,
    centerCoordinate: {
      latitude: -20.1535,
      longitude: 28.5870,
    },
  },
  {
    key: 'gweru',
    label: 'Gweru',
    bounds: GWERU_SERVICE_BOUNDS,
    centerCoordinate: {
      latitude: -19.4516,
      longitude: 29.8164,
    },
  },
];

const SERVICE_AREA_CACHE_TTL_MS = 60 * 1000;
let serviceAreasCache = null;
let serviceAreasCacheLoadedAt = 0;

export const BULAWAYO_SERVICE_BOUNDS_ARRAY = [
  Math.min(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.west)),
  Math.min(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.south)),
  Math.max(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.east)),
  Math.max(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.north)),
];

export const BULAWAYO_CENTER_COORDINATE = {
  latitude: -20.1535,
  longitude: 28.5870,
};

export function getServiceAreaForCoordinate(coordinate) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return true;

  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return TRUST_EXPRESS_SERVICE_AREAS.find((area) => (
    latitude >= area.bounds.south &&
    latitude <= area.bounds.north &&
    longitude >= area.bounds.west &&
    longitude <= area.bounds.east
  )) || null;
}

function mapServiceAreaRow(row) {
  return {
    id: row.id,
    key: row.area_key,
    label: row.label,
    countryCode: row.country_code || 'ZW',
    bounds: {
      west: Number(row.west_lng),
      south: Number(row.south_lat),
      east: Number(row.east_lng),
      north: Number(row.north_lat),
    },
    centerCoordinate: {
      latitude: Number(row.center_lat),
      longitude: Number(row.center_lng),
    },
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 0),
  };
}

export function clearServiceAreaCache() {
  serviceAreasCache = null;
  serviceAreasCacheLoadedAt = 0;
}

export async function listActiveServiceAreas({ force = false } = {}) {
  if (
    !force &&
    serviceAreasCache &&
    Date.now() - serviceAreasCacheLoadedAt < SERVICE_AREA_CACHE_TTL_MS
  ) {
    return serviceAreasCache;
  }

  try {
    const rows = await query(
      `SELECT id, area_key, label, country_code, center_lat, center_lng,
              west_lng, south_lat, east_lng, north_lat, is_active, sort_order
       FROM service_areas
       WHERE is_active = 1
       ORDER BY sort_order ASC, label ASC, id ASC`
    );
    const areas = rows.map(mapServiceAreaRow).filter((area) => (
      Number.isFinite(area.centerCoordinate.latitude) &&
      Number.isFinite(area.centerCoordinate.longitude) &&
      Number.isFinite(area.bounds.west) &&
      Number.isFinite(area.bounds.south) &&
      Number.isFinite(area.bounds.east) &&
      Number.isFinite(area.bounds.north)
    ));
    serviceAreasCache = areas.length ? areas : TRUST_EXPRESS_SERVICE_AREAS;
  } catch (error) {
    console.warn('[service-area] using fallback service areas', error?.message || error);
    serviceAreasCache = TRUST_EXPRESS_SERVICE_AREAS;
  }
  serviceAreasCacheLoadedAt = Date.now();
  return serviceAreasCache;
}

export async function listPublicServiceAreas() {
  const areas = await listActiveServiceAreas();
  return areas.map((area) => ({
    key: area.key,
    label: area.label,
    countryCode: area.countryCode || 'ZW',
    bounds: area.bounds,
    centerCoordinate: area.centerCoordinate,
    sortOrder: area.sortOrder,
  }));
}

export async function getServiceAreaLabel() {
  const areas = await listActiveServiceAreas();
  const labels = areas.map((area) => area.label).filter(Boolean);
  if (!labels.length) return SERVICE_AREA_LABEL;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export async function getServiceAreaForCoordinateFromDb(coordinate) {
  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const areas = await listActiveServiceAreas();
  return areas.find((area) => (
    latitude >= area.bounds.south &&
    latitude <= area.bounds.north &&
    longitude >= area.bounds.west &&
    longitude <= area.bounds.east
  )) || null;
}

export async function isCoordinateInServiceAreaFromDb(coordinate) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return true;
  return Boolean(await getServiceAreaForCoordinateFromDb(coordinate));
}

export async function filterSuggestionsInServiceArea(suggestions = []) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return Array.isArray(suggestions) ? suggestions : [];
  const areas = await listActiveServiceAreas();
  return (Array.isArray(suggestions) ? suggestions : []).filter((suggestion) => {
    if (!suggestion?.coordinate) return true;
    const latitude = Number(suggestion.coordinate.latitude);
    const longitude = Number(suggestion.coordinate.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return areas.some((area) => (
      latitude >= area.bounds.south &&
      latitude <= area.bounds.north &&
      longitude >= area.bounds.west &&
      longitude <= area.bounds.east
    ));
  });
}

export async function getCombinedServiceBoundsArray() {
  const areas = await listActiveServiceAreas();
  return [
    Math.min(...areas.map((area) => area.bounds.west)),
    Math.min(...areas.map((area) => area.bounds.south)),
    Math.max(...areas.map((area) => area.bounds.east)),
    Math.max(...areas.map((area) => area.bounds.north)),
  ];
}

export function isCoordinateInServiceArea(coordinate) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return true;
  return Boolean(getServiceAreaForCoordinate(coordinate));
}

export function isCoordinateInBulawayoServiceArea(coordinate) {
  return isCoordinateInServiceArea(coordinate);
}

export function filterBulawayoSuggestions(suggestions = []) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return Array.isArray(suggestions) ? suggestions : [];

  return (Array.isArray(suggestions) ? suggestions : []).filter((suggestion) => {
    if (!suggestion?.coordinate) return true;
    return isCoordinateInServiceArea(suggestion.coordinate);
  });
}
