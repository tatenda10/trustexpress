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

function redactSmilePayPayload(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSmilePayPayload);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalizedKey = String(key || '').toLowerCase();
      if (['pan', 'securitycode', 'cvv', 'cvc', 'cardnumber'].includes(normalizedKey)) {
        return [key, entry ? '***REDACTED***' : entry];
      }
      if (normalizedKey === 'expmonth' || normalizedKey === 'expyear') {
        return [key, entry ? '**' : entry];
      }
      return [key, redactSmilePayPayload(entry)];
    })
  );
}

function normalizeCardDetails(cardDetails = {}) {
  const source = cardDetails && typeof cardDetails === 'object' ? cardDetails : {};
  const pan = String(source.pan || source.cardNumber || source.number || '').replace(/\D/g, '');
  const expiryRaw = String(source.expiry || source.expiryDate || '').trim();
  const expiryParts = expiryRaw ? expiryRaw.split(/[\/\-\s]+/).filter(Boolean) : [];
  const expMonth = String(source.expMonth || source.expiryMonth || expiryParts[0] || '').replace(/\D/g, '').padStart(2, '0');
  let expYear = String(source.expYear || source.expiryYear || expiryParts[1] || '').replace(/\D/g, '');
  if (expYear.length === 4) expYear = expYear.slice(-2);
  const securityCode = String(source.securityCode || source.cvv || source.cvc || '').replace(/\D/g, '');
  return { pan, expMonth, expYear, securityCode };
}

function getEnvironment() {
  const value = String(process.env.SMILEPAY_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  return value === 'live' || value === 'production' ? 'live' : 'sandbox';
}

function getBaseUrl() {
  return getEnvironment() === 'live' ? LIVE_BASE_URL : SANDBOX_BASE_URL;
}

export function normalizeSmilePayCheckoutMode(value, fallback = 'express_mpgs') {
  const normalizedFallback = ['hosted', 'express_ecocash', 'express_mpgs'].includes(String(fallback || '').trim().toLowerCase())
    ? String(fallback || '').trim().toLowerCase()
    : 'express_mpgs';
  const key = String(value || '').trim().toLowerCase();
  if (!key) return normalizedFallback;
  if (['standard', 'hosted', 'walletplus', 'wallet_plus'].includes(key)) return 'hosted';
  if (['express_ecocash', 'ecocash'].includes(key)) return 'express_ecocash';
  if (['express_mpgs', 'mpgs', 'card', 'express_card'].includes(key)) return 'express_mpgs';
  return normalizedFallback;
}

function getCheckoutMode(override = null) {
  return normalizeSmilePayCheckoutMode(
    override || process.env.SMILEPAY_CHECKOUT_MODE,
    'express_mpgs'
  );
}

function getCheckoutPath(mode) {
  if (mode === 'express_ecocash') return '/payments/express-checkout/ecocash';
  if (mode === 'express_mpgs') return '/payments/express-checkout/mpgs';
  return '/payments/initiate-transaction';
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

function logSmilePay(event, details = {}) {
  try {
    console.log(`[smilepay] ${event}`, JSON.stringify(details));
  } catch {
    console.log(`[smilepay] ${event}`, details);
  }
}

async function smilePayRequest(path, { method = 'GET', body } = {}) {
  const { apiKey, apiSecret } = getCredentials();
  const url = `${getBaseUrl()}${path}`;
  logSmilePay('request.start', {
    environment: getEnvironment(),
    method,
    path,
    url,
    body: redactSmilePayPayload(body || null),
  });
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-api-secret': apiSecret,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await res.text().catch(() => '');
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { rawText: String(rawText).slice(0, 1000) };
  }
  const responseCode = String(data?.responseCode ?? data?.code ?? '').trim();
  const okByCode = !responseCode || responseCode === '00' || responseCode === '0';
  logSmilePay('request.response', {
    path,
    httpStatus: res.status,
    ok: res.ok,
    responseCode: responseCode || null,
    success: data?.success,
    status: data?.status || data?.transactionStatus || data?.paymentStatus || null,
    responseMessage: data?.responseMessage || data?.message || null,
    orderReference: data?.orderReference || data?.order_reference || null,
    transactionReference: data?.transactionReference || data?.reference || null,
    amount: data?.amount ?? data?.data?.amount ?? null,
    payload: redactSmilePayPayload(data),
  });
  if (!res.ok || data?.success === false || !okByCode) {
    const error = buildError(
      data?.responseMessage || data?.message || `Smile&Pay request failed with status ${res.status}`,
      502
    );
    error.providerPayload = data;
    logSmilePay('request.failed', {
      path,
      httpStatus: res.status,
      message: error.message,
      payload: redactSmilePayPayload(data),
    });
    throw error;
  }
  return data;
}

async function smilePayRequestAllowFail(path, options = {}) {
  try {
    const payload = await smilePayRequest(path, options);
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      payload: error?.providerPayload || { error: error?.message || String(error) },
      message: error?.message || String(error),
    };
  }
}

function mapSmilePayStatus(status) {
  const value = String(status || '').trim().toUpperCase();
  if (!value) {
    return { wasSuccessful: false, nextStatus: 'pending' };
  }
  if (
    value === 'PAID'
    || value === 'SUCCESS'
    || value === 'SUCCESSFUL'
    || value === 'COMPLETED'
    || value === 'COMPLETE'
    || value === 'SETTLED'
  ) {
    return { wasSuccessful: true, nextStatus: 'success' };
  }
  if (
    value === 'PENDING'
    || value === 'PROCESSING'
    || value === 'INITIATED'
    || value === 'IN_PROGRESS'
    || value === 'AWAITING_PAYMENT'
  ) {
    return { wasSuccessful: false, nextStatus: 'pending' };
  }
  if (value === 'CANCELED' || value === 'CANCELLED') {
    return { wasSuccessful: false, nextStatus: 'cancelled' };
  }
  if (value === 'FAILED' || value === 'EXPIRED' || value === 'DECLINED') {
    return { wasSuccessful: false, nextStatus: 'failed' };
  }
  logSmilePay('status.unmapped', { status: value });
  return { wasSuccessful: false, nextStatus: 'pending' };
}

function pickSmilePayReference(body = {}) {
  return String(
    body?.orderReference
    || body?.order_reference
    || body?.merchantReference
    || body?.merchant_reference
    || body?.orderId
    || ''
  ).trim();
}

function pickSmilePayTransactionId(body = {}) {
  return String(
    body?.transactionReference
    || body?.transaction_reference
    || body?.reference
    || body?.pollUrl
    || ''
  ).trim() || null;
}

function pickSmilePayAuthorizationUrl(body = {}) {
  return String(
    body?.paymentUrl
    || body?.checkoutUrl
    || body?.redirectUrl
    || body?.authenticationUrl
    || body?.threeDsUrl
    || body?.deepLink
    || body?.data?.paymentUrl
    || body?.data?.checkoutUrl
    || body?.data?.redirectUrl
    || body?.data?.authenticationUrl
    || body?.data?.threeDsUrl
    || body?.data?.deepLink
    || ''
  ).trim() || null;
}

function pickSmilePayNextAction(body = {}, mode = 'hosted') {
  const explicit = String(
    body?.nextAction
    || body?.next_action
    || body?.action
    || body?.data?.nextAction
    || body?.data?.next_action
    || body?.data?.action
    || ''
  ).trim().toLowerCase();
  if (explicit) return explicit;
  if (pickSmilePayAuthorizationUrl(body)) return 'redirect';
  if (mode === 'express_ecocash') return 'poll';
  if (mode === 'express_mpgs') return 'poll';
  return 'redirect';
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
    resultUrl: customResultUrl,
    driverUserId,
    firstName = '',
    lastName = '',
    mobilePhoneNumber = '',
    itemName = 'Trust Express Wallet Top-up',
    itemDescription = '',
    checkoutMode: checkoutModeOverride = null,
    cardDetails = null,
  }) {
    const currencyCode = toSmilePayCurrencyCode(currency);
    const resultUrl = String(customResultUrl || '').trim() || getSmilePayWebhookUrl();
    const returnUrl = String(callbackUrl || '').trim() || resultUrl;
    const checkoutMode = getCheckoutMode(checkoutModeOverride);
    const checkoutPath = getCheckoutPath(checkoutMode);
    const requestBody = {
      orderReference: reference,
      amount: normalizeMoney(amount),
      currencyCode,
      itemName: String(itemName || 'Trust Express Wallet Top-up').trim() || 'Trust Express Wallet Top-up',
      itemDescription: String(itemDescription || `Driver wallet top-up for ${driverUserId}`).trim() || `Driver wallet top-up for ${driverUserId}`,
      returnUrl,
      resultUrl,
      email: email || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      mobilePhoneNumber: mobilePhoneNumber || undefined,
    };
    if (checkoutMode === 'hosted') {
      requestBody.paymentMethod = 'WALLETPLUS';
    } else if (checkoutMode === 'express_ecocash') {
      requestBody.paymentMethod = 'ECOCASH';
      requestBody.msisdn = mobilePhoneNumber || undefined;
    } else if (checkoutMode === 'express_mpgs') {
      requestBody.paymentMethod = 'CARD';
      const card = normalizeCardDetails(cardDetails);
      if (!card.pan || !card.expMonth || !card.expYear || !card.securityCode) {
        throw buildError('Card number, expiry date and CVV are required for Smile&Pay Express card checkout.', 400);
      }
      requestBody.pan = card.pan;
      requestBody.expMonth = card.expMonth;
      requestBody.expYear = card.expYear;
      requestBody.securityCode = card.securityCode;
    }

    const payload = await smilePayRequest(checkoutPath, {
      method: 'POST',
      body: requestBody,
    });

    const initiated = {
      provider: 'smilepay',
      reference,
      checkoutMode,
      nextAction: pickSmilePayNextAction(payload, checkoutMode),
      authorizationUrl: pickSmilePayAuthorizationUrl(payload),
      accessCode: null,
      externalTransactionId: payload?.transactionReference
        ? String(payload.transactionReference)
        : pickSmilePayTransactionId(payload),
      rawInitializePayload: payload,
    };
    logSmilePay('initialize.success', {
      reference,
      checkoutMode,
      nextAction: initiated.nextAction,
      returnUrl,
      resultUrl,
      authorizationUrl: initiated.authorizationUrl,
      externalTransactionId: initiated.externalTransactionId,
    });
    return initiated;
  },

  async verifyTopup({ reference, expectedAmount, expectedCurrency, alternateReference = null }) {
    const lookupIds = [...new Set(
      [reference, alternateReference].map((value) => String(value || '').trim()).filter(Boolean)
    )];
    let payload = null;
    let usedReference = reference;
    let lastError = null;
    for (const lookupId of lookupIds) {
      try {
        usedReference = lookupId;
        payload = await smilePayRequest(
          `/payments/transaction/${encodeURIComponent(lookupId)}/status/check`,
          { method: 'GET' }
        );
        break;
      } catch (error) {
        lastError = error;
        logSmilePay('verify.lookup_failed', {
          lookupId,
          message: error?.message || String(error),
          providerPayload: error?.providerPayload || null,
        });
      }
    }
    if (!payload) {
      if (lastError) throw lastError;
      throw buildError('Smile&Pay status check returned no payload', 502);
    }
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
    const result = {
      provider: 'smilepay',
      wasSuccessful,
      nextStatus: wasSuccessful ? 'success' : mapped.nextStatus,
      verifiedAmount,
      verifiedCurrency,
      paymentMethod,
      externalTransactionId: pickSmilePayTransactionId(payload),
      sourceType: 'smilepay_topup',
      description: 'Wallet top-up via Smile&Pay',
      rawVerifyPayload: payload,
    };
    logSmilePay('verify.result', {
      requestedReference: reference,
      usedReference,
      statusValue,
      amountMatched,
      currencyMatched,
      expectedAmount: normalizeMoney(expectedAmount),
      verifiedAmount,
      expectedCurrency,
      verifiedCurrency,
      wasSuccessful,
      nextStatus: result.nextStatus,
    });
    return result;
  },

  parseWebhook(body = {}) {
    const orderReference = pickSmilePayReference(body);
    const mapped = mapSmilePayStatus(body?.status || body?.transactionStatus || body?.paymentStatus);
    const verifiedAmount = normalizeMoney(body?.amount);
    const verifiedCurrency = fromSmilePayCurrencyCode(body?.currencyCode || body?.currency, 'USD');
    const parsed = {
      provider: 'smilepay',
      reference: orderReference,
      wasSuccessful: mapped.wasSuccessful,
      nextStatus: mapped.wasSuccessful ? 'success' : mapped.nextStatus,
      verifiedAmount,
      verifiedCurrency,
      paymentMethod: body?.paymentOption || body?.paymentMethod || null,
      externalTransactionId: pickSmilePayTransactionId(body),
      sourceType: 'smilepay_topup',
      description: 'Wallet top-up via Smile&Pay',
      rawVerifyPayload: body,
    };
    logSmilePay('webhook.parsed', parsed);
    return parsed;
  },

  async cancelTransaction({ reference }) {
    const safeReference = String(reference || '').trim();
    if (!safeReference) throw buildError('reference is required');
    const payload = await smilePayRequest(
      `/payments/cancel/${encodeURIComponent(safeReference)}`,
      { method: 'POST' }
    );
    logSmilePay('cancel.success', { reference: safeReference, payload });
    return payload;
  },

  async refundTransaction({ reference, amount, reason }) {
    const safeReference = String(reference || '').trim();
    if (!safeReference) throw buildError('reference is required');
    const body = {
      amount: normalizeMoney(amount),
      reason: String(reason || 'Driver cancelled before trip start').slice(0, 120),
    };
    const paths = [
      `/payments/transaction/${encodeURIComponent(safeReference)}/refund`,
      `/payments/refund/${encodeURIComponent(safeReference)}`,
    ];
    let last = null;
    for (const path of paths) {
      last = await smilePayRequestAllowFail(path, { method: 'POST', body });
      logSmilePay(last.ok ? 'refund.success' : 'refund.attempt_failed', {
        reference: safeReference,
        path,
        ok: last.ok,
        message: last.message || null,
      });
      if (last.ok) {
        return { ok: true, path, payload: last.payload };
      }
    }
    return {
      ok: false,
      path: paths[paths.length - 1],
      payload: last?.payload || {},
      message: last?.message || 'Smile&Pay refund is not available',
    };
  },
};
