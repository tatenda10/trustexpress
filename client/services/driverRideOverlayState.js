const listeners = new Set();

let dismissedRideRequestIds = new Set();
let pendingOverlayRideRequest = null;
let desiredVariant = 'online';

function notify() {
  const snapshot = getDriverRideOverlayState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (_) {}
  });
}

export function getDriverRideOverlayState() {
  return {
    dismissedRideRequestIds: Array.from(dismissedRideRequestIds),
    pendingOverlayRideRequest,
    desiredVariant,
  };
}

export function subscribeDriverRideOverlayState(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isRideRequestDismissed(rideRequestId) {
  const id = Number(rideRequestId);
  if (!Number.isInteger(id) || id <= 0) return false;
  return dismissedRideRequestIds.has(id);
}

export function markRideRequestDismissed(rideRequestId) {
  const id = Number(rideRequestId);
  if (!Number.isInteger(id) || id <= 0) return getDriverRideOverlayState();
  dismissedRideRequestIds.add(id);
  if (Number(pendingOverlayRideRequest?.id || 0) === id) {
    pendingOverlayRideRequest = null;
    desiredVariant = 'online';
  }
  notify();
  return getDriverRideOverlayState();
}

export function setOverlayRideRequest(request) {
  const id = Number(request?.id || request?.rideRequestId || 0);
  if (!Number.isInteger(id) || id <= 0 || dismissedRideRequestIds.has(id)) {
    return getDriverRideOverlayState();
  }

  pendingOverlayRideRequest = {
    id,
    pickupLabel: request?.pickupLabel || request?.pickup || '',
    dropoffLabel: request?.dropoffLabel || request?.dropoff || '',
    estimatedAmount: Number(request?.estimatedAmount || 0),
    tierName: request?.tierName || 'Ride',
    passengerName: request?.passengerName || 'Passenger',
    expiresAt: request?.expiresAt || null,
    remainingSeconds: request?.remainingSeconds ?? null,
  };
  desiredVariant = 'request';
  notify();
  return getDriverRideOverlayState();
}

export function clearOverlayRideRequest({ keepDismissed = true } = {}) {
  pendingOverlayRideRequest = null;
  desiredVariant = 'online';
  if (!keepDismissed) {
    dismissedRideRequestIds = new Set();
  }
  notify();
  return getDriverRideOverlayState();
}

export function filterActiveRideRequests(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const id = Number(request?.id || 0);
    return Number.isInteger(id) && id > 0 && !dismissedRideRequestIds.has(id);
  });
}
