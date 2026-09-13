export const PAYMENT_METHOD_CASH = 'cash';
export const PAYMENT_METHOD_ONLINE = 'online';

export function normalizePaymentMethod(value, fallback = null) {
  const method = String(value || '').trim().toLowerCase();
  if (method === PAYMENT_METHOD_CASH) return PAYMENT_METHOD_CASH;
  if (method === PAYMENT_METHOD_ONLINE || method === 'pay_online' || method === 'payonline') {
    return PAYMENT_METHOD_ONLINE;
  }
  return fallback;
}

export function paymentMethodLabel(value) {
  const method = normalizePaymentMethod(value);
  if (method === PAYMENT_METHOD_CASH) return 'Cash';
  if (method === PAYMENT_METHOD_ONLINE) return 'Pay online';
  return null;
}

export function receiptPaymentMethodLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === PAYMENT_METHOD_CASH) return 'Cash';
  return 'Online payment';
}
