import { assertNoActiveRestriction, restrictionErrorResponse } from '../lib/account-restrictions.js';
import { isSessionActive, verifyJwt } from '../lib/auth/tokens.js';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

let legacyVerifyToken = null;

/** Old app versions still send Clerk session tokens; accepted only while CLERK_SECRET_KEY is set. */
async function verifyLegacyClerkToken(token) {
  const secretKey = String(process.env.CLERK_SECRET_KEY || '').trim();
  if (!secretKey) return null;
  if (!legacyVerifyToken) {
    ({ verifyToken: legacyVerifyToken } = await import('@clerk/backend'));
  }
  try {
    const payload = await legacyVerifyToken(token, { secretKey });
    return payload?.sub ? payload : null;
  } catch {
    return null;
  }
}

function authError(message, code, status = 401) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Resolves a bearer token to { userId, payload }. Throws an error with .status/.code when the
 * token is missing, invalid, expired, or its session has ended.
 */
export async function verifyAuthToken(token) {
  if (!token) throw authError('Missing or invalid authorization', 'TOKEN_MISSING');

  let payload;
  try {
    payload = verifyJwt(token, 'access');
  } catch (error) {
    throw authError('Invalid or expired token', error?.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
  }

  if (payload) {
    let active;
    try {
      active = await isSessionActive(payload.sid);
    } catch (error) {
      console.error('[auth] session check failed', error?.message || error);
      throw authError('Could not check your session. Please try again.', 'AUTH_UNAVAILABLE', 503);
    }
    if (!active) throw authError('Session has ended. Please sign in again.', 'SESSION_INVALID');
    return { userId: payload.sub, payload };
  }

  const legacyPayload = await verifyLegacyClerkToken(token);
  if (legacyPayload) return { userId: legacyPayload.sub, payload: legacyPayload };
  throw authError('Invalid or expired token', 'TOKEN_INVALID');
}

export async function requireAuth(req, res, next) {
  let verified;
  try {
    verified = await verifyAuthToken(getTokenFromRequest(req));
  } catch (error) {
    return res.status(error?.status || 401).json({ error: error?.message || 'Invalid or expired token', code: error?.code || null });
  }

  try {
    await assertNoActiveRestriction(verified.userId, 'login');
  } catch (restrictionError) {
    if (restrictionError?.code !== 'ER_NO_SUCH_TABLE') {
      return res.status(restrictionError?.status || 403).json(restrictionErrorResponse(restrictionError));
    }
  }

  req.auth = verified.payload;
  req.userId = verified.userId;
  return next();
}
