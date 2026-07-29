const SANDBOX_BASE_URL = 'https://zbnet.zb.co.zw/wallet_sandbox_api/payments-gateway';
const LIVE_BASE_URL = 'https://zbnet.zb.co.zw/wallet_gateway/payments-gateway';

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function buildError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getEnvironment() {
  const value = String(process.env.SMILEPAY_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  return value === 'live' || value === 'production' ? 'live' : 'sandbox';
}

function getBaseUrl() {
  return getEnvironment() === 'live' ? LIVE_BASE_URL : SANDBOX_BASE_URL;
}

function getCredentials() {
  const apiKey = String(process.env.SMILEPAY_API_KEY || '').trim();
  const apiSecret = String(process.env.SMILEPAY_API_SECRET || '').trim();
  if (!apiKey || !apiSecret) {
    throw buildError('SMILEPAY_API_KEY and SMILEPAY_API_SECRET must be configured on the server', 500);
  }
  return { apiKey, apiSecret };
}

export function toSmilePayCurrencyCode(currency) {
  const code = String(currency || '').trim().toUpperCase();
  if (code === '840' || code === 'USD') return '840';
  if (code === '924' || code === 'ZWG' || code === 'ZWL') return '924';
  throw buildError(
    `Smile&Pay only supports USD (840) or ZWG (924). Current wallet currency is ${code || 'unset'}.`,
    400
  );
}

export function fromSmilePayCurrencyCode(currencyCode, fallback = 'USD') {
  const code = String(currencyCode || '').trim();
  if (code === '840' || String(currencyCode || '').toUpperCase() === 'USD') return 'USD';
  if (code === '924' || ['ZWG', 'ZWL'].includes(String(currencyCode || '').toUpperCase())) return 'ZWG';
  return String(fallback || 'USD').toUpperCase();
}

function getPublicApiBaseUrl() {
  return String(
    process.env.PUBLIC_API_BASE_URL
    || process.env.API_PUBLIC_URL
    || process.env.SERVER_PUBLIC_URL
    || ''
  ).trim().replace(/\/$/, '');
}

export function getSmilePayWebhookUrl() {
  const base = getPublicApiBaseUrl();
  if (!base) {
    throw buildError(
      'PUBLIC_API_BASE_URL is required for Smile&Pay webhooks (resultUrl). Set it to your public API origin.',
      500
    );
  }
  return `${base}/api/drivers/wallet/webhooks/smilepay`;
}

async function smilePayRequest(path, { method = 'GET', body } = {}) {
  const { apiKey, apiSecret } = getCredentials();
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-api-secret': apiSecret,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  const responseCode = String(data?.responseCode ?? data?.code ?? '').trim();
  const okByCode = !responseCode || responseCode === '00' || responseCode === '0';
  if (!res.ok || data?.success === false || !okByCode) {
    const error = buildError(
      data?.responseMessage || data?.message || `Smile&Pay request failed with status ${res.status}`,
      502
    );
    error.providerPayload = data;
    throw error;
  }
  return data;
}

function mapSmilePayStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  if (value === 'PAID' || value === 'SUCCESS' || value === 'SUCCESSFUL') {
    return { wasSuccessful: true, nextStatus: 'success' };
  }
  if (value === 'PENDING' || value === 'PROCESSING') {
    return { wasSuccessful: false, nextStatus: 'pending' };
  }
  if (value === 'CANCELED' || value === 'CANCELLED') {
    return { wasSuccessful: false, nextStatus: 'cancelled' };
  }
  if (value === 'FAILED' || value === 'EXPIRED') {
    return { wasSuccessful: false, nextStatus: 'failed' };
  }
  return { wasSuccessful: false, nextStatus: 'failed' };
}

export const smilePayProvider = {
  id: 'smilepay',
  label: 'Smile&Pay (ZB Bank)',

  async initializeTopup({
    reference,
    amount,
    currency,
    email,
    callbackUrl,
    driverUserId,
    firstName = '',
    lastName = '',
    mobilePhoneNumber = '',
  }) {
    const currencyCode = toSmilePayCurrencyCode(currency);
    const resultUrl = getSmilePayWebhookUrl();
    const returnUrl = String(callbackUrl || '').trim() || resultUrl;

    const payload = await smilePayRequest('/payments/initiate-transaction', {
      method: 'POST',
      body: {
        orderReference: reference,
        amount: normalizeMoney(amount),
        currencyCode,
        itemName: 'Trust Express Wallet Top-up',
        itemDescription: `Driver wallet top-up for ${driverUserId}`,
        returnUrl,
        resultUrl,
        paymentMethod: 'WALLETPLUS',
        email: email || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        mobilePhoneNumber: mobilePhoneNumber || undefined,
      },
    });

    return {
      provider: 'smilepay',
      reference,
      authorizationUrl: payload?.paymentUrl || payload?.checkoutUrl || null,
      accessCode: null,
      externalTransactionId: payload?.transactionReference
        ? String(payload.transactionReference)
        : null,
      rawInitializePayload: payload,
    };
  },

  async verifyTopup({ reference, expectedAmount, expectedCurrency }) {
    const payload = await smilePayRequest(
      `/payments/transaction/${encodeURIComponent(reference)}/status/check`,
      { method: 'GET' }
    );
    const statusValue = payload?.status
      || payload?.transactionStatus
      || payload?.paymentStatus
      || payload?.data?.status
      || '';
    const mapped = mapSmilePayStatus(statusValue);
    const verifiedAmount = normalizeMoney(
      payload?.amount ?? payload?.data?.amount ?? expectedAmount
    );
    const verifiedCurrency = fromSmilePayCurrencyCode(
      payload?.currencyCode || payload?.currency || payload?.data?.currencyCode,
      expectedCurrency
    );
    const paymentMethod = payload?.paymentOption
      || payload?.paymentMethod
      || payload?.data?.paymentOption
      || null;
    const amountMatched = verifiedAmount === normalizeMoney(expectedAmount);
    const currencyMatched = verifiedCurrency === String(expectedCurrency || '').toUpperCase()
      || (
        String(expectedCurrency || '').toUpperCase() === 'USD'
        && verifiedCurrency === 'USD'
      );
    const wasSuccessful = mapped.wasSuccessful && amountMatched && currencyMatched;

    return {
      provider: 'smilepay',
      wasSuccessful,
      nextStatus: wasSuccessful ? 'success' : mapped.nextStatus,
      verifiedAmount,
      verifiedCurrency,
      paymentMethod,
      externalTransactionId: payload?.reference || payload?.transactionReference
        ? String(payload.reference || payload.transactionReference)
        : null,
      sourceType: 'smilepay_topup',
      description: 'Wallet top-up via Smile&Pay',
      rawVerifyPayload: payload,
    };
  },

  parseWebhook(body = {}) {
    const orderReference = String(body?.orderReference || body?.order_reference || '').trim();
    const mapped = mapSmilePayStatus(body?.status);
    const verifiedAmount = normalizeMoney(body?.amount);
    const verifiedCurrency = fromSmilePayCurrencyCode(body?.currencyCode || body?.currency, 'USD');
    return {
      provider: 'smilepay',
      reference: orderReference,
      wasSuccessful: mapped.wasSuccessful,
      nextStatus: mapped.wasSuccessful ? 'success' : mapped.nextStatus,
      verifiedAmount,
      verifiedCurrency,
      paymentMethod: body?.paymentOption || body?.paymentMethod || null,
      externalTransactionId: body?.reference ? String(body.reference) : null,
      sourceType: 'smilepay_topup',
      description: 'Wallet top-up via Smile&Pay',
      rawVerifyPayload: body,
    };
  },
};
