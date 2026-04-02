import crypto from 'crypto';
import { query } from '../db/connection.js';

const SESSION_DAYS = Number(process.env.AGENT_SESSION_DAYS) || 7;

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function createSession(agentUserId) {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = sha256(rawToken);

  await query(
    `INSERT INTO agent_sessions (agent_user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [agentUserId, tokenHash, SESSION_DAYS]
  );

  return rawToken;
}

export async function revokeSession(tokenHash) {
  await query('UPDATE agent_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?', [tokenHash]);
}

export async function requireAgentAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }

  const tokenHash = sha256(token);

  try {
    const sessions = await query(
      `SELECT s.agent_user_id, s.expires_at, s.revoked_at, a.id, a.full_name, a.email, a.phone_number, a.employee_code, a.is_active
       FROM agent_sessions s
       JOIN agent_users a ON a.id = s.agent_user_id
       WHERE s.token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    const session = sessions[0];
    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const expiresAt = new Date(session.expires_at).getTime();
    if (session.revoked_at || Number.isNaN(expiresAt) || expiresAt < Date.now()) {
      return res.status(401).json({ error: 'Session expired' });
    }

    if (!session.is_active) {
      return res.status(403).json({ error: 'Agent account is inactive' });
    }

    await query('UPDATE agent_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?', [tokenHash]);

    req.agent = {
      id: session.id,
      full_name: session.full_name,
      email: session.email,
      phone_number: session.phone_number,
      employee_code: session.employee_code,
      role: 'agent',
    };
    req.agentTokenHash = tokenHash;
    return next();
  } catch (err) {
    console.error('Agent auth middleware', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

requireAgentAuth.createSession = createSession;
requireAgentAuth.revokeSession = revokeSession;

export { sha256 };
