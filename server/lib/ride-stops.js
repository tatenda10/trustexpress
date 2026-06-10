const MAX_INTERMEDIATE_STOPS = 2;

function normalizeCoordinate(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export function sanitizeIntermediateStops(values, maxStops = MAX_INTERMEDIATE_STOPS) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, maxStops)
    .map((item, index) => {
      const coordinate = normalizeCoordinate(item?.coordinate || item);
      const label = String(item?.label || item?.title || `Stop ${index + 1}`).trim();
      if (!coordinate || !label) return null;
      return {
        orderIndex: index,
        label,
        coordinate,
      };
    })
    .filter(Boolean);
}

export function parseIntermediateStops(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    return sanitizeIntermediateStops(parsed);
  } catch {
    return [];
  }
}

export function stringifyIntermediateStops(stops) {
  return JSON.stringify(
    sanitizeIntermediateStops(stops).map((stop) => ({
      label: stop.label,
      coordinate: stop.coordinate,
      orderIndex: stop.orderIndex,
    })),
  );
}

export function clampCurrentStopIndex(value, stopsLength) {
  const nextValue = Number.isInteger(Number(value)) ? Number(value) : 0;
  return Math.max(0, Math.min(nextValue, Math.max(0, stopsLength)));
}

export function buildRideStopsPayload(ride) {
  const intermediateStops = parseIntermediateStops(ride?.intermediate_stops_json);
  const currentStopIndex = clampCurrentStopIndex(ride?.current_stop_index, intermediateStops.length);
  const currentIntermediateStop = intermediateStops[currentStopIndex] || null;
  const finalDropoffCoordinate =
    ride?.dropoffCoordinate ||
    (
      ride?.dropoff_lat !== undefined && ride?.dropoff_lng !== undefined
        ? {
            latitude: Number(ride.dropoff_lat),
            longitude: Number(ride.dropoff_lng),
          }
        : null
    );

  return {
    intermediateStops,
    currentStopIndex,
    remainingIntermediateStopsCount: Math.max(0, intermediateStops.length - currentStopIndex),
    currentIntermediateStop,
    currentTargetLabel: currentIntermediateStop?.label || ride?.dropoff_label || ride?.dropoffLabel || null,
    currentTargetCoordinate: currentIntermediateStop?.coordinate || finalDropoffCoordinate || null,
  };
}

export function getMaxIntermediateStops() {
  return MAX_INTERMEDIATE_STOPS;
}
