export const PASSENGER_DRIVER_RATING_TAGS = [
  'Clean vehicle',
  'Dirty vehicle',
  'Unroadworthy vehicle',
  'Good music',
  'Polite driver',
  'Safe driving',
  'Late pickup',
  'Comfortable ride',
];

export function normalizeRatingTags(input, allowedTags = PASSENGER_DRIVER_RATING_TAGS) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(allowedTags);
  const normalized = input
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => allowed.has(item));
  return Array.from(new Set(normalized)).slice(0, 8);
}
