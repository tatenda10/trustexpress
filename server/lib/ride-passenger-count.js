export function getTierMaxPassengerCount(tierKey, tierName) {
  const haystack = `${tierKey || ''} ${tierName || ''}`.toLowerCase();
  if (haystack.includes('xl') || haystack.includes('extra large')) return 7;
  return 4;
}

export function parseRequiredPassengerCount(value, maxCount = 4) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  const max = Number.parseInt(String(maxCount ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  if (!Number.isInteger(max) || parsed > max) return null;
  return parsed;
}

export function formatPassengerCountLabel(count) {
  const parsed = Number(count);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed === 1 ? '1 person' : `${parsed} people`;
}
