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

export const HIRE_CARGO_TYPES = [
  { value: 'people', label: 'People / passengers' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'household', label: 'Household items' },
  { value: 'office', label: 'Office items' },
  { value: 'building', label: 'Building materials' },
  { value: 'sand', label: 'Sand / rubble' },
  { value: 'food', label: 'Food / groceries' },
  { value: 'luggage', label: 'Luggage' },
  { value: 'appliances', label: 'Appliances' },
  { value: 'machinery', label: 'Machinery / tools' },
  { value: 'produce', label: 'Farm produce' },
  { value: 'livestock', label: 'Livestock' },
  { value: 'fuel', label: 'Fuel / drums' },
  { value: 'water', label: 'Water / tanks' },
  { value: 'event', label: 'Event equipment' },
  { value: 'other_cargo', label: 'Other cargo' },
];

export const HIRE_HELP_OPTIONS = [
  { value: 'helpers', label: 'Helpers' },
  { value: 'loading', label: 'Loading help' },
  { value: 'unloading', label: 'Unloading help' },
  { value: 'stairs', label: 'Stairs / no lift' },
  { value: 'heavy', label: 'Heavy items' },
];

export const HIRE_EXTRA_OPTIONS = [
  { value: 'fragile', label: 'Fragile items' },
  { value: 'cover', label: 'Keep dry / covered' },
  { value: 'cool', label: 'Keep cool' },
  { value: 'waiting', label: 'Waiting time' },
  { value: 'return_trip', label: 'Return trip' },
  { value: 'multiple_stops', label: 'Multiple stops' },
  { value: 'same_day', label: 'Same-day' },
  { value: 'night', label: 'Night / early morning' },
];

export const HIRE_JOB_NEEDS = [...HIRE_HELP_OPTIONS, ...HIRE_EXTRA_OPTIONS];

function labelsForValues(options, values) {
  const selected = new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
  return options.filter((item) => selected.has(item.value)).map((item) => item.label);
}

export function formatHireJobNotes({ cargoTypes = [], jobNeeds = [] } = {}) {
  const parts = [];
  const selectedCargo = labelsForValues(HIRE_CARGO_TYPES, cargoTypes);
  if (selectedCargo.length) {
    parts.push(`Cargo: ${selectedCargo.join(', ')}`);
  }
  const selectedHelp = labelsForValues(HIRE_HELP_OPTIONS, jobNeeds);
  if (selectedHelp.length) {
    parts.push(`Help: ${selectedHelp.join(', ')}`);
  }
  const selectedExtras = labelsForValues(HIRE_EXTRA_OPTIONS, jobNeeds);
  if (selectedExtras.length) {
    parts.push(`Extras: ${selectedExtras.join(', ')}`);
  }
  return parts.join('\n');
}

export function hireTypesToCategories(types = []) {
  return (Array.isArray(types) ? types : [])
    .filter((type) => type?.typeKey && type?.typeName)
    .map((type) => ({
      value: String(type.typeKey).toLowerCase(),
      label: type.typeName,
      pricePerKm: Number(type.pricePerKm || 0),
    }));
}

export function hireTypesToFilters(types = []) {
  return [{ value: '', label: 'All' }, ...hireTypesToCategories(types)];
}

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
