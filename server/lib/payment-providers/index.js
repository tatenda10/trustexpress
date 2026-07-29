import { paystackProvider } from './paystack.js';
import { smilePayProvider } from './smilepay.js';

export const PAYMENT_PROVIDERS = {
  paystack: paystackProvider,
  smilepay: smilePayProvider,
};

export const PAYMENT_PROVIDER_OPTIONS = [
  { id: 'paystack', label: 'Paystack', defaultCurrency: 'ZAR' },
  { id: 'smilepay', label: 'Smile&Pay (ZB Bank)', defaultCurrency: 'USD' },
];

export function normalizePaymentProvider(value, fallback = 'paystack') {
  const key = String(value || '').trim().toLowerCase();
  if (PAYMENT_PROVIDERS[key]) return key;
  return fallback;
}

export function getPaymentProvider(providerId) {
  const key = normalizePaymentProvider(providerId);
  return PAYMENT_PROVIDERS[key];
}

export function getDefaultCurrencyForProvider(providerId) {
  const key = normalizePaymentProvider(providerId);
  const option = PAYMENT_PROVIDER_OPTIONS.find((item) => item.id === key);
  return option?.defaultCurrency || 'USD';
}
