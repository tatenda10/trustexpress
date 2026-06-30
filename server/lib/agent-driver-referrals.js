import { query } from '../db/connection.js';

export function normalizeVehicleNumber(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

export async function resolveDriverByIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;

  if (raw.startsWith('user_')) {
    const rows = await query(
      `SELECT id, clerk_user_id, email, role, phone_number
       FROM users
       WHERE clerk_user_id = ?
       LIMIT 1`,
      [raw]
    );
    return rows[0] || null;
  }

  if (raw.includes('@')) {
    const rows = await query(
      `SELECT id, clerk_user_id, email, role, phone_number
       FROM users
       WHERE LOWER(email) = ?
       LIMIT 1`,
      [raw.toLowerCase()]
    );
    return rows[0] || null;
  }

  const vehicleNumber = normalizeVehicleNumber(raw);
  const rows = await query(
    `SELECT u.id, u.clerk_user_id, u.email, u.role, u.phone_number, dv.number_plate
     FROM driver_vehicle dv
     INNER JOIN users u ON u.clerk_user_id = dv.driver_user_id
     WHERE UPPER(REPLACE(REPLACE(dv.number_plate, ' ', ''), '-', '')) = ?
     LIMIT 1`,
    [vehicleNumber]
  );
  return rows[0] || null;
}

export async function getExistingDriverReferral(driverUserId) {
  const rows = await query(
    `SELECT
       r.id,
       r.driver_user_id,
       r.agent_user_id,
       r.invite_id,
       r.source,
       r.created_at,
       a.email AS agent_email,
       a.full_name AS agent_name,
       a.employee_code AS agent_employee_code
     FROM agent_driver_referrals r
     INNER JOIN agent_users a ON a.id = r.agent_user_id
     WHERE r.driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  return rows[0] || null;
}
