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
  String(process.env.EXPO_PUBLIC_ENABLE_BULAWAYO_GEO_LOCK ?? 'true').toLowerCase() !== 'false';

export let SERVICE_AREA_LABEL = 'Bulawayo and Gweru';

export let TRUST_EXPRESS_SERVICE_AREAS = [
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

export let BULAWAYO_SERVICE_BOUNDS_ARRAY = [
  Math.min(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.west)),
  Math.min(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.south)),
  Math.max(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.east)),
  Math.max(...TRUST_EXPRESS_SERVICE_AREAS.map((area) => area.bounds.north)),
];

export const BULAWAYO_CENTER_COORDINATE = {
  latitude: -20.1535,
  longitude: 28.5870,
};

function buildServiceLabel(areas) {
  const labels = areas.map((area) => area.label).filter(Boolean);
  if (!labels.length) return 'our active service areas';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function buildBoundsArray(areas) {
  return [
    Math.min(...areas.map((area) => area.bounds.west)),
    Math.min(...areas.map((area) => area.bounds.south)),
    Math.max(...areas.map((area) => area.bounds.east)),
    Math.max(...areas.map((area) => area.bounds.north)),
  ];
}

export function configureServiceAreas(areas = []) {
  const nextAreas = (Array.isArray(areas) ? areas : [])
    .map((area) => ({
      key: String(area.key || area.areaKey || area.label || '').trim().toLowerCase(),
      label: String(area.label || area.name || '').trim(),
      bounds: {
        west: Number(area.bounds?.west ?? area.westLng ?? area.west),
        south: Number(area.bounds?.south ?? area.southLat ?? area.south),
        east: Number(area.bounds?.east ?? area.eastLng ?? area.east),
        north: Number(area.bounds?.north ?? area.northLat ?? area.north),
      },
      centerCoordinate: {
        latitude: Number(area.centerCoordinate?.latitude ?? area.centerLat ?? area.centerLatitude),
        longitude: Number(area.centerCoordinate?.longitude ?? area.centerLng ?? area.centerLongitude),
      },
    }))
    .filter((area) => (
      area.label &&
      Number.isFinite(area.bounds.west) &&
      Number.isFinite(area.bounds.south) &&
      Number.isFinite(area.bounds.east) &&
      Number.isFinite(area.bounds.north) &&
      Number.isFinite(area.centerCoordinate.latitude) &&
      Number.isFinite(area.centerCoordinate.longitude)
    ));

  if (!nextAreas.length) return TRUST_EXPRESS_SERVICE_AREAS;
  TRUST_EXPRESS_SERVICE_AREAS = nextAreas;
  BULAWAYO_SERVICE_BOUNDS_ARRAY = buildBoundsArray(nextAreas);
  SERVICE_AREA_LABEL = buildServiceLabel(nextAreas);
  return TRUST_EXPRESS_SERVICE_AREAS;
}

export const BULAWAYO_DEFAULT_REGION = {
  ...BULAWAYO_CENTER_COORDINATE,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

export function getServiceAreaForCoordinate(coordinate) {
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
