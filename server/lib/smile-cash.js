import crypto from 'crypto';

const SANDBOX_BASE_URL = 'https://zbnet.zb.co.zw/wallet_sandbox_api';
const LIVE_BASE_URL = 'https://zbnet.zb.co.zw/wallet_gateway';

function buildError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapWalletError(data, fallbackStatus) {
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

export function normalizeDateOfBirth(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return raw;
}

async function walletRequest(path, { method = 'POST', body } = {}) {
  const headers = {
    accept: '*/*',
    'Content-Type': 'application/json',
    'x-api-key': getApiKey(),
  };
  const secret = getApiSecret();
  if (secret) headers['x-api-secret'] = secret;

  const res = await fetch(`${getWalletBaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  const responseCode = String(data?.responseCode ?? data?.code ?? data?.statusCode ?? '').trim();
  const okByCode = !responseCode
    || ['00', '0', '200', '201', 'SUCCESS', 'SUCCESSFUL'].includes(responseCode.toUpperCase());
  const failedFlag = data?.success === false || data?.error === true;
  if (!res.ok || failedFlag || !okByCode) {
    const mapped = mapWalletError(data, res.status >= 400 && res.status < 500 ? res.status : 502);
    const error = buildError(mapped.message, mapped.status);
    error.code = mapped.code;
    error.providerPayload = data;
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

function getSenderPhone() {
  const sender = normalizeZimMobile(process.env.SMILE_CASH_SENDER_PHONE || '');
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
      || transactionId
    ),
    authPayload,
    paymentPayload,
  };
}

export function createSmileCashPayoutPublicId() {
  return `SC-${crypto.randomInt(100000, 999999)}`;
}
