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

export function restoreRideRequestDismissal(rideRequestId) {
  const id = Number(rideRequestId);
  if (!Number.isInteger(id) || id <= 0) return getDriverRideOverlayState();
  if (dismissedRideRequestIds.has(id)) {
    dismissedRideRequestIds.delete(id);
    notify();
  }
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

export function getRideRequestRemainingSeconds(request) {
  const serverRemaining = Number(request?.remainingSeconds);
  const capturedAt = Number(request?.remainingSecondsCapturedAt);
  if (Number.isFinite(serverRemaining) && serverRemaining >= 0) {
    if (!Number.isFinite(capturedAt)) return Math.max(0, Math.floor(serverRemaining));
    const elapsed = Math.max(0, Math.floor((Date.now() - capturedAt) / 1000));
    return Math.max(0, Math.floor(serverRemaining) - elapsed);
  }
  if (!request?.expiresAt) return 0;
  const expiresMs = new Date(request.expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return 0;
  return Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000));
}

export function filterActiveRideRequests(requests = [], { minSeconds = 1 } = {}) {
  const minRemaining = Math.max(1, Number(minSeconds) || 1);
  return (Array.isArray(requests) ? requests : []).filter((request) => {
    const id = Number(request?.id || 0);
    if (!Number.isInteger(id) || id <= 0 || dismissedRideRequestIds.has(id)) return false;
    return getRideRequestRemainingSeconds(request) >= minRemaining;
  });
}
