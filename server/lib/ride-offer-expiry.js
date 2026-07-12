import { query } from '../db/connection.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideStatusToDriver,
} from './realtime.js';

/** How long a captain's accepted offer stays selectable before it is removed. */
export const DRIVER_ACCEPT_OFFER_TTL_SECONDS = 30;

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
     SET rr.status = 'expired',
         rr.responded_at = CURRENT_TIMESTAMP
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
      status: 'requested',
      reason: 'accept_offer_expired',
    });
  });

  return {
    expiredOffers: staleRows,
    reconciledRideIds: affectedRideIds,
  };
}

export async function refreshOpenRideOffers(rideRequestId = null) {
  return expireStaleAcceptedDriverOffers(rideRequestId);
}
