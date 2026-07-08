const PASSENGER_REASON_LABELS = new Set([
  'found another ride',
  'wrong destination entered',
  'driver too far / long wait',
  'change of plans',
  'booking mistake',
  'emergency',
  'other',
  'passenger cancelled',
]);

const DRIVER_REASON_LABELS = new Set([
  'passenger no-show',
  'passenger requested cancellation',
  'wrong pickup/drop-off location',
  'safety concern',
  'vehicle issue',
  'personal emergency',
  'pickup too far',
  'other',
  'driver cancelled',
]);

export function normalizeCancelledBy(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  if (key === 'driver' || key === 'passenger' || key === 'system') return key;
  return null;
}

export function inferCancelledBy({ cancelledBy, status, cancellationReason } = {}) {
  const explicit = normalizeCancelledBy(cancelledBy);
  if (explicit) return explicit;

  const rideStatus = String(status || '')
    .trim()
    .toLowerCase();
  if (rideStatus === 'expired') return 'system';

  const reason = String(cancellationReason || '')
    .trim()
    .toLowerCase();
  if (!reason) return null;

  if (reason.includes('no driver accepted') || reason.includes('expired')) return 'system';
  if (reason.includes('passenger cancelled') || reason.startsWith('passenger ')) return 'passenger';
  if (reason.includes('driver cancelled') || reason.startsWith('driver ')) return 'driver';

  if (PASSENGER_REASON_LABELS.has(reason) && !DRIVER_REASON_LABELS.has(reason)) return 'passenger';
  if (DRIVER_REASON_LABELS.has(reason) && !PASSENGER_REASON_LABELS.has(reason)) return 'driver';

  // Shared labels like "other" / "emergency" can't be inferred safely.
  return null;
}

export function formatCancelledByLabel(cancelledBy) {
  const key = normalizeCancelledBy(cancelledBy);
  if (key === 'driver') return 'Driver';
  if (key === 'passenger') return 'Passenger';
  if (key === 'system') return 'System / timeout';
  return 'Unknown';
}
