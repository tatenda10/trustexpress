import { query } from '../db/connection.js';
import { getClerkUserById, toAppUser } from './clerk-user.js';

const DRIVER_ONLINE_STALE_DAYS = 1;

async function getUserProfileImageUrl(userId) {
  if (!userId) return null;
  try {
    const user = await getClerkUserById(userId);
    return toAppUser(user)?.image_url || null;
  } catch {
    return null;
  }
}

function buildViewingEligibilitySql(rideRequestId) {
  return {
    sql: `
      FROM ride_request_driver_responses rr
      INNER JOIN driver_availability da
        ON da.driver_user_id = rr.driver_user_id
       AND da.is_online = 1
       AND da.current_lat IS NOT NULL
       AND da.current_lng IS NOT NULL
       AND da.last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
      LEFT JOIN ride_requests active_ride
        ON active_ride.driver_user_id = rr.driver_user_id
       AND active_ride.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
      WHERE rr.ride_request_id = ?
        AND rr.status IN ('pending', 'accepted', 'selected')
        AND (rr.viewed_at IS NOT NULL OR rr.status IN ('accepted', 'selected'))
        AND active_ride.id IS NULL`,
    params: [rideRequestId],
  };
}

export async function markRideRequestsViewedByDriver(rideRequestIds, driverUserId) {
  const ids = [...new Set(
    (Array.isArray(rideRequestIds) ? rideRequestIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];
  if (!driverUserId || !ids.length) return 0;

  const placeholders = ids.map(() => '?').join(', ');
  const result = await query(
    `UPDATE ride_request_driver_responses
     SET viewed_at = COALESCE(viewed_at, CURRENT_TIMESTAMP)
     WHERE driver_user_id = ?
       AND ride_request_id IN (${placeholders})
       AND status IN ('pending', 'accepted', 'selected')`,
    [driverUserId, ...ids]
  );
  return Number(result?.affectedRows || 0);
}

export async function loadDriversViewingSnapshot(rideRequestId) {
  if (!Number.isInteger(Number(rideRequestId)) || Number(rideRequestId) <= 0) {
    return { driversViewingCount: 0, visibleDriversPreview: [] };
  }

  const eligibility = buildViewingEligibilitySql(Number(rideRequestId));

  const [countRow] = await query(
    `SELECT COUNT(*) AS total ${eligibility.sql}`,
    eligibility.params
  );

  const visibleDriverRows = await query(
    `SELECT
       rr.driver_user_id,
       da.driver_name,
       da.car_photo_url
     ${eligibility.sql}
     ORDER BY COALESCE(rr.viewed_at, rr.responded_at) ASC, rr.id ASC
     LIMIT 4`,
    eligibility.params
  );

  const visibleDriversPreview = await Promise.all(
    (visibleDriverRows || []).map(async (row) => ({
      id: row.driver_user_id,
      driverName: row.driver_name || 'Driver',
      profileImageUrl: await getUserProfileImageUrl(row.driver_user_id),
      carImage: row.car_photo_url || null,
    }))
  );

  return {
    driversViewingCount: Number(countRow?.total || 0),
    visibleDriversPreview,
  };
}
