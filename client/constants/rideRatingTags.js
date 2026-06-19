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

function parseReviewSegments(review) {
  return String(review || '')
    .split(/(?:\.\s+|\n+)/)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

export function isPassengerDriverReviewTagSelected(review, tag) {
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) return false;
  return parseReviewSegments(review).includes(normalizedTag);
}

export function togglePassengerDriverReviewTag(currentReview, tag) {
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) return String(currentReview || '');

  const segments = parseReviewSegments(currentReview);
  const hasTag = segments.includes(normalizedTag);
  const nextSegments = hasTag
    ? segments.filter((part) => part !== normalizedTag)
    : [...segments, normalizedTag];

  return nextSegments.length ? `${nextSegments.join('. ')}.` : '';
}
