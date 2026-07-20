import { query } from '../db/connection.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideStatusToDriver,
  emitRideStatusToPassenger,
} from './realtime.js';

/** How long a captain's accepted offer stays selectable before it is removed. */
export const DRIVER_ACCEPT_OFFER_TTL_SECONDS = 30;
export const DRIVER_REQUEST_REOFFER_DELAY_SECONDS = 5;
/** Abandoned open searches expire so admin/driver queues do not keep ghost "requested" rides forever. */
export const OPEN_RIDE_REQUEST_ABANDON_TTL_MINUTES = Number(
  process.env.OPEN_RIDE_REQUEST_ABANDON_TTL_MINUTES || 15
);

export async function reconcileOpenRideRequestStatus(rideRequestId) {
  if (!Number.isInteger(Number(rideRequestId)) || Number(rideRequestId) <= 0) return;

  const [counts] = await query(
    `SELECT
       SUM(CASE WHEN status IN ('accepted', 'selected') THEN 1 ELSE 0 END) AS active_acceptances
     FROM ride_request_driver_responses
     WHERE ride_request_id = ?`,
    [rideRequestId]
  );

  const activeAcceptances = Number(counts?.active_acceptances || 0);
  const [ride] = await query(
    `SELECT id, status
     FROM ride_requests
     WHERE id = ?
     LIMIT 1`,
    [rideRequestId]
  );

  if (!ride || !['requested', 'driver_found'].includes(String(ride.status || ''))) {
    return;
  }

  if (activeAcceptances > 0) {
    await query(
      `UPDATE ride_requests
       SET status = 'driver_found',
           driver_found_at = COALESCE(driver_found_at, CURRENT_TIMESTAMP)
       WHERE id = ?
         AND status = 'requested'
         AND driver_user_id IS NULL`,
      [rideRequestId]
    );
    return;
  }

  await query(
    `UPDATE ride_requests
     SET status = 'requested',
         driver_found_at = NULL
     WHERE id = ?
       AND status = 'driver_found'
       AND driver_user_id IS NULL`,
    [rideRequestId]
  );
}

export async function expireStaleAcceptedDriverOffers(rideRequestId = null) {
  const params = [DRIVER_ACCEPT_OFFER_TTL_SECONDS];
  let rideFilter = '';
  if (rideRequestId != null) {
    rideFilter = ' AND rr.ride_request_id = ?';
    params.push(Number(rideRequestId));
  }

  const staleRows = await query(
    `SELECT rr.ride_request_id, rr.driver_user_id
     FROM ride_request_driver_responses rr
     INNER JOIN ride_requests r ON r.id = rr.ride_request_id
     WHERE rr.status = 'accepted'
       AND rr.responded_at < (CURRENT_TIMESTAMP - INTERVAL ? SECOND)
       AND r.status IN ('requested', 'driver_found')
       AND r.driver_user_id IS NULL
       ${rideFilter}`,
    params
  );

  if (!Array.isArray(staleRows) || staleRows.length === 0) {
    return { expiredOffers: [], reconciledRideIds: [] };
  }

  await query(
    `UPDATE ride_request_driver_responses rr
     INNER JOIN ride_requests r ON r.id = rr.ride_request_id
     SET rr.status = 'pending',
         rr.responded_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${DRIVER_REQUEST_REOFFER_DELAY_SECONDS} SECOND)
     WHERE rr.status = 'accepted'
       AND rr.responded_at < (CURRENT_TIMESTAMP - INTERVAL ? SECOND)
       AND r.status IN ('requested', 'driver_found')
       AND r.driver_user_id IS NULL
       ${rideFilter}`,
    params
  );

  const affectedRideIds = [...new Set(staleRows.map((row) => row.ride_request_id))];
  for (const id of affectedRideIds) {
    await reconcileOpenRideRequestStatus(id);
  }

  staleRows.forEach((row) => {
    emitRideRequestRemovedFromDriver(row.driver_user_id, {
      rideRequestId: row.ride_request_id,
      reason: 'accept_offer_expired',
    });
    emitRideStatusToDriver(row.driver_user_id, {
      rideRequestId: row.ride_request_id,
      status: 'pending',
      reason: 'accept_offer_expired',
    });
  });

  return {
    expiredOffers: staleRows,
    reconciledRideIds: affectedRideIds,
  };
}

export async function expireAbandonedOpenRideRequests({ ttlMinutes = OPEN_RIDE_REQUEST_ABANDON_TTL_MINUTES } = {}) {
  const safeTtlMinutes = Math.max(5, Math.min(Number(ttlMinutes) || OPEN_RIDE_REQUEST_ABANDON_TTL_MINUTES, 24 * 60));

  const abandonedRows = await query(
    `SELECT id, passenger_user_id
     FROM ride_requests
     WHERE status IN ('requested', 'driver_found')
       AND driver_user_id IS NULL
       AND requested_at < (CURRENT_TIMESTAMP - INTERVAL ${safeTtlMinutes} MINUTE)`
  );

  if (!Array.isArray(abandonedRows) || abandonedRows.length === 0) {
    return { expiredRideIds: [] };
  }

  const rideIds = abandonedRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!rideIds.length) {
    return { expiredRideIds: [] };
  }

  const placeholders = rideIds.map(() => '?').join(', ');
  await query(
    `UPDATE ride_requests
     SET status = 'expired',
         cancellation_reason = 'No driver accepted before the request expired',
         cancelled_by = 'system',
         cancelled_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})
       AND status IN ('requested', 'driver_found')
       AND driver_user_id IS NULL`,
    rideIds
  );

  const responseRows = await query(
    `SELECT ride_request_id, driver_user_id
     FROM ride_request_driver_responses
     WHERE ride_request_id IN (${placeholders})`,
    rideIds
  );

  const notifiedDrivers = new Set();
  (Array.isArray(responseRows) ? responseRows : []).forEach((row) => {
    const driverUserId = String(row.driver_user_id || '').trim();
    const rideRequestId = Number(row.ride_request_id);
    if (!driverUserId || !Number.isInteger(rideRequestId) || rideRequestId <= 0) return;
    const key = `${driverUserId}:${rideRequestId}`;
    if (notifiedDrivers.has(key)) return;
    notifiedDrivers.add(key);
    emitRideRequestRemovedFromDriver(driverUserId, {
      rideRequestId,
      reason: 'request_expired',
    });
    emitRideStatusToDriver(driverUserId, {
      rideRequestId,
      status: 'expired',
      reason: 'request_expired',
    });
  });

  abandonedRows.forEach((row) => {
    if (!row.passenger_user_id) return;
    emitRideStatusToPassenger(row.passenger_user_id, {
      rideRequestId: row.id,
      status: 'expired',
      reason: 'request_expired',
    });
  });

  return { expiredRideIds: rideIds };
}

export async function refreshOpenRideOffers(rideRequestId = null) {
  const [offers, abandoned] = await Promise.all([
    expireStaleAcceptedDriverOffers(rideRequestId),
    expireAbandonedOpenRideRequests(),
  ]);
  return {
    ...offers,
    abandoned,
  };
}
