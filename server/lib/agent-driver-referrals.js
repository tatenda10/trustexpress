import { query, withTransaction } from '../db/connection.js';
import { resolveClerkUserIdForMetadataSync } from './clerk-user.js';

export function normalizeVehicleNumber(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

export async function repairStaleDriverClerkUserId({ staleClerkUserId, liveClerkUserId }) {
  const staleId = String(staleClerkUserId || '').trim();
  const liveId = String(liveClerkUserId || '').trim();
  if (!staleId || !liveId || staleId === liveId) {
    return { repaired: false };
  }

  return withTransaction(async (connection) => {
    const exec = (sql, params) => connection.execute(sql, params);

    const [liveReferralRows] = await exec(
      'SELECT id FROM agent_driver_referrals WHERE driver_user_id = ? LIMIT 1',
      [liveId]
    );
    const [staleReferralRows] = await exec(
      'SELECT id FROM agent_driver_referrals WHERE driver_user_id = ? LIMIT 1',
      [staleId]
    );
    if (liveReferralRows[0] && staleReferralRows[0]) {
      await exec('DELETE FROM agent_driver_referrals WHERE driver_user_id = ?', [staleId]);
    } else if (staleReferralRows[0]) {
      await exec(
        'UPDATE agent_driver_referrals SET driver_user_id = ? WHERE driver_user_id = ?',
        [liveId, staleId]
      );
    }

    for (const table of ['driver_identity', 'driver_vehicle', 'driver_availability']) {
      const [liveRows] = await exec(
        `SELECT driver_user_id FROM ${table} WHERE driver_user_id = ? LIMIT 1`,
        [liveId]
      );
      const [staleRows] = await exec(
        `SELECT driver_user_id FROM ${table} WHERE driver_user_id = ? LIMIT 1`,
        [staleId]
      );
      if (liveRows[0] && staleRows[0]) {
        await exec(`DELETE FROM ${table} WHERE driver_user_id = ?`, [staleId]);
      } else if (staleRows[0]) {
        await exec(
          `UPDATE ${table} SET driver_user_id = ? WHERE driver_user_id = ?`,
          [liveId, staleId]
        );
      }
    }

    for (const table of [
      'ride_requests',
      'ride_request_driver_responses',
      'ride_lost_items',
      'ride_panic_alerts',
      'discount_code_redemptions',
      'driver_discount_reimbursements',
    ]) {
      await exec(
        `UPDATE ${table} SET driver_user_id = ? WHERE driver_user_id = ?`,
        [liveId, staleId]
      );
    }

    const [liveUserRows] = await exec(
      'SELECT id FROM users WHERE clerk_user_id = ? LIMIT 1',
      [liveId]
    );
    const [staleUserRows] = await exec(
      'SELECT id FROM users WHERE clerk_user_id = ? LIMIT 1',
      [staleId]
    );
    if (liveUserRows[0] && staleUserRows[0]) {
      await exec('DELETE FROM users WHERE clerk_user_id = ?', [staleId]);
    } else if (staleUserRows[0]) {
      await exec(
        'UPDATE users SET clerk_user_id = ? WHERE clerk_user_id = ?',
        [liveId, staleId]
      );
    }

    return { repaired: true, staleClerkUserId: staleId, liveClerkUserId: liveId };
  });
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
    const driver = rows[0] || null;
    if (!driver) return null;
    return refreshDriverClerkUserId(driver);
  }

  if (raw.includes('@')) {
    const rows = await query(
      `SELECT id, clerk_user_id, email, role, phone_number
       FROM users
       WHERE LOWER(email) = ?
       LIMIT 1`,
      [raw.toLowerCase()]
    );
    const driver = rows[0] || null;
    if (!driver) return null;
    return refreshDriverClerkUserId(driver);
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
  const driver = rows[0] || null;
  if (!driver) return null;

  return refreshDriverClerkUserId(driver);
}

async function refreshDriverClerkUserId(driver) {
  const identity = await resolveClerkUserIdForMetadataSync({
    clerkUserId: driver.clerk_user_id,
    email: driver.email,
    role: driver.role,
  });

  if (!identity.repaired || !identity.clerkUserId) {
    return driver;
  }

  await repairStaleDriverClerkUserId({
    staleClerkUserId: identity.staleMysqlClerkUserId || driver.clerk_user_id,
    liveClerkUserId: identity.clerkUserId,
  });

  return {
    ...driver,
    clerk_user_id: identity.clerkUserId,
  };
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

export async function detachDriverFromAgent({ driverUserId, agentUserId }) {
  if (!driverUserId || !agentUserId) return false;

  const result = await query(
    `DELETE FROM agent_driver_referrals
     WHERE driver_user_id = ? AND agent_user_id = ?`,
    [driverUserId, agentUserId]
  );
  return result.affectedRows > 0;
}

export async function detachPassengerFromAgent({ passengerUserId, agentUserId }) {
  if (!passengerUserId || !agentUserId) return false;

  const result = await query(
    `DELETE FROM agent_passenger_referrals
     WHERE passenger_user_id = ? AND agent_user_id = ?`,
    [passengerUserId, agentUserId]
  );
  return result.affectedRows > 0;
}
