import { query } from '../db/connection.js';
import { normalizeUploadPath } from './driver-verification-mysql.js';

export async function getPassengerIdentity(passengerUserId) {
  const [row] = await query(
    `SELECT *
     FROM passenger_identity
     WHERE passenger_user_id = ?
     LIMIT 1`,
    [passengerUserId]
  );
  return row || null;
}

export async function listPassengerIdentities(passengerUserIds = []) {
  if (!Array.isArray(passengerUserIds) || passengerUserIds.length === 0) return [];

  const uniqueIds = [...new Set(passengerUserIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => '?').join(', ');
  return query(
    `SELECT *
     FROM passenger_identity
     WHERE passenger_user_id IN (${placeholders})`,
    uniqueIds
  );
}

export function shapePassengerIdentityFromRow(row) {
  if (!row) return null;
  return {
    status: row.identity_status || 'pending',
    submittedAt: row.identity_submitted_at ? new Date(row.identity_submitted_at).toISOString() : null,
    reviewedAt: row.identity_reviewed_at ? new Date(row.identity_reviewed_at).toISOString() : null,
    rejectionReason: row.identity_rejection_reason || null,
    canResubmit: row.identity_can_resubmit === undefined ? true : !!row.identity_can_resubmit,
    nationalIdFrontUrl: normalizeUploadPath(row.national_id_front_url),
    nationalIdBackUrl: normalizeUploadPath(row.national_id_back_url),
  };
}

export async function getPassengerVerificationFromMysql(passengerUserId) {
  const identity = await getPassengerIdentity(passengerUserId);
  return {
    passengerIdentity: shapePassengerIdentityFromRow(identity),
  };
}
