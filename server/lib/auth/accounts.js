import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../../db/connection.js';
import { normalizeZimbabwePhoneNumber } from '../phone-number.js';

const BCRYPT_ROUNDS = 10;
const MAX_FAILED_LOGINS_15_MIN = 5;
const MIN_PASSWORD_LENGTH = 8;

export function normalizeRole(value) {
  return String(value || '').trim().toLowerCase() === 'driver' ? 'driver' : 'passenger';
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizePhone(value) {
  const result = normalizeZimbabwePhoneNumber(value);
  return result.ok ? result.e164Phone : null;
}

/** Older rows may hold 07…, 2637… or +2637…; match all of them. */
function phoneVariants(e164Phone) {
  const national = e164Phone.slice(4);
  return [e164Phone, `263${national}`, `0${national}`];
}

export function assertPasswordStrength(password) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`), {
      status: 400,
      code: 'WEAK_PASSWORD',
    });
  }
}

export function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

export async function checkPassword(password, passwordHash) {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(String(password || ''), passwordHash);
  } catch {
    return false;
  }
}

/** Same 'user_' + 27-char shape as existing Clerk IDs, so every table that stores user IDs keeps working. */
export function generateUserId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (const byte of crypto.randomBytes(27)) id += alphabet[byte % alphabet.length];
  return `user_${id}`;
}

const USER_COLUMNS = `clerk_user_id AS id, email, first_name, last_name, image_url, role,
  phone_number, phone_verified_at, email_verified_at, password_hash, created_at`;

export async function findUserById(userId) {
  const [row] = await query(`SELECT ${USER_COLUMNS} FROM users WHERE clerk_user_id = ? LIMIT 1`, [userId]);
  return row || null;
}

export async function findUserByEmail(email, role) {
  const [row] = await query(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE LOWER(email) = ?
       AND role = ?
     ORDER BY (password_hash IS NOT NULL) DESC, updated_at DESC
     LIMIT 1`,
    [email, role]
  );
  return row || null;
}

export async function findUserByPhone(e164Phone, role) {
  const variants = phoneVariants(e164Phone);
  const [row] = await query(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE phone_number IN (?, ?, ?)
       AND role = ?
     ORDER BY (phone_verified_at IS NOT NULL) DESC, updated_at DESC
     LIMIT 1`,
    [...variants, role]
  );
  return row || null;
}

export async function createUser({
  role,
  email = null,
  emailVerified = false,
  phone = null,
  phoneVerified = false,
  firstName = null,
  lastName = null,
  passwordHash = null,
}) {
  const userId = generateUserId();
  await query(
    `INSERT INTO users (
       clerk_user_id, email, first_name, last_name, role,
       phone_number, phone_verified_at, email_verified_at, password_hash, password_updated_at,
       clerk_imported_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      userId,
      email,
      firstName ? String(firstName).trim().slice(0, 120) : null,
      lastName ? String(lastName).trim().slice(0, 120) : null,
      normalizeRole(role),
      phone,
      phoneVerified ? new Date() : null,
      emailVerified ? new Date() : null,
      passwordHash,
      passwordHash ? new Date() : null,
    ]
  );
  return findUserById(userId);
}

export async function setUserPassword(userId, passwordHash) {
  await query(
    `UPDATE users SET password_hash = ?, password_updated_at = CURRENT_TIMESTAMP WHERE clerk_user_id = ?`,
    [passwordHash, userId]
  );
}

export async function markEmailVerified(userId) {
  await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE clerk_user_id = ?`,
    [userId]
  );
}

export async function markPhoneVerified(userId, e164Phone) {
  await query(
    `UPDATE users
     SET phone_number = ?,
         phone_verified_at = COALESCE(phone_verified_at, CURRENT_TIMESTAMP)
     WHERE clerk_user_id = ?`,
    [e164Phone, userId]
  );
}

export async function assertLoginNotLocked(identifier, ipAddress) {
  const [row] = await query(
    `SELECT COUNT(*) AS failures
     FROM auth_login_attempts
     WHERE identifier = ?
       AND succeeded = 0
       AND created_at >= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE`,
    [identifier]
  );
  if (Number(row?.failures || 0) >= MAX_FAILED_LOGINS_15_MIN) {
    throw Object.assign(
      new Error('Too many wrong passwords. Please wait 15 minutes or reset your password.'),
      { status: 429, code: 'LOGIN_LOCKED' }
    );
  }
  if (ipAddress) {
    const [ipRow] = await query(
      `SELECT COUNT(*) AS failures
       FROM auth_login_attempts
       WHERE ip_address = ?
         AND succeeded = 0
         AND created_at >= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE`,
      [ipAddress]
    );
    if (Number(ipRow?.failures || 0) >= MAX_FAILED_LOGINS_15_MIN * 6) {
      throw Object.assign(new Error('Too many sign-in attempts from this network. Please try again later.'), {
        status: 429,
        code: 'LOGIN_LOCKED',
      });
    }
  }
}

export async function recordLoginAttempt(identifier, ipAddress, succeeded) {
  await query(
    `INSERT INTO auth_login_attempts (identifier, ip_address, succeeded) VALUES (?, ?, ?)`,
    [identifier, ipAddress, succeeded ? 1 : 0]
  ).catch((error) => console.error('[auth.accounts] login attempt log failed', error?.message || error));
}

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: normalizeRole(row.role),
    email: row.email || null,
    emailVerified: Boolean(row.email_verified_at),
    phoneNumber: row.phone_number || null,
    phoneVerified: Boolean(row.phone_verified_at),
    firstName: row.first_name || null,
    lastName: row.last_name || null,
    imageUrl: row.image_url || null,
    hasPassword: Boolean(row.password_hash),
  };
}
