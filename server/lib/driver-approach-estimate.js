import { fetchCachedDirections } from './maps-directions.js';

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function straightLineDistanceKm(start, end) {
  if (!start || !end) return 0;
  const earthRadiusKm = 6371;
  const dLat = toRadians(end.latitude - start.latitude);
  const dLng = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function getDriverApproachEstimate(driverCoordinate, pickupCoordinate) {
  const fallbackDistanceKm = straightLineDistanceKm(driverCoordinate, pickupCoordinate);
  const fallback = {
    distanceKm: Number(fallbackDistanceKm.toFixed(2)),
    etaMinutes: Math.max(1, Math.round(fallbackDistanceKm * 4)),
    source: 'straight_line_fallback',
  };
  if (!driverCoordinate || !pickupCoordinate) return fallback;

  try {
    const route = await fetchCachedDirections({
      origin: driverCoordinate,
      destination: pickupCoordinate,
      includeTraffic: true,
      cachePrecision: 3,
      cacheTtlSeconds: 120,
    });
    const distanceKm = Number(route?.distanceKm || 0);
    const etaMinutes = Number(route?.durationMinutes || 0);
    if (!(distanceKm > 0) || !(etaMinutes > 0)) return fallback;
    return {
      distanceKm: Number(distanceKm.toFixed(2)),
      etaMinutes: Math.max(1, Math.round(etaMinutes)),
      source: route?.fallback ? 'road_fallback' : 'road_route',
    };
  } catch {
    return fallback;
  }
}
