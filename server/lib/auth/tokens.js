import crypto from 'crypto';
import { query } from '../../db/connection.js';

export const AUTH_TOKEN_ISSUER = 'trust-express';
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS) || 60 * 60;
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS) || 90;

function getSecret() {
  const secret = String(process.env.AUTH_JWT_SECRET || '').trim();
  if (secret.length < 32) {
    throw Object.assign(new Error('AUTH_JWT_SECRET must be set to at least 32 characters'), { status: 500 });
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(data) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function signJwt(claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: AUTH_TOKEN_ISSUER, iat: now, exp: now + ttlSeconds, ...claims }));
  return `${header}.${payload}.${hmac(`${header}.${payload}`)}`;
}

/** Returns the payload, or null if the token is not one of ours (e.g. a Clerk token). Throws if ours but invalid. */
export function verifyJwt(token, expectedType) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.iss !== AUTH_TOKEN_ISSUER) return null;

  const expected = Buffer.from(hmac(`${parts[0]}.${parts[1]}`));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error('Invalid token signature'), { status: 401 });
  }
  if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('Token expired'), { status: 401, code: 'TOKEN_EXPIRED' });
  }
  if (expectedType && payload.typ !== expectedType) {
    throw Object.assign(new Error('Wrong token type'), { status: 401 });
  }
  return payload;
}

function makeAccessToken({ userId, sessionId, role }) {
  return signJwt({ typ: 'access', sub: userId, sid: sessionId, role }, ACCESS_TOKEN_TTL_SECONDS);
}

function makeRefreshToken(sessionId) {
  return `${sessionId}.${crypto.randomBytes(32).toString('base64url')}`;
}

function buildTokenResponse({ userId, sessionId, role, refreshToken }) {
  return {
    accessToken: makeAccessToken({ userId, sessionId, role }),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    sessionId,
  };
}

export async function createSession({ userId, role, deviceName = null, platform = null, ipAddress = null }) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const refreshToken = makeRefreshToken(sessionId);
  await query(
    `INSERT INTO auth_sessions (
       id, user_id, refresh_token_hash, device_name, platform, ip_address, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL ${REFRESH_TOKEN_TTL_DAYS} DAY)`,
    [
      sessionId,
      userId,
      sha256Hex(refreshToken),
      deviceName ? String(deviceName).slice(0, 120) : null,
      platform ? String(platform).slice(0, 20) : null,
      ipAddress,
    ]
  );
  return buildTokenResponse({ userId, sessionId, role, refreshToken });
}

export async function refreshSession(refreshToken, { loadRole }) {
  const token = String(refreshToken || '').trim();
  const sessionId = token.split('.')[0];
  if (!/^[a-f0-9]{32}$/.test(sessionId)) {
    throw Object.assign(new Error('Invalid refresh token'), { status: 401, code: 'SESSION_INVALID' });
  }

  const [session] = await query(
    `SELECT id, user_id, refresh_token_hash, previous_token_hash,
            expires_at < CURRENT_TIMESTAMP AS expired,
            revoked_at
     FROM auth_sessions
     WHERE id = ?
     LIMIT 1`,
    [sessionId]
  );
  if (!session || session.revoked_at || Number(session.expired) === 1) {
    throw Object.assign(new Error('Session has ended. Please sign in again.'), { status: 401, code: 'SESSION_INVALID' });
  }

  const presentedHash = sha256Hex(token);
  const isCurrent = presentedHash === session.refresh_token_hash;
  const isPrevious = presentedHash === session.previous_token_hash;

  if (!isCurrent && !isPrevious) {
    throw Object.assign(new Error('Session has ended. Please sign in again.'), { status: 401, code: 'SESSION_INVALID' });
  }

  // Refresh tokens remain stable for the life of the session. Rotating them made a lost
  // response or failed device-storage write look like token theft and revoked valid users.
  // Accept and promote the previous hash once so sessions created by the old rotation logic
  // can recover without asking the user to sign in again.
  await query(
    `UPDATE auth_sessions
     SET refresh_token_hash = ?,
         previous_token_hash = NULL,
         rotated_at = NULL,
         last_used_at = CURRENT_TIMESTAMP,
         expires_at = CURRENT_TIMESTAMP + INTERVAL ${REFRESH_TOKEN_TTL_DAYS} DAY
     WHERE id = ?`,
    [presentedHash, sessionId]
  );

  const role = await loadRole(session.user_id);
  return buildTokenResponse({ userId: session.user_id, sessionId, role, refreshToken: token });
}

export async function revokeSession(sessionId, reason = 'sign_out') {
  if (!sessionId) return;
  await query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
         revoked_reason = COALESCE(revoked_reason, ?)
     WHERE id = ?`,
    [reason, sessionId]
  );
}

export async function revokeAllUserSessions(userId, { exceptSessionId = null, reason = 'revoked' } = {}) {
  if (!userId) return;
  await query(
    `UPDATE auth_sessions
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_reason = ?
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND (? IS NULL OR id <> ?)`,
    [reason, userId, exceptSessionId, exceptSessionId]
  );
}

export async function isSessionActive(sessionId) {
  const [row] = await query(
    `SELECT 1 AS ok
     FROM auth_sessions
     WHERE id = ?
       AND revoked_at IS NULL
       AND expires_at >= CURRENT_TIMESTAMP
     LIMIT 1`,
    [sessionId]
  );
  return Boolean(row);
}
