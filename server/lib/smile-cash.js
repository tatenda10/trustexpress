import crypto from 'crypto';

const SANDBOX_BASE_URL = 'https://zbnet.zb.co.zw/wallet_sandbox_api';
const LIVE_BASE_URL = 'https://zbnet.zb.co.zw/wallet_gateway';

function buildError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapWalletError(data, fallbackStatus, path = '') {
  const rawMessage = String(
    data?.responseMessage
      || data?.message
      || data?.error
      || ''
  ).trim();
  const rawStatus = String(data?.status || data?.code || data?.responseCode || '').trim().toUpperCase();
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    rawStatus === 'CONFLICT'
    || normalizedMessage.includes('mobile already taken')
    || normalizedMessage.includes('already taken')
    || normalizedMessage.includes('already exists')
  ) {
    return {
      status: 409,
      message: 'This mobile number is already registered with Smile Cash. Use that existing Smile Cash number or contact support.',
      code: 'SMILE_CASH_MOBILE_ALREADY_TAKEN',
    };
  }

  if (
    fallbackStatus === 403
    || rawStatus === 'FORBIDDEN'
    || normalizedMessage === 'forbidden'
    || normalizedMessage.includes('not allowed')
  ) {
    if (String(path || '').includes('/subscriber/external/cashout/auth')) {
      return {
        status: 403,
        message: 'Smile Cash cash-outs are not authorised for Trust Express yet. Your wallet balance was restored; please contact support.',
        code: 'SMILE_CASH_CASHOUT_NOT_AUTHORIZED',
      };
    }
    return {
      status: 403,
      message: 'Smile Cash rejected this request. Please contact support so we can check your Smile Cash setup.',
      code: 'SMILE_CASH_FORBIDDEN',
    };
  }

  return {
    status: fallbackStatus,
    message: rawMessage || `Smile Cash request failed with status ${fallbackStatus}`,
    code: rawStatus || null,
  };
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function maskMobile(value) {
  const raw = String(value || '').trim();
  if (raw.length <= 6) return raw ? '***' : '';
  return `${raw.slice(0, 5)}***${raw.slice(-3)}`;
}

function redactSmileCashDebugPayload(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSmileCashDebugPayload);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalizedKey = String(key || '').toLowerCase();
      if (normalizedKey.includes('secret') || normalizedKey.includes('api-key') || normalizedKey.includes('apikey')) {
        return [key, '[redacted]'];
      }
      if (normalizedKey.includes('mobile') || normalizedKey.includes('phone')) {
        return [key, maskMobile(item)];
      }
      if (item && typeof item === 'object') {
        return [key, redactSmileCashDebugPayload(item)];
      }
      return [key, item];
    })
  );
}

function shouldLogSmileCashCashout(path) {
  return String(path || '').includes('/transactions/subscriber/external/cashout/');
}

export function getSmileCashEnvironment() {
  const value = String(process.env.SMILEPAY_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  return value === 'live' || value === 'production' ? 'live' : 'sandbox';
}

function getWalletBaseUrl() {
  const override = String(process.env.SMILE_CASH_BASE_URL || '').trim().replace(/\/$/, '');
  if (override) return override;
  return getSmileCashEnvironment() === 'live' ? LIVE_BASE_URL : SANDBOX_BASE_URL;
}

function getApiKey() {
  const apiKey = String(
    process.env.SMILE_CASH_API_KEY
    || process.env.SMILEPAY_API_KEY
    || ''
  ).trim();
  if (!apiKey) {
    throw buildError('SMILE_CASH_API_KEY or SMILEPAY_API_KEY must be configured', 500);
  }
  return apiKey;
}

function getApiSecret() {
  return String(
    process.env.SMILE_CASH_API_SECRET
    || process.env.SMILEPAY_API_SECRET
    || ''
  ).trim();
}

export function normalizeZimMobile(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length >= 9) {
    digits = `263${digits.slice(1)}`;
  } else if (digits.length === 9 && digits.startsWith('7')) {
    digits = `263${digits}`;
  }
  return digits;
}

export function normalizeGender(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'M' || raw === 'MALE') return 'MALE';
  if (raw === 'F' || raw === 'FEMALE') return 'FEMALE';
  return '';
}

/**
 * Normalize MySQL DATE / ISO date values to YYYY-MM-DD.
 * Avoid String(date).slice(0, 10) — that turns Date objects into "Sun Dec 29".
 */
export function toIsoDateOnly(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const raw = String(value).trim();
  const matched = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matched) return matched[1];
  return null;
}

export function normalizeDateOfBirth(value) {
  return toIsoDateOnly(value) || '';
}

async function walletRequest(path, { method = 'POST', body } = {}) {
  const headers = {
    accept: '*/*',
    'Content-Type': 'application/json',
    'x-api-key': getApiKey(),
  };
  const secret = getApiSecret();
  if (secret) headers['x-api-secret'] = secret;

  const shouldLogCashout = shouldLogSmileCashCashout(path);
  if (shouldLogCashout) {
    console.log('[smile-cash.cashout] provider request', {
      environment: getSmileCashEnvironment(),
      method,
      path,
      body: redactSmileCashDebugPayload(body),
    });
  }

  const res = await fetch(`${getWalletBaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (shouldLogCashout) {
    console.log('[smile-cash.cashout] provider response', {
      method,
      path,
      status: res.status,
      ok: res.ok,
      body: redactSmileCashDebugPayload(data),
    });
  }
  const responseCode = String(data?.responseCode ?? data?.code ?? data?.statusCode ?? '').trim();
  const responseDescription = String(data?.responseDescription || data?.message || '').trim().toLowerCase();
  const okByCode = !responseCode
    || ['000', '00', '0', '200', '201', 'SUCCESS', 'SUCCESSFUL'].includes(responseCode.toUpperCase())
    || responseDescription.includes('approved')
    || responseDescription.includes('completed successfully');
  const failedFlag = data?.success === false || data?.error === true;
  if (!res.ok || failedFlag || !okByCode) {
    const mapped = mapWalletError(data, res.status >= 400 && res.status < 500 ? res.status : 502, path);
    const error = buildError(mapped.message, mapped.status);
    error.code = mapped.code;
    error.providerPayload = data;
    if (shouldLogCashout) {
      console.log('[smile-cash.cashout] provider mapped error', {
        method,
        path,
        status: error.status,
        code: error.code || null,
        message: error.message,
        providerPayload: redactSmileCashDebugPayload(data),
      });
    }
    throw error;
  }
  return data;
}

export async function createSmileCashSubscriber({
  firstName,
  lastName,
  mobile,
  dateOfBirth,
  idNumber,
  gender,
  source = 'TRUST_EXPRESS',
}) {
  const payload = {
    firstName: String(firstName || '').trim(),
    lastName: String(lastName || '').trim(),
    mobile: normalizeZimMobile(mobile),
    dateOfBirth: normalizeDateOfBirth(dateOfBirth),
    idNumber: String(idNumber || '').trim().toUpperCase(),
    gender: normalizeGender(gender),
    source: String(source || 'TRUST_EXPRESS').trim() || 'TRUST_EXPRESS',
  };

  if (!payload.firstName || !payload.lastName) {
    throw buildError('First and last name are required for Smile Cash registration');
  }
  if (!payload.mobile || payload.mobile.length < 11) {
    throw buildError('A valid Zimbabwe mobile number is required');
  }
  if (!payload.dateOfBirth) {
    throw buildError('Date of birth is required (YYYY-MM-DD)');
  }
  if (!payload.idNumber) {
    throw buildError('National ID number is required');
  }
  if (!payload.gender) {
    throw buildError('Gender must be MALE or FEMALE');
  }

  const data = await walletRequest('/accounts/api/v1/subscribers/create', {
    method: 'POST',
    body: payload,
  });

  return {
    mobile: payload.mobile,
    raw: data,
  };
}

export function getSmileCashSenderPhone() {
  return normalizeZimMobile(process.env.SMILE_CASH_SENDER_PHONE || '');
}

export function isCompanySmileCashNumber(mobile) {
  const sender = getSmileCashSenderPhone();
  const receiver = normalizeZimMobile(mobile);
  return !!(sender && receiver && sender === receiver);
}

function getSenderPhone() {
  const sender = getSmileCashSenderPhone();
  if (!sender) {
    throw buildError('SMILE_CASH_SENDER_PHONE must be configured for payouts', 500);
  }
  return sender;
}

async function cashoutRequest(requestType, body) {
  return walletRequest(
    `/transactions/subscriber/external/cashout/${encodeURIComponent(requestType)}`,
    { method: 'POST', body }
  );
}

export async function executeSmileCashExternalCashout({
  receiverMobile,
  amount,
  currency = 'USD',
  narration = 'Trust Express payout',
  channel = 'WEB',
}) {
  const mobile = normalizeZimMobile(receiverMobile);
  const money = normalizeMoney(amount);
  const currencyCode = String(currency || 'USD').trim().toUpperCase();

  if (!mobile) throw buildError('Receiver Smile Cash mobile is required');
  if (isCompanySmileCashNumber(mobile)) {
    throw buildError(
      'This Smile Cash number is the company payout account. Unlink it in Smile Cash and link your personal number.',
      409
    );
  }
  if (!(money > 0)) throw buildError('Payout amount must be greater than zero');
  if (!['USD', 'ZWG', 'ZWL'].includes(currencyCode)) {
    throw buildError('Currency must be USD or ZWG');
  }

  const baseBody = {
    receiverMobile: mobile,
    senderPhone: getSenderPhone(),
    amount: money,
    currency: currencyCode === 'ZWL' ? 'ZWG' : currencyCode,
    channel: String(channel || 'WEB').trim() || 'WEB',
    narration: String(narration || 'Trust Express payout').slice(0, 120),
  };

  const authPayload = await cashoutRequest('auth', {
    ...baseBody,
    transactionId: '',
  });

  const transactionId = String(
    authPayload?.transactionId
    || authPayload?.data?.transactionId
    || authPayload?.data?.id
    || authPayload?.data?.reference
    || authPayload?.reference
    || ''
  ).trim();

  if (!transactionId) {
    const error = buildError('Smile Cash auth did not return a transactionId', 502);
    error.providerPayload = authPayload;
    throw error;
  }

  const paymentPayload = await cashoutRequest('payment', {
    ...baseBody,
    transactionId,
  });

  return {
    receiverMobile: mobile,
    amount: money,
    currency: baseBody.currency,
    authTransactionId: transactionId,
    paymentTransactionId: String(
      paymentPayload?.transactionId
      || paymentPayload?.data?.transactionId
      || paymentPayload?.data?.id
      || paymentPayload?.data?.reference
      || transactionId
    ),
    authPayload,
    paymentPayload,
  };
}

export function createSmileCashPayoutPublicId() {
  return `SC-${crypto.randomInt(100000, 999999)}`;
}
