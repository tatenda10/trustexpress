import { query } from '../db/connection.js';
import { createRestriction, listActiveRestrictions } from './account-restrictions.js';

const POLICY_REASON_PREFIX = 'Automatic ride-response restriction:';
const ALLOWED_SCOPES = new Set(['accept_rides', 'go_online', 'all']);

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
}

export async function getDriverResponsePolicySettings() {
  const [row] = await query(
    `SELECT is_enabled, missed_threshold, window_hours, restriction_duration_hours, restriction_scope
     FROM driver_response_policy_settings
     WHERE id = 1
     LIMIT 1`
  );

  const scope = String(row?.restriction_scope || 'accept_rides').trim().toLowerCase();
  return {
    isEnabled: row?.is_enabled === undefined ? true : Boolean(row.is_enabled),
    missedThreshold: clampInteger(row?.missed_threshold, 7, 1, 100),
    windowHours: clampInteger(row?.window_hours, 24, 1, 720),
    restrictionDurationHours: clampInteger(row?.restriction_duration_hours, 12, 1, 720),
    restrictionScope: ALLOWED_SCOPES.has(scope) ? scope : 'accept_rides',
  };
}

export function normalizeDriverResponsePolicySettings(payload = {}) {
  const scope = String(payload.restrictionScope || '').trim().toLowerCase();
  return {
    isEnabled: payload.isEnabled !== false,
    missedThreshold: clampInteger(payload.missedThreshold, 7, 1, 100),
    windowHours: clampInteger(payload.windowHours, 24, 1, 720),
    restrictionDurationHours: clampInteger(payload.restrictionDurationHours, 12, 1, 720),
    restrictionScope: ALLOWED_SCOPES.has(scope) ? scope : 'accept_rides',
  };
}

export async function saveDriverResponsePolicySettings(payload, adminUserId = null) {
  const settings = normalizeDriverResponsePolicySettings(payload);
  await query(
    `INSERT INTO driver_response_policy_settings (
       id, is_enabled, missed_threshold, window_hours, restriction_duration_hours,
       restriction_scope, updated_by_admin_id
     ) VALUES (1, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_enabled = VALUES(is_enabled),
       missed_threshold = VALUES(missed_threshold),
       window_hours = VALUES(window_hours),
       restriction_duration_hours = VALUES(restriction_duration_hours),
       restriction_scope = VALUES(restriction_scope),
       updated_by_admin_id = VALUES(updated_by_admin_id)`,
    [
      settings.isEnabled ? 1 : 0,
      settings.missedThreshold,
      settings.windowHours,
      settings.restrictionDurationHours,
      settings.restrictionScope,
      adminUserId || null,
    ]
  );
  return getDriverResponsePolicySettings();
}

export async function evaluateDriverResponsePolicy(driverUserId) {
  const safeDriverUserId = String(driverUserId || '').trim();
  if (!safeDriverUserId) return { restricted: false, reason: 'missing_driver' };

  const settings = await getDriverResponsePolicySettings();
  if (!settings.isEnabled) return { restricted: false, reason: 'disabled' };

  const activeRestrictions = await listActiveRestrictions(safeDriverUserId, settings.restrictionScope);
  if (activeRestrictions.length) return { restricted: false, reason: 'already_restricted' };

  const [lastAction] = await query(
    `SELECT MAX(triggering_response_id) AS last_response_id
     FROM driver_response_policy_actions
     WHERE driver_user_id = ?`,
    [safeDriverUserId]
  );
  const lastResponseId = Number(lastAction?.last_response_id || 0);

  const missedResponses = await query(
    `SELECT id
     FROM ride_request_driver_responses
     WHERE driver_user_id = ?
       AND id > ?
       AND opened_at IS NOT NULL
       AND accepted_at IS NULL
       AND status IN ('declined', 'expired')
       AND COALESCE(responded_at, updated_at, created_at) >= CURRENT_TIMESTAMP - INTERVAL ${settings.windowHours} HOUR
     ORDER BY id ASC
     LIMIT ${settings.missedThreshold}`,
    [safeDriverUserId, lastResponseId]
  );

  if (missedResponses.length < settings.missedThreshold) {
    return { restricted: false, reason: 'below_threshold', missedCount: missedResponses.length, settings };
  }

  const triggeringResponseId = Number(missedResponses[missedResponses.length - 1].id);
  const reservation = await query(
    `INSERT IGNORE INTO driver_response_policy_actions (
       driver_user_id, triggering_response_id, missed_count, threshold_value,
       window_hours, restriction_duration_hours, restriction_scope
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      safeDriverUserId,
      triggeringResponseId,
      missedResponses.length,
      settings.missedThreshold,
      settings.windowHours,
      settings.restrictionDurationHours,
      settings.restrictionScope,
    ]
  );
  if (!Number(reservation?.affectedRows || 0)) {
    return { restricted: false, reason: 'already_processed' };
  }

  try {
    const reason = `${POLICY_REASON_PREFIX} opened ${settings.missedThreshold} ride requests without accepting within ${settings.windowHours} hours.`;
    const restriction = await createRestriction({
      userId: safeDriverUserId,
      userRole: 'driver',
      scope: settings.restrictionScope,
      reason,
      expiresAt: new Date(Date.now() + (settings.restrictionDurationHours * 60 * 60 * 1000)),
      adminUserId: null,
    });
    await query(
      `UPDATE driver_response_policy_actions
       SET restriction_id = ?
       WHERE id = ?`,
      [restriction.id, reservation.insertId]
    );
    return { restricted: true, restriction, settings };
  } catch (error) {
    await query('DELETE FROM driver_response_policy_actions WHERE id = ?', [reservation.insertId]).catch(() => {});
    throw error;
  }
}

export async function listDriverResponsePerformance({ windowHours } = {}) {
  const settings = await getDriverResponsePolicySettings();
  const safeWindowHours = clampInteger(windowHours, settings.windowHours, 1, 720);
  const rows = await query(
    `SELECT
       rr.driver_user_id,
       COALESCE(NULLIF(TRIM(da.driver_name), ''), NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), 'Driver') AS driver_name,
       u.email,
       u.phone_number,
       COUNT(*) AS received_count,
       SUM(CASE WHEN rr.opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened_count,
       SUM(CASE WHEN rr.accepted_at IS NOT NULL THEN 1 ELSE 0 END) AS accepted_count,
       SUM(CASE WHEN rr.opened_at IS NOT NULL AND rr.accepted_at IS NULL AND rr.status IN ('declined', 'expired') THEN 1 ELSE 0 END) AS missed_count,
       SUM(CASE WHEN rr.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
       MAX(rr.opened_at) AS last_opened_at,
       MAX(CASE WHEN rr.status IN ('declined', 'expired') THEN rr.updated_at ELSE NULL END) AS last_missed_at,
       EXISTS(
         SELECT 1
         FROM user_account_restrictions restriction_row
         WHERE restriction_row.clerk_user_id COLLATE utf8mb4_unicode_ci = rr.driver_user_id COLLATE utf8mb4_unicode_ci
           AND restriction_row.status = 'active'
           AND restriction_row.starts_at <= CURRENT_TIMESTAMP
           AND (restriction_row.expires_at IS NULL OR restriction_row.expires_at > CURRENT_TIMESTAMP)
           AND restriction_row.scope IN ('all', 'accept_rides', 'go_online')
       ) AS is_restricted
     FROM ride_request_driver_responses rr
     LEFT JOIN users u
       ON u.clerk_user_id COLLATE utf8mb4_unicode_ci = rr.driver_user_id COLLATE utf8mb4_unicode_ci
     LEFT JOIN driver_availability da
       ON da.driver_user_id COLLATE utf8mb4_unicode_ci = rr.driver_user_id COLLATE utf8mb4_unicode_ci
     WHERE rr.responded_at >= CURRENT_TIMESTAMP - INTERVAL ? HOUR
     GROUP BY rr.driver_user_id, da.driver_name, u.first_name, u.last_name, u.email, u.phone_number
     ORDER BY missed_count DESC, opened_count DESC, last_opened_at DESC
     LIMIT 500`,
    [safeWindowHours]
  );

  return rows.map((row) => {
    const openedCount = Number(row.opened_count || 0);
    const acceptedCount = Number(row.accepted_count || 0);
    return {
      driverUserId: row.driver_user_id,
      driverName: row.driver_name,
      email: row.email || null,
      phoneNumber: row.phone_number || null,
      receivedCount: Number(row.received_count || 0),
      openedCount,
      acceptedCount,
      missedCount: Number(row.missed_count || 0),
      pendingCount: Number(row.pending_count || 0),
      acceptanceRate: openedCount > 0 ? Math.round((acceptedCount / openedCount) * 1000) / 10 : 0,
      lastOpenedAt: row.last_opened_at || null,
      lastMissedAt: row.last_missed_at || null,
      isRestricted: Boolean(row.is_restricted),
    };
  });
}

export async function listDriverResponsePolicyActions(limit = 100) {
  const safeLimit = clampInteger(limit, 100, 1, 500);
  return query(
    `SELECT
       action_row.id,
       action_row.driver_user_id,
       action_row.missed_count,
       action_row.threshold_value,
       action_row.window_hours,
       action_row.restriction_duration_hours,
       action_row.restriction_scope,
       action_row.restriction_id,
       action_row.created_at,
       u.email,
       COALESCE(NULLIF(TRIM(da.driver_name), ''), NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), 'Driver') AS driver_name
     FROM driver_response_policy_actions action_row
     LEFT JOIN users u
       ON u.clerk_user_id COLLATE utf8mb4_unicode_ci = action_row.driver_user_id COLLATE utf8mb4_unicode_ci
     LEFT JOIN driver_availability da
       ON da.driver_user_id COLLATE utf8mb4_unicode_ci = action_row.driver_user_id COLLATE utf8mb4_unicode_ci
     ORDER BY action_row.created_at DESC, action_row.id DESC
     LIMIT ${safeLimit}`
  );
}
