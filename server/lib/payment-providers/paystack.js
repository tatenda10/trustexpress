const PAYSTACK_API_BASE_URL = 'https://api.paystack.co';

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function toMinorUnits(amount) {
  return Math.round(normalizeMoney(amount) * 100);
}

function fromMinorUnits(value) {
  return normalizeMoney(Number(value || 0) / 100);
}

function buildError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSecretKey() {
  const key = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!key) {
    throw buildError('PAYSTACK_SECRET_KEY is not configured on the server', 500);
  }
  return key;
}

async function paystackRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${PAYSTACK_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status === false) {
    const error = buildError(
      data?.message || `Paystack request failed with status ${res.status}`,
      502
    );
    error.providerPayload = data;
    throw error;
  }
  return data;
}

export const paystackProvider = {
  id: 'paystack',
  label: 'Paystack',

  async initializeTopup({
    reference,
    amount,
    currency,
    email,
    callbackUrl,
    driverUserId,
  }) {
    const payload = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: toMinorUnits(amount),
        currency,
        reference,
        callback_url: callbackUrl || undefined,
        metadata: {
          driverUserId,
          walletTopup: true,
          amount,
        },
      },
    });

    return {
      provider: 'paystack',
      reference,
      authorizationUrl: payload?.data?.authorization_url || null,
      accessCode: payload?.data?.access_code || null,
      externalTransactionId: null,
      rawInitializePayload: payload,
    };
  },

  async verifyTopup({ reference, expectedAmount, expectedCurrency }) {
    const payload = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
    const transactionData = payload?.data || {};
    const status = String(transactionData.status || '').toLowerCase();
    const verifiedAmount = fromMinorUnits(transactionData.amount);
    const verifiedCurrency = String(transactionData.currency || expectedCurrency || '').toUpperCase();
    const paymentMethod = transactionData.channel || transactionData.authorization?.channel || null;
    const wasSuccessful = status === 'success'
      && verifiedAmount === normalizeMoney(expectedAmount)
      && verifiedCurrency === String(expectedCurrency || '').toUpperCase();

    let nextStatus = 'failed';
    if (wasSuccessful) nextStatus = 'success';
    else if (['abandoned', 'failed', 'cancelled'].includes(status)) nextStatus = status;

    return {
      provider: 'paystack',
      wasSuccessful,
      nextStatus,
      verifiedAmount,
      verifiedCurrency,
      paymentMethod,
      externalTransactionId: transactionData.id == null ? null : String(transactionData.id),
      sourceType: 'paystack_topup',
      description: 'Wallet top-up via Paystack',
      rawVerifyPayload: payload,
    };
  },
};
