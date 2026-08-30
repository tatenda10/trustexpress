function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

export function normalizeCoordinate(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function normalizeCoordinates(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeCoordinate).filter(Boolean);
}

export function normalizeHeading(value) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

export function calculateDistanceKm(start, end) {
  const from = normalizeCoordinate(start);
  const to = normalizeCoordinate(end);
  if (!from || !to) return 0;
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

/** Bearing in degrees (0 = north, 90 = east) from `from` toward `to`. */
export function calculateBearingDegrees(from, to) {
  const start = normalizeCoordinate(from);
  const end = normalizeCoordinate(to);
  if (!start || !end) return 0;
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const dLng = toRadians(end.longitude - start.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeHeading(toDegrees(Math.atan2(y, x)));
}

function findNearestRouteIndex(routeCoordinates, coordinate) {
  const safeCoordinate = normalizeCoordinate(coordinate);
  const safeRouteCoordinates = normalizeCoordinates(routeCoordinates);
  if (!safeCoordinate || !safeRouteCoordinates.length) return -1;

  let nearestIndex = 0;
  let nearestDistance = Infinity;
  safeRouteCoordinates.forEach((routeCoordinate, index) => {
    const distanceMeters = calculateDistanceKm(routeCoordinate, safeCoordinate) * 1000;
    if (distanceMeters < nearestDistance) {
      nearestDistance = distanceMeters;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

export function getHeadingAlongRoute(routeCoordinates, currentCoordinate, fallbackTarget) {
  const current = normalizeCoordinate(currentCoordinate);
  const route = normalizeCoordinates(routeCoordinates);
  if (!current) return null;

  if (route.length >= 2) {
    const nearestIndex = findNearestRouteIndex(route, current);

    for (let index = Math.max(0, nearestIndex); index < route.length; index += 1) {
      const ahead = route[index];
      if (calculateDistanceKm(current, ahead) >= 0.015) {
        return calculateBearingDegrees(current, ahead);
      }
    }

    const segmentStart = route[Math.max(0, nearestIndex - 1)];
    const segmentEnd = route[Math.min(nearestIndex + 1, route.length - 1)];
    if (segmentStart && segmentEnd) {
      const segmentBearing = calculateBearingDegrees(segmentStart, segmentEnd);
      if (calculateDistanceKm(segmentStart, segmentEnd) >= 0.003) {
        return segmentBearing;
      }
    }
  }

  const target = normalizeCoordinate(fallbackTarget);
  if (target && calculateDistanceKm(current, target) >= 0.003) {
    return calculateBearingDegrees(current, target);
  }

  return null;
}

export function resolveVehicleHeading({
  currentCoordinate,
  previousCoordinate,
  routeCoordinates,
  fallbackTarget,
  fallbackHeading = 0,
}) {
  const current = normalizeCoordinate(currentCoordinate);
  if (!current) return normalizeHeading(fallbackHeading);

  const previous = normalizeCoordinate(previousCoordinate);
  if (previous) {
    const movedKm = calculateDistanceKm(previous, current);
    if (movedKm >= 0.004) {
      return calculateBearingDegrees(previous, current);
    }
  }

  const routeHeading = getHeadingAlongRoute(routeCoordinates, current, fallbackTarget);
  if (routeHeading !== null) return routeHeading;

  return normalizeHeading(fallbackHeading);
}

export function smoothHeadingDegrees(currentHeading, nextHeading, maxStep = 20) {
  const current = normalizeHeading(currentHeading);
  const next = normalizeHeading(nextHeading);
  let delta = ((next - current + 540) % 360) - 180;
  if (Math.abs(delta) <= maxStep) return next;
  return normalizeHeading(current + Math.sign(delta) * maxStep);
}
