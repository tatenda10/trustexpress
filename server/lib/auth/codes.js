import crypto from 'crypto';
import { query } from '../../db/connection.js';
import { deliverCode } from './messaging.js';
import { sha256Hex } from './tokens.js';

const CODE_TTL_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_SENDS_PER_DESTINATION_15_MIN = 3;
const MAX_SENDS_PER_DESTINATION_DAY = 10;
const MAX_SENDS_PER_IP_HOUR = 20;
const MIN_SECONDS_BETWEEN_SENDS = 30;

export const CODE_CHANNELS = ['email', 'sms', 'whatsapp'];

function tooMany(message, retryAfterSeconds = null) {
  return Object.assign(new Error(message), { status: 429, code: 'TOO_MANY_CODES', retryAfterSeconds });
}

function hashCode(destination, purpose, code) {
  // Bound to destination+purpose so a code for one number can't be replayed for another.
  return sha256Hex(`${destination}|${purpose}|${code}`);
}

async function assertCanSend({ destination, ipAddress }) {
  const [counts] = await query(
    `SELECT
       SUM(created_at >= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE) AS last_15_min,
       COUNT(*) AS last_day,
       MIN(TIMESTAMPDIFF(SECOND, created_at, CURRENT_TIMESTAMP)) AS seconds_since_last
     FROM auth_codes
     WHERE destination = ?
       AND created_at >= CURRENT_TIMESTAMP - INTERVAL 1 DAY`,
    [destination]
  );
  const secondsSinceLast = counts?.seconds_since_last === null ? null : Number(counts?.seconds_since_last);
  if (secondsSinceLast !== null && secondsSinceLast < MIN_SECONDS_BETWEEN_SENDS) {
    const wait = MIN_SECONDS_BETWEEN_SENDS - secondsSinceLast;
    throw tooMany(`Please wait ${wait} seconds before asking for another code.`, wait);
  }
  if (Number(counts?.last_15_min || 0) >= MAX_SENDS_PER_DESTINATION_15_MIN) {
    throw tooMany('Too many codes requested. Please wait 15 minutes and try again.', 15 * 60);
  }
  if (Number(counts?.last_day || 0) >= MAX_SENDS_PER_DESTINATION_DAY) {
    throw tooMany('Too many codes requested today. Please try again tomorrow.', 24 * 60 * 60);
  }

  if (ipAddress) {
    const [ipCounts] = await query(
      `SELECT COUNT(*) AS total
       FROM auth_codes
       WHERE ip_address = ?
         AND created_at >= CURRENT_TIMESTAMP - INTERVAL 1 HOUR`,
      [ipAddress]
    );
    if (Number(ipCounts?.total || 0) >= MAX_SENDS_PER_IP_HOUR) {
      throw tooMany('Too many codes requested from this network. Please try again later.', 60 * 60);
    }
  }
}

/** `destination` is a lowercase email or an E.164 phone (+2637…). */
export async function sendCode({ purpose, channel, destination, role = null, ipAddress = null }) {
  if (!CODE_CHANNELS.includes(channel)) {
    throw Object.assign(new Error('Choose email, SMS or WhatsApp'), { status: 400 });
  }
  await assertCanSend({ destination, ipAddress });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const result = await query(
    `INSERT INTO auth_codes (purpose, channel, destination, role, code_hash, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL ${CODE_TTL_MINUTES} MINUTE)`,
    [purpose, channel, destination, role, hashCode(destination, purpose, code), ipAddress]
  );

  try {
    await deliverCode({ channel, destination, code, purpose, expiresInMinutes: CODE_TTL_MINUTES });
  } catch (error) {
    // Don't count an undelivered code against the person's limits.
    await query(`DELETE FROM auth_codes WHERE id = ?`, [result.insertId]).catch(() => {});
    console.error('[auth.codes] delivery failed', { channel, purpose, message: error?.message || String(error) });
    throw Object.assign(
      new Error(error?.status === 503
        ? `${channel === 'email' ? 'Email' : channel === 'sms' ? 'SMS' : 'WhatsApp'} codes are not available right now. Please choose another option.`
        : error?.message || 'Could not send the code. Please try again.'),
      { status: error?.status === 503 ? 503 : 502, code: 'CODE_DELIVERY_FAILED' }
    );
  }

  return { channel, expiresInSeconds: CODE_TTL_MINUTES * 60, resendAfterSeconds: MIN_SECONDS_BETWEEN_SENDS };
}

/** Consumes the latest unexpired code for this destination+purpose; throws on mismatch. */
export async function verifyCode({ purpose, destination, code }) {
  const cleanCode = String(code || '').replace(/\D/g, '');
  const invalid = () => Object.assign(new Error('That code is not correct or has expired.'), { status: 400, code: 'CODE_INVALID' });
  if (cleanCode.length !== 6) throw invalid();

  const [row] = await query(
    `SELECT id, code_hash, attempts, role
     FROM auth_codes
     WHERE destination = ?
       AND purpose = ?
       AND consumed_at IS NULL
       AND expires_at >= CURRENT_TIMESTAMP
     ORDER BY id DESC
     LIMIT 1`,
    [destination, purpose]
  );
  if (!row) throw invalid();
  if (Number(row.attempts) >= MAX_VERIFY_ATTEMPTS) {
    throw Object.assign(new Error('Too many wrong attempts. Please request a new code.'), { status: 429, code: 'CODE_LOCKED' });
  }

  const expected = Buffer.from(row.code_hash);
  const actual = Buffer.from(hashCode(destination, purpose, cleanCode));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    await query(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    throw invalid();
  }

  const consumed = await query(
    `UPDATE auth_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ? AND consumed_at IS NULL`,
    [row.id]
  );
  if (Number(consumed?.affectedRows || 0) !== 1) throw invalid();
  return { role: row.role || null };
}
