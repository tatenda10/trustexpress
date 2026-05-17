export const BULAWAYO_SERVICE_BOUNDS = {
  west: 28.35,
  south: -20.32,
  east: 28.78,
  north: -19.82,
};

export const BULAWAYO_GEO_LOCK_ENABLED =
  String(process.env.TRUST_ENABLE_BULAWAYO_GEO_LOCK ?? 'true').toLowerCase() !== 'false';

export const BULAWAYO_SERVICE_BOUNDS_ARRAY = [
  BULAWAYO_SERVICE_BOUNDS.west,
  BULAWAYO_SERVICE_BOUNDS.south,
  BULAWAYO_SERVICE_BOUNDS.east,
  BULAWAYO_SERVICE_BOUNDS.north,
];

export const BULAWAYO_CENTER_COORDINATE = {
  latitude: -20.1535,
  longitude: 28.5870,
};

export function isCoordinateInBulawayoServiceArea(coordinate) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return true;

  const latitude = Number(coordinate?.latitude);
  const longitude = Number(coordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  return (
    latitude >= BULAWAYO_SERVICE_BOUNDS.south &&
    latitude <= BULAWAYO_SERVICE_BOUNDS.north &&
    longitude >= BULAWAYO_SERVICE_BOUNDS.west &&
    longitude <= BULAWAYO_SERVICE_BOUNDS.east
  );
}

export function filterBulawayoSuggestions(suggestions = []) {
  if (!BULAWAYO_GEO_LOCK_ENABLED) return Array.isArray(suggestions) ? suggestions : [];

  return (Array.isArray(suggestions) ? suggestions : []).filter((suggestion) => {
    if (!suggestion?.coordinate) return true;
    return isCoordinateInBulawayoServiceArea(suggestion.coordinate);
  });
}
