import crypto from 'crypto';
import { query } from '../db/connection.js';

export const DEFAULT_SAFETY_PIN_MAX_ATTEMPTS = 3;
export const DEFAULT_SAFETY_PIN_NIGHT_START_HOUR = 18;
export const DEFAULT_SAFETY_PIN_NIGHT_END_HOUR = 6;

/** @deprecated Prefer getSafetyPinSettings().maxAttempts — kept for older imports. */
export const SAFETY_PIN_MAX_ATTEMPTS = DEFAULT_SAFETY_PIN_MAX_ATTEMPTS;

const SETTINGS_CACHE_TTL_MS = 15_000;

let settingsCache = null;
let settingsCacheLoadedAt = 0;

function clampHour(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const hour = Math.floor(parsed);
  if (hour < 0 || hour > 23) return fallback;
  return hour;
}

function clampAttempts(value, fallback = DEFAULT_SAFETY_PIN_MAX_ATTEMPTS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), 10);
}

function coerceBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getDefaultSettingsFromEnv() {
  return {
    enabled: true,
    nightStartHour: clampHour(process.env.SAFETY_PIN_NIGHT_START_HOUR, DEFAULT_SAFETY_PIN_NIGHT_START_HOUR),
    nightEndHour: clampHour(process.env.SAFETY_PIN_NIGHT_END_HOUR, DEFAULT_SAFETY_PIN_NIGHT_END_HOUR),
    maxAttempts: clampAttempts(process.env.SAFETY_PIN_MAX_ATTEMPTS, DEFAULT_SAFETY_PIN_MAX_ATTEMPTS),
    updatedByAdminId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function shapeSafetyPinSettings(row) {
  const defaults = getDefaultSettingsFromEnv();
  return {
    enabled: coerceBoolean(row?.enabled, defaults.enabled),
    nightStartHour: clampHour(row?.night_start_hour, defaults.nightStartHour),
    nightEndHour: clampHour(row?.night_end_hour, defaults.nightEndHour),
    maxAttempts: clampAttempts(row?.max_attempts, defaults.maxAttempts),
    updatedByAdminId: row?.updated_by_admin_id || null,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function formatHourLabel(hour) {
  const safe = clampHour(hour, 0);
  const suffix = safe >= 12 ? 'PM' : 'AM';
  const twelve = safe % 12 === 0 ? 12 : safe % 12;
  return `${twelve}:00 ${suffix}`;
}

async function ensureSafetyPinSettingsRow() {
  const defaults = getDefaultSettingsFromEnv();
  await query(
    `INSERT INTO ride_safety_pin_settings (
       id,
       enabled,
       night_start_hour,
       night_end_hour,
       max_attempts
     )
     SELECT 1, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM ride_safety_pin_settings WHERE id = 1
     )`,
    [
      defaults.enabled ? 1 : 0,
      defaults.nightStartHour,
      defaults.nightEndHour,
      defaults.maxAttempts,
    ]
  );
}

function setSettingsCache(settings) {
  settingsCache = settings;
  settingsCacheLoadedAt = Date.now();
  return settings;
}

export function getCachedSafetyPinSettings() {
  if (settingsCache && (Date.now() - settingsCacheLoadedAt) < SETTINGS_CACHE_TTL_MS) {
    return settingsCache;
  }
  return settingsCache || getDefaultSettingsFromEnv();
}

export async function getSafetyPinSettings({ force = false } = {}) {
  if (
    !force &&
    settingsCache &&
    (Date.now() - settingsCacheLoadedAt) < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache;
  }

  try {
    await ensureSafetyPinSettingsRow();
    const [row] = await query(
      `SELECT *
       FROM ride_safety_pin_settings
       WHERE id = 1
       LIMIT 1`
    );
    return setSettingsCache(shapeSafetyPinSettings(row || null));
  } catch (error) {
    console.warn('[ride-safety-pin] Falling back to env defaults', {
      message: error?.message || String(error),
    });
    return setSettingsCache(getDefaultSettingsFromEnv());
  }
}

export async function updateSafetyPinSettings({
  enabled,
  nightStartHour,
  nightEndHour,
  maxAttempts,
  adminUserId = null,
} = {}) {
  await ensureSafetyPinSettingsRow();
  const current = await getSafetyPinSettings({ force: true });

  const nextEnabled = enabled === undefined ? current.enabled : coerceBoolean(enabled, current.enabled);
  const nextStart = nightStartHour === undefined
    ? current.nightStartHour
    : clampHour(nightStartHour, NaN);
  const nextEnd = nightEndHour === undefined
    ? current.nightEndHour
    : clampHour(nightEndHour, NaN);
  const nextAttempts = maxAttempts === undefined
    ? current.maxAttempts
    : clampAttempts(maxAttempts, NaN);

  if (!Number.isFinite(nextStart)) {
    const error = new Error('Night start hour must be between 0 and 23');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(nextEnd)) {
    const error = new Error('Night end hour must be between 0 and 23');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(nextAttempts)) {
    const error = new Error('Max attempts must be between 1 and 10');
    error.status = 400;
    throw error;
  }

  await query(
    `UPDATE ride_safety_pin_settings
     SET enabled = ?,
         night_start_hour = ?,
         night_end_hour = ?,
         max_attempts = ?,
         updated_by_admin_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      nextEnabled ? 1 : 0,
      nextStart,
      nextEnd,
      nextAttempts,
      adminUserId,
    ]
  );

  return getSafetyPinSettings({ force: true });
}

function getPinSecretMaterial() {
  return String(
    process.env.RIDE_PIN_SECRET ||
      process.env.CLERK_SECRET_KEY ||
      'trust-express-ride-pin-dev-key'
  );
}

function getEncryptionKey() {
  return crypto.createHash('sha256').update(getPinSecretMaterial()).digest();
}

export function isNightSafetyWindow(date = new Date(), settings = null) {
  const config = settings || getCachedSafetyPinSettings();
  if (!config.enabled) return false;

  const hour = date.getHours();
  const nightStartHour = clampHour(config.nightStartHour, DEFAULT_SAFETY_PIN_NIGHT_START_HOUR);
  const nightEndHour = clampHour(config.nightEndHour, DEFAULT_SAFETY_PIN_NIGHT_END_HOUR);

  if (nightStartHour === nightEndHour) return true;
  if (nightStartHour < nightEndHour) {
    return hour >= nightStartHour && hour < nightEndHour;
  }
  return hour >= nightStartHour || hour < nightEndHour;
}

export function describeSafetyPinWindow(settings = null) {
  const config = settings || getCachedSafetyPinSettings();
  return {
    enabled: !!config.enabled,
    nightStartHour: config.nightStartHour,
    nightEndHour: config.nightEndHour,
    nightStartLabel: formatHourLabel(config.nightStartHour),
    nightEndLabel: formatHourLabel(config.nightEndHour),
    maxAttempts: config.maxAttempts,
    windowSummary: config.enabled
      ? `${formatHourLabel(config.nightStartHour)} – ${formatHourLabel(config.nightEndHour)}`
      : 'Disabled',
  };
}

export function generateSafetyPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function hashSafetyPin(pin, rideRequestId) {
  return crypto
    .createHash('sha256')
    .update(`${getPinSecretMaterial()}:${Number(rideRequestId)}:${String(pin).trim()}`)
    .digest('hex');
}

export function encryptSafetyPin(pin, rideRequestId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(pin), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptSafetyPin(encryptedValue, rideRequestId) {
  if (!encryptedValue) return null;
  try {
    const payload = Buffer.from(String(encryptedValue), 'base64');
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    if (!/^\d{4}$/.test(decrypted)) return null;
    return decrypted;
  } catch {
    return null;
  }
}

export async function assignSafetyPinIfNeeded(rideRequestId, assignedAt = new Date()) {
  const rideId = Number(rideRequestId);
  if (!Number.isInteger(rideId) || rideId <= 0) return null;

  const settings = await getSafetyPinSettings();
  if (!isNightSafetyWindow(assignedAt, settings)) return null;

  const pin = generateSafetyPin();
  await query(
    `UPDATE ride_requests
     SET safety_pin_required = 1,
         safety_pin_hash = ?,
         safety_pin_encrypted = ?,
         safety_pin_verified_at = NULL,
         safety_pin_attempts = 0
     WHERE id = ?`,
    [hashSafetyPin(pin, rideId), encryptSafetyPin(pin, rideId), rideId]
  );

  return {
    required: true,
    pin,
  };
}

function resolveMaxAttempts(settings = null) {
  return clampAttempts(
    (settings || getCachedSafetyPinSettings()).maxAttempts,
    DEFAULT_SAFETY_PIN_MAX_ATTEMPTS
  );
}

export function buildPassengerSafetyPinPayload(ride) {
  const required = Number(ride?.safety_pin_required || 0) === 1;
  const verifiedAt = ride?.safety_pin_verified_at || null;
  const verified = Boolean(verifiedAt);
  const attempts = Number(ride?.safety_pin_attempts || 0);
  const maxAttempts = resolveMaxAttempts();

  if (!required) {
    return {
      safetyPinRequired: false,
      safetyPinVerified: false,
      safetyPinVerifiedAt: null,
      safetyPin: null,
      safetyPinAttempts: 0,
      safetyPinMaxAttempts: maxAttempts,
      safetyPinLocked: false,
    };
  }

  const pin = !verified && ['driver_assigned', 'driver_arrived'].includes(String(ride?.status || ''))
    ? decryptSafetyPin(ride?.safety_pin_encrypted, ride?.id)
    : null;

  return {
    safetyPinRequired: true,
    safetyPinVerified: verified,
    safetyPinVerifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null,
    safetyPin: pin,
    safetyPinAttempts: attempts,
    safetyPinMaxAttempts: maxAttempts,
    safetyPinLocked: attempts >= maxAttempts && !verified,
  };
}

export function buildDriverSafetyPinPayload(ride) {
  const required = Number(ride?.safety_pin_required || 0) === 1;
  const verifiedAt = ride?.safety_pin_verified_at || null;
  const verified = Boolean(verifiedAt);
  const attempts = Number(ride?.safety_pin_attempts || 0);
  const maxAttempts = resolveMaxAttempts();

  return {
    safetyPinRequired: required,
    safetyPinVerified: verified,
    safetyPinVerifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null,
    safetyPinAttempts: attempts,
    safetyPinMaxAttempts: maxAttempts,
    safetyPinLocked: required && attempts >= maxAttempts && !verified,
  };
}

export async function assertSafetyPinVerifiedForStart(ride) {
  const settings = await getSafetyPinSettings();
  const maxAttempts = resolveMaxAttempts(settings);
  if (Number(ride?.safety_pin_required || 0) !== 1) return null;
  if (ride?.safety_pin_verified_at) return null;
  if (Number(ride?.safety_pin_attempts || 0) >= maxAttempts) {
    const error = new Error('Too many incorrect PIN attempts. Ask the passenger to confirm before starting.');
    error.status = 429;
    throw error;
  }
  const error = new Error('Enter the passenger safety PIN before starting this ride.');
  error.status = 409;
  throw error;
}

export async function verifyRideSafetyPin({ rideRequestId, driverUserId, pin }) {
  const rideId = Number(rideRequestId);
  const normalizedPin = String(pin || '').trim();
  if (!/^\d{4}$/.test(normalizedPin)) {
    const error = new Error('Enter the 4-digit passenger PIN.');
    error.status = 400;
    throw error;
  }

  const settings = await getSafetyPinSettings();
  const maxAttempts = resolveMaxAttempts(settings);

  const [ride] = await query(
    `SELECT *
     FROM ride_requests
     WHERE id = ?
       AND driver_user_id = ?
     LIMIT 1`,
    [rideId, driverUserId]
  );
  if (!ride) {
    const error = new Error('Ride request not found');
    error.status = 404;
    throw error;
  }
  if (Number(ride.safety_pin_required || 0) !== 1) {
    return { ok: true, verified: true, alreadyVerified: true };
  }
  if (ride.safety_pin_verified_at) {
    return {
      ok: true,
      verified: true,
      alreadyVerified: true,
      verifiedAt: new Date(ride.safety_pin_verified_at).toISOString(),
    };
  }
  if (Number(ride.safety_pin_attempts || 0) >= maxAttempts) {
    const error = new Error('Too many incorrect PIN attempts. Ask the passenger to confirm before starting.');
    error.status = 429;
    throw error;
  }

  const expectedHash = String(ride.safety_pin_hash || '');
  const actualHash = hashSafetyPin(normalizedPin, rideId);
  if (!expectedHash || expectedHash !== actualHash) {
    const nextAttempts = Number(ride.safety_pin_attempts || 0) + 1;
    await query(
      `UPDATE ride_requests
       SET safety_pin_attempts = ?
       WHERE id = ?`,
      [nextAttempts, rideId]
    );
    const error = new Error(
      nextAttempts >= maxAttempts
        ? 'Incorrect PIN. Too many attempts — ask the passenger to confirm their driver.'
        : 'Incorrect passenger PIN. Try again.'
    );
    error.status = nextAttempts >= maxAttempts ? 429 : 401;
    error.attempts = nextAttempts;
    error.locked = nextAttempts >= maxAttempts;
    throw error;
  }

  await query(
    `UPDATE ride_requests
     SET safety_pin_verified_at = CURRENT_TIMESTAMP,
         safety_pin_attempts = 0
     WHERE id = ?`,
    [rideId]
  );

  return {
    ok: true,
    verified: true,
    alreadyVerified: false,
    verifiedAt: new Date().toISOString(),
    passengerUserId: ride.passenger_user_id,
  };
}
