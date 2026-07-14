import crypto from 'crypto';
import { query } from '../db/connection.js';

export const SAFETY_PIN_MAX_ATTEMPTS = 3;
const NIGHT_START_HOUR = Number(process.env.SAFETY_PIN_NIGHT_START_HOUR || 18);
const NIGHT_END_HOUR = Number(process.env.SAFETY_PIN_NIGHT_END_HOUR || 6);

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

export function isNightSafetyWindow(date = new Date()) {
  const hour = date.getHours();
  if (NIGHT_START_HOUR === NIGHT_END_HOUR) return true;
  if (NIGHT_START_HOUR < NIGHT_END_HOUR) {
    return hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
  }
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
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
  if (!isNightSafetyWindow(assignedAt)) return null;

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

export function buildPassengerSafetyPinPayload(ride) {
  const required = Number(ride?.safety_pin_required || 0) === 1;
  const verifiedAt = ride?.safety_pin_verified_at || null;
  const verified = Boolean(verifiedAt);
  const attempts = Number(ride?.safety_pin_attempts || 0);

  if (!required) {
    return {
      safetyPinRequired: false,
      safetyPinVerified: false,
      safetyPinVerifiedAt: null,
      safetyPin: null,
      safetyPinAttempts: 0,
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
    safetyPinLocked: attempts >= SAFETY_PIN_MAX_ATTEMPTS && !verified,
  };
}

export function buildDriverSafetyPinPayload(ride) {
  const required = Number(ride?.safety_pin_required || 0) === 1;
  const verifiedAt = ride?.safety_pin_verified_at || null;
  const verified = Boolean(verifiedAt);
  const attempts = Number(ride?.safety_pin_attempts || 0);

  return {
    safetyPinRequired: required,
    safetyPinVerified: verified,
    safetyPinVerifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null,
    safetyPinAttempts: attempts,
    safetyPinLocked: required && attempts >= SAFETY_PIN_MAX_ATTEMPTS && !verified,
  };
}

export function assertSafetyPinVerifiedForStart(ride) {
  if (Number(ride?.safety_pin_required || 0) !== 1) return null;
  if (ride?.safety_pin_verified_at) return null;
  if (Number(ride?.safety_pin_attempts || 0) >= SAFETY_PIN_MAX_ATTEMPTS) {
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
  if (Number(ride.safety_pin_attempts || 0) >= SAFETY_PIN_MAX_ATTEMPTS) {
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
      nextAttempts >= SAFETY_PIN_MAX_ATTEMPTS
        ? 'Incorrect PIN. Too many attempts — ask the passenger to confirm their driver.'
        : 'Incorrect passenger PIN. Try again.'
    );
    error.status = nextAttempts >= SAFETY_PIN_MAX_ATTEMPTS ? 429 : 401;
    error.attempts = nextAttempts;
    error.locked = nextAttempts >= SAFETY_PIN_MAX_ATTEMPTS;
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
