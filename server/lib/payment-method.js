export function normalizePaymentMethod(value, fallback = null) {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'online' || method === 'pay_online' || method === 'payonline') return 'online';
  return fallback;
}

export function paymentMethodLabel(value) {
  const method = normalizePaymentMethod(value);
  if (method === 'cash') return 'Cash';
  if (method === 'online') return 'Pay online';
  return null;
}

export function receiptPaymentMethodLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'cash') return 'Cash';
  return 'Online payment';
}
