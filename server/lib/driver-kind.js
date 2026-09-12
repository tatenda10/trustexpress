export const DRIVER_KIND_STANDARD = 'standard';
export const DRIVER_KIND_TRUCK = 'truck';

export function normalizeDriverKind(value, fallback = null) {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === DRIVER_KIND_TRUCK) return DRIVER_KIND_TRUCK;
  if (kind === DRIVER_KIND_STANDARD || kind === 'normal' || kind === 'car') {
    return DRIVER_KIND_STANDARD;
  }
  return fallback;
}

export function isTruckDriver(profileOrKind) {
  if (typeof profileOrKind === 'string') {
    return normalizeDriverKind(profileOrKind) === DRIVER_KIND_TRUCK;
  }
  return normalizeDriverKind(profileOrKind?.driverKind || profileOrKind?.driver_kind) === DRIVER_KIND_TRUCK;
}
