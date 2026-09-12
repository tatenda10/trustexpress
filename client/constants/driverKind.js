import AsyncStorage from '@react-native-async-storage/async-storage';

export const DRIVER_KIND_STANDARD = 'standard';
export const DRIVER_KIND_TRUCK = 'truck';

export function getPendingDriverKindStorageKey(userId) {
  return `trust_express_pending_driver_kind:${userId || 'guest'}`;
}

export async function readPendingDriverKind(userId) {
  try {
    const value = await AsyncStorage.getItem(getPendingDriverKindStorageKey(userId));
    return normalizeDriverKind(value);
  } catch {
    return null;
  }
}

export async function writePendingDriverKind(userId, value) {
  const kind = normalizeDriverKind(value);
  if (!kind) return null;
  await AsyncStorage.setItem(getPendingDriverKindStorageKey(userId), kind);
  return kind;
}

export async function clearPendingDriverKind(userId) {
  try {
    await AsyncStorage.removeItem(getPendingDriverKindStorageKey(userId));
  } catch {
    // Ignore cache cleanup failures.
  }
}

export function normalizeDriverKind(value, fallback = null) {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === DRIVER_KIND_TRUCK) return DRIVER_KIND_TRUCK;
  if (kind === DRIVER_KIND_STANDARD || kind === 'normal' || kind === 'car') {
    return DRIVER_KIND_STANDARD;
  }
  return fallback;
}

export function resolveDriverKind(driverMe, fallback = null) {
  return normalizeDriverKind(
    driverMe?.driverProfile?.driverKind || driverMe?.driverKind || fallback
  );
}

export function applyDriverKindToStatus(driverMe, kind) {
  const resolved = resolveDriverKind(driverMe, kind);
  if (!driverMe || typeof driverMe !== 'object') {
    return resolved ? { driverKind: resolved, driverProfile: { driverKind: resolved } } : driverMe;
  }
  if (!resolved) return driverMe;
  return {
    ...driverMe,
    driverKind: resolved,
    driverProfile: {
      ...(driverMe.driverProfile || {}),
      driverKind: resolved,
    },
  };
}

export async function mergePendingDriverKind(driverMe, userId) {
  const pendingKind = await readPendingDriverKind(userId);
  return applyDriverKindToStatus(driverMe, pendingKind);
}

export function isTruckDriver(driverMe, fallback = null) {
  return resolveDriverKind(driverMe, fallback) === DRIVER_KIND_TRUCK;
}

export function getDriverVehicleRoute(driverMe, fallback = null) {
  return isTruckDriver(driverMe, fallback) ? 'DriverRegisterTruck' : 'DriverRegisterCar';
}

export const TRUCK_VEHICLE_CATEGORIES = [
  { value: 'truck', label: 'Truck' },
  { value: 'lorry', label: 'Lorry' },
  { value: 'moving_van', label: 'Moving van' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'sprinter', label: 'Sprinter' },
  { value: 'iveco', label: 'Iveco' },
  { value: 'hiace', label: 'Hiace' },
  { value: 'bus', label: 'Bus' },
  { value: 'other', label: 'Other' },
];
