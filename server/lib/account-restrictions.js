import { query } from '../db/connection.js';
import { assertAccountNotRestricted as assertRatingAccountNotRestricted } from './rating-performance.js';

export const RESTRICTION_SCOPES = new Set([
  'all',
  'login',
  'request_rides',
  'go_online',
  'accept_rides',
  'cash_out',
]);

const SCOPE_LABELS = {
  all: 'all Trust Express activity',
  login: 'signing in',
  request_rides: 'requesting rides',
  go_online: 'going online',
  accept_rides: 'accepting rides',
  cash_out: 'cashing out',
};

function normalizeScope(scope) {
  const value = String(scope || '').trim().toLowerCase();
  return RESTRICTION_SCOPES.has(value) ? value : 'all';
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return ['driver', 'passenger'].includes(value) ? value : 'any';
}

function toMysqlDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePhoneForLookup(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

export async function resolveRestrictionUserId(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return '';
  if (raw.startsWith('user_') || raw.startsWith('whatsapp:') || raw.startsWith('dispatch:')) {
    return raw;
  }

  const phoneDigits = normalizePhoneForLookup(raw);
  const params = [raw, `user_${raw}`, raw, raw];
  const phoneSql = phoneDigits
    ? `OR REPLACE(REPLACE(REPLACE(REPLACE(u.phone_number, '+', ''), ' ', ''), '-', ''), '.', '') = ?`
    : '';
  if (phoneDigits) params.push(phoneDigits);

  const [user] = await query(
    `SELECT u.clerk_user_id
     FROM users u
     WHERE u.clerk_user_id = ?
        OR u.clerk_user_id = ?
        OR u.email = ?
        OR LOWER(u.email) = LOWER(?)
        ${phoneSql}
     LIMIT 1`,
    params
  );
  return user?.clerk_user_id || raw;
}

export function durationToExpiry(duration) {
  const value = String(duration || '').trim().toLowerCase();
  if (value === 'permanent') return null;
  const hours = value === '12h' ? 12 : value === '24h' ? 24 : value === '48h' ? 48 : Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function shapeRestriction(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: row.clerk_user_id,
    userRole: row.user_role || 'any',
    scope: row.scope || 'all',
    scopeLabel: SCOPE_LABELS[row.scope] || row.scope || 'account activity',
    status: row.status || 'active',
    reason: row.reason || '',
    startsAt: toIsoOrNull(row.starts_at),
    expiresAt: toIsoOrNull(row.expires_at),
    isPermanent: !row.expires_at,
    createdByAdminId: row.created_by_admin_id === null ? null : Number(row.created_by_admin_id),
    liftedByAdminId: row.lifted_by_admin_id === null ? null : Number(row.lifted_by_admin_id),
    liftedAt: toIsoOrNull(row.lifted_at),
    liftReason: row.lift_reason || null,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

export function shapeAudit(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    restrictionId: row.restriction_id === null ? null : Number(row.restriction_id),
    userId: row.clerk_user_id,
    action: row.action,
    previousScope: row.previous_scope || null,
    newScope: row.new_scope || null,
    previousExpiresAt: toIsoOrNull(row.previous_expires_at),
    newExpiresAt: toIsoOrNull(row.new_expires_at),
    reason: row.reason || null,
    adminUserId: row.admin_user_id === null ? null : Number(row.admin_user_id),
    createdAt: toIsoOrNull(row.created_at),
  };
}

async function expireElapsedRestrictions(userId = null) {
  const params = [];
  const userSql = userId ? 'AND clerk_user_id = ?' : '';
  if (userId) params.push(userId);

  const rows = await query(
    `SELECT id, clerk_user_id, scope, expires_at
     FROM user_account_restrictions
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= CURRENT_TIMESTAMP
       ${userSql}`,
    params
  );

  if (!rows.length) return;

  const ids = rows.map((row) => Number(row.id)).filter(Boolean);
  if (!ids.length) return;
  await query(
    `UPDATE user_account_restrictions
     SET status = 'expired',
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );

  for (const row of rows) {
    await query(
      `INSERT INTO user_account_restriction_audit (
         restriction_id, clerk_user_id, action, previous_scope, new_scope,
         previous_expires_at, new_expires_at, reason
       ) VALUES (?, ?, 'expired', ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.clerk_user_id,
        row.scope,
        row.scope,
        row.expires_at || null,
        row.expires_at || null,
        'Temporary restriction expired automatically',
      ]
    );
  }
}

export async function listActiveRestrictions(userId, scope = 'all') {
  const normalizedScope = normalizeScope(scope);
  await expireElapsedRestrictions(userId);
  const rows = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE clerk_user_id = ?
       AND status = 'active'
       AND starts_at <= CURRENT_TIMESTAMP
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       AND scope IN ('all', ?)
     ORDER BY CASE WHEN expires_at IS NULL THEN 0 ELSE 1 END, expires_at ASC, id DESC`,
    [userId, normalizedScope]
  );
  return rows.map(shapeRestriction);
}

export async function listUserRestrictions(userId) {
  await expireElapsedRestrictions(userId);
  const rows = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE clerk_user_id = ?
     ORDER BY status = 'active' DESC, created_at DESC, id DESC
     LIMIT 100`,
    [userId]
  );
  return rows.map(shapeRestriction);
}

export async function listUserRestrictionAudit(userId) {
  const rows = await query(
    `SELECT *
     FROM user_account_restriction_audit
     WHERE clerk_user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
    [userId]
  );
  return rows.map(shapeAudit);
}

export function buildRestrictionNotice(restriction) {
  const reason = restriction?.reason || 'Account restriction';
  const scopeLabel = restriction?.scopeLabel || 'this action';
  const when = restriction?.expiresAt
    ? `Access returns on ${new Date(restriction.expiresAt).toLocaleString('en-ZW', { timeZone: 'Africa/Harare' })}.`
    : 'This restriction is permanent until an authorised admin lifts it.';
  return `${reason}. Restricted: ${scopeLabel}. ${when} Contact support if you need help.`;
}

export async function assertNoActiveRestriction(userId, scope) {
  const active = await listActiveRestrictions(userId, scope);
  if (!active.length) return null;

  const restriction = active[0];
  const error = new Error(buildRestrictionNotice(restriction));
  error.status = 403;
  error.code = restriction.scope === 'login' ? 'ACCOUNT_LOGIN_RESTRICTED' : 'ACCOUNT_RESTRICTED';
  error.restriction = restriction;
  throw error;
}

export async function assertUserCanPerform({ userId, user, role, scope }) {
  assertRatingAccountNotRestricted(user, role);
  return assertNoActiveRestriction(userId, scope);
}

export function restrictionErrorResponse(error) {
  return {
    error: error?.message || 'Account is restricted.',
    code: error?.code || 'ACCOUNT_RESTRICTED',
    restriction: error?.restriction || null,
  };
}

export function requireNoRestriction(scope) {
  return async (req, res, next) => {
    try {
      await assertNoActiveRestriction(req.userId, scope);
      return next();
    } catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE') return next();
      return res.status(error?.status || 403).json(restrictionErrorResponse(error));
    }
  };
}

export async function createRestriction({
  userId,
  userRole = 'any',
  scope = 'all',
  reason,
  expiresAt = null,
  adminUserId = null,
}) {
  const requestedUserId = String(userId || '').trim();
  const safeUserId = await resolveRestrictionUserId(requestedUserId);
  const safeReason = String(reason || '').trim();
  if (!safeUserId) {
    const error = new Error('User id is required');
    error.status = 400;
    throw error;
  }
  if (!safeReason) {
    const error = new Error('Restriction reason is required');
    error.status = 400;
    throw error;
  }
  if (
    !safeUserId.startsWith('user_')
    && !safeUserId.startsWith('whatsapp:')
    && !safeUserId.startsWith('dispatch:')
  ) {
    const error = new Error('User not found. Search and copy the full Clerk user ID, email, or phone number.');
    error.status = 404;
    throw error;
  }

  const normalizedScope = normalizeScope(scope);
  const normalizedRole = normalizeRole(userRole);
  const expiry = toMysqlDate(expiresAt);

  const result = await query(
    `INSERT INTO user_account_restrictions (
       clerk_user_id, user_role, scope, status, reason, starts_at, expires_at, created_by_admin_id
     ) VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, ?, ?)`,
    [safeUserId, normalizedRole, normalizedScope, safeReason, expiry, adminUserId || null]
  );

  await query(
    `INSERT INTO user_account_restriction_audit (
       restriction_id, clerk_user_id, action, new_scope, new_expires_at, reason, admin_user_id
     ) VALUES (?, ?, 'created', ?, ?, ?, ?)`,
    [result.insertId, safeUserId, normalizedScope, expiry, safeReason, adminUserId || null]
  );

  const [row] = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );
  return shapeRestriction(row);
}

export async function extendRestriction({ restrictionId, expiresAt, reason, adminUserId = null }) {
  const [existing] = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE id = ?
     LIMIT 1`,
    [restrictionId]
  );
  if (!existing) {
    const error = new Error('Restriction not found');
    error.status = 404;
    throw error;
  }

  const expiry = toMysqlDate(expiresAt);
  await query(
    `UPDATE user_account_restrictions
     SET expires_at = ?,
         status = 'active',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [expiry, restrictionId]
  );
  await query(
    `INSERT INTO user_account_restriction_audit (
       restriction_id, clerk_user_id, action, previous_scope, new_scope,
       previous_expires_at, new_expires_at, reason, admin_user_id
     ) VALUES (?, ?, 'extended', ?, ?, ?, ?, ?, ?)`,
    [
      restrictionId,
      existing.clerk_user_id,
      existing.scope,
      existing.scope,
      existing.expires_at || null,
      expiry,
      String(reason || '').trim() || 'Restriction extended',
      adminUserId || null,
    ]
  );
  const [updated] = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE id = ?
     LIMIT 1`,
    [restrictionId]
  );
  return shapeRestriction(updated);
}

export async function liftRestriction({ restrictionId, reason, adminUserId = null }) {
  const [existing] = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE id = ?
     LIMIT 1`,
    [restrictionId]
  );
  if (!existing) {
    const error = new Error('Restriction not found');
    error.status = 404;
    throw error;
  }

  await query(
    `UPDATE user_account_restrictions
     SET status = 'lifted',
         lifted_by_admin_id = ?,
         lifted_at = CURRENT_TIMESTAMP,
         lift_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [adminUserId || null, String(reason || '').trim() || null, restrictionId]
  );
  await query(
    `INSERT INTO user_account_restriction_audit (
       restriction_id, clerk_user_id, action, previous_scope, new_scope,
       previous_expires_at, new_expires_at, reason, admin_user_id
     ) VALUES (?, ?, 'lifted', ?, ?, ?, ?, ?, ?)`,
    [
      restrictionId,
      existing.clerk_user_id,
      existing.scope,
      existing.scope,
      existing.expires_at || null,
      existing.expires_at || null,
      String(reason || '').trim() || 'Restriction lifted',
      adminUserId || null,
    ]
  );
  const [updated] = await query(
    `SELECT *
     FROM user_account_restrictions
     WHERE id = ?
     LIMIT 1`,
    [restrictionId]
  );
  return shapeRestriction(updated);
}
