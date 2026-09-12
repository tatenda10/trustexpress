export const DEFAULT_INTERCITY_DISTANCE_KM = 80;

export const HIRE_VEHICLE_CATEGORIES = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'van', label: 'Van' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'sprinter', label: 'Sprinter' },
  { value: 'iveco', label: 'Iveco' },
  { value: 'hiace', label: 'Hiace' },
  { value: 'eighteen_seater_plus', label: '18-seater+' },
  { value: 'bus', label: 'Bus' },
  { value: 'moving_van', label: 'Moving van' },
  { value: 'truck', label: 'Truck' },
  { value: 'lorry', label: 'Lorry' },
  { value: 'other', label: 'Other' },
];

export const HIRE_CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  ...HIRE_VEHICLE_CATEGORIES.filter((item) => item.value !== 'other'),
];

export const LIVE_HIRE_BOOKING_STATUSES = ['confirmed', 'driver_arrived', 'in_progress'];

export function isLiveHireBooking(status) {
  return LIVE_HIRE_BOOKING_STATUSES.includes(String(status || '').toLowerCase());
}

export function inferHireTripType(distanceKm, thresholdKm = DEFAULT_INTERCITY_DISTANCE_KM) {
  const distance = Number(distanceKm);
  const threshold = Number(thresholdKm) > 0 ? Number(thresholdKm) : DEFAULT_INTERCITY_DISTANCE_KM;
  if (Number.isFinite(distance) && distance >= threshold) return 'intercity';
  return 'local';
}
