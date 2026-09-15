import { query } from '../db/connection.js';

function normalizeToken(value) {
  const token = String(value || '').trim();
  return token || null;
}

export async function upsertDriverPushTokens({
  driverUserId,
  expoPushToken = undefined,
  fcmToken = undefined,
} = {}) {
  const safeDriverUserId = String(driverUserId || '').trim();
  if (!safeDriverUserId) return null;

  const hasExpo = expoPushToken !== undefined;
  const hasFcm = fcmToken !== undefined;
  if (!hasExpo && !hasFcm) return null;

  const nextExpo = hasExpo ? normalizeToken(expoPushToken) : null;
  const nextFcm = hasFcm ? normalizeToken(fcmToken) : null;

  await query(
    `INSERT INTO driver_push_tokens (
       driver_user_id,
       expo_push_token,
       fcm_token
     ) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       expo_push_token = IF(VALUES(expo_push_token) IS NULL, expo_push_token, VALUES(expo_push_token)),
       fcm_token = IF(VALUES(fcm_token) IS NULL, fcm_token, VALUES(fcm_token)),
       updated_at = CURRENT_TIMESTAMP`,
    [
      safeDriverUserId,
      hasExpo ? nextExpo : null,
      hasFcm ? nextFcm : null,
    ]
  );

  return {
    driverUserId: safeDriverUserId,
    expoPushToken: hasExpo ? nextExpo : undefined,
    fcmToken: hasFcm ? nextFcm : undefined,
  };
}

export async function getDriverPushTokensByUserIds(driverUserIds = []) {
  const ids = [...new Set(
    (Array.isArray(driverUserIds) ? driverUserIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  )];
  const byId = new Map();
  if (!ids.length) return byId;

  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(
    `SELECT driver_user_id, expo_push_token, fcm_token
     FROM driver_push_tokens
     WHERE driver_user_id IN (${placeholders})`,
    ids
  );

  for (const row of rows || []) {
    byId.set(String(row.driver_user_id), {
      expoPushToken: normalizeToken(row.expo_push_token),
      fcmToken: normalizeToken(row.fcm_token),
    });
  }
  return byId;
}
