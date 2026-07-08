import { verifyToken } from '@clerk/backend';
import { query } from '../db/connection.js';

const ENFORCE_SINGLE_SESSION = String(process.env.ENFORCE_SINGLE_SESSION || 'true').toLowerCase() !== 'false';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

export async function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    if (ENFORCE_SINGLE_SESSION) {
      const sessionId = String(payload?.sid || '').trim();
      const issuedAtSeconds = Number(payload?.iat || 0);
      if (sessionId && Number.isFinite(issuedAtSeconds) && issuedAtSeconds > 0) {
        try {
          await query(
            `INSERT INTO end_user_sessions (
               clerk_user_id,
               clerk_session_id,
               session_issued_at,
               last_seen_at
             ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
               clerk_session_id = CASE
                 WHEN VALUES(session_issued_at) >= session_issued_at THEN VALUES(clerk_session_id)
                 ELSE clerk_session_id
               END,
               session_issued_at = GREATEST(session_issued_at, VALUES(session_issued_at)),
               last_seen_at = CURRENT_TIMESTAMP`,
            [payload.sub, sessionId, issuedAtSeconds]
          );

          const [resolved] = await query(
            `SELECT clerk_session_id, session_issued_at
             FROM end_user_sessions
             WHERE clerk_user_id = ?
             LIMIT 1`,
            [payload.sub]
          );

          const resolvedSessionId = String(resolved?.clerk_session_id || '').trim();
          const resolvedIssuedAt = Number(resolved?.session_issued_at || 0);
          const supersededByNewerSession =
            resolvedSessionId !== sessionId && resolvedIssuedAt > issuedAtSeconds;
          if (supersededByNewerSession) {
            return res.status(401).json({
              error: 'This account is active on another device. Please sign in again.',
              code: 'SESSION_REPLACED',
            });
          }
        } catch (sessionError) {
          if (sessionError?.code !== 'ER_NO_SUCH_TABLE') {
            console.error('[auth] single-session check failed', sessionError);
          }
        }
      }
    }

    req.auth = payload;
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
