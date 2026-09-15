import { normalizeCoordinate, normalizeCoordinates } from './mapVehicleHeading';

export const PASSENGER_RIDE_MAP_MIN_DELTA = 0.008;
export const PASSENGER_RIDE_MAP_MAX_DELTA = 0.05;
export const PASSENGER_RIDE_MAP_BOOKING_MAX_DELTA = 0.1;
export const PASSENGER_RIDE_MAP_REFIT_MOVE_METERS = 70;

function toCoordinate(value) {
  return normalizeCoordinate(value)
    || (() => {
      const latitude = Number(value?.latitude ?? value?.lat);
      const longitude = Number(value?.longitude ?? value?.lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    })();
}

export function collectPassengerRideMapCoordinates(values = []) {
  return values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      return [value];
    })
    .map(toCoordinate)
    .filter(Boolean);
}

export function buildPassengerRideMapRegion(coordinates, {
  minDelta = PASSENGER_RIDE_MAP_MIN_DELTA,
  maxDelta = PASSENGER_RIDE_MAP_MAX_DELTA,
  padding = 1.85,
  fallback = null,
} = {}) {
  const points = collectPassengerRideMapCoordinates(coordinates);
  if (points.length === 0) return fallback;

  if (points.length === 1) {
    return {
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      latitudeDelta: minDelta,
      longitudeDelta: minDelta,
    };
  }

  const latitudes = points.map((item) => item.latitude);
  const longitudes = points.map((item) => item.longitude);
  const latSpan = Math.max(...latitudes) - Math.min(...latitudes);
  const lngSpan = Math.max(...longitudes) - Math.min(...longitudes);

  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    latitudeDelta: Math.min(maxDelta, Math.max(latSpan * padding, minDelta)),
    longitudeDelta: Math.min(maxDelta, Math.max(lngSpan * padding, minDelta)),
  };
}

export function sampleCoordinatesForFit(coordinates, maxPoints = 24) {
  const points = normalizeCoordinates(coordinates);
  if (points.length <= maxPoints) return points;
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

export function getPassengerTrackingFitCoordinates(liveRouteCoordinates, driverCoordinate, targetCoordinate) {
  const safeDriver = normalizeCoordinate(driverCoordinate);
  const safeTarget = normalizeCoordinate(targetCoordinate);
  const safeRoute = sampleCoordinatesForFit(liveRouteCoordinates);
  if (safeRoute.length > 1) {
    return [safeDriver, ...safeRoute, safeTarget].filter(Boolean);
  }
  return [safeDriver, safeTarget].filter(Boolean);
}
