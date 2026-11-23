import { query, withTransaction } from '../db/connection.js';
import { assignSafetyPinIfNeeded } from './ride-safety-pin.js';
import { syncDiscountRedemptionForRide } from './ride-discounts.js';
import { holdDriverCancellationCommission } from './driver-cancellation-reserve.js';
import { getDriverApproachEstimate } from './driver-approach-estimate.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideStatusToDriver,
  emitRideStatusToPassenger,
} from './realtime.js';

export function isAdminDispatchedRide(ride) {
  return String(ride?.booking_source || '') === 'admin_dispatch'
    || String(ride?.passenger_user_id || '').startsWith('dispatch:');
}

export async function assignAcceptedDriverToRide({
  ride,
  driverUserId,
  driverAvailability,
}) {
  const rideRequestId = Number(ride?.id);
  if (!rideRequestId || !driverUserId || !driverAvailability) {
    const error = new Error('Ride and driver are required to assign');
    error.status = 400;
    throw error;
  }

  const pickupPoint = {
    latitude: Number(ride.pickup_lat),
    longitude: Number(ride.pickup_lng),
  };
  const driverPoint = {
    latitude: Number(driverAvailability.current_lat),
    longitude: Number(driverAvailability.current_lng),
  };
  const approachEstimate = await getDriverApproachEstimate(driverPoint, pickupPoint);
  const driverDistanceKm = approachEstimate.distanceKm;
  const driverEtaMinutes = approachEstimate.etaMinutes;

  const commissionReserve = await withTransaction(async (connection) => {
    const [lockedRideRows] = await connection.execute(
      `SELECT * FROM ride_requests WHERE id = ? FOR UPDATE`,
      [rideRequestId]
    );
    const lockedRide = lockedRideRows[0];
    if (!lockedRide
      || !['requested', 'driver_found'].includes(String(lockedRide.status || ''))
      || lockedRide.driver_user_id) {
      const error = new Error('This ride could not be assigned to the driver anymore.');
      error.status = 409;
      throw error;
    }

    await connection.execute(
      `UPDATE ride_requests
       SET driver_user_id = ?, driver_name = ?, driver_phone = ?,
           driver_distance_km = ?, driver_eta_minutes = ?,
           status = 'driver_assigned', assigned_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        driverUserId,
        driverAvailability.driver_name,
        driverAvailability.phone_number,
        Number(driverDistanceKm.toFixed(2)),
        driverEtaMinutes,
        rideRequestId,
      ]
    );

    await connection.execute(
      `UPDATE ride_request_driver_responses
       SET status = CASE WHEN driver_user_id = ? THEN 'selected' ELSE status END,
           selected_at = CASE WHEN driver_user_id = ? THEN CURRENT_TIMESTAMP ELSE selected_at END
       WHERE ride_request_id = ?`,
      [driverUserId, driverUserId, rideRequestId]
    );

    await connection.execute(
      `UPDATE driver_availability
       SET is_online = 0, last_seen_at = CURRENT_TIMESTAMP
       WHERE driver_user_id = ?`,
      [driverUserId]
    );

    return holdDriverCancellationCommission(connection, {
      rideRequestId,
      ridePublicId: lockedRide.public_id,
      driverUserId,
      passengerUserId: lockedRide.passenger_user_id,
      passengerName: lockedRide.passenger_name,
      fareAmount: lockedRide.final_estimated_amount || lockedRide.estimated_amount,
      currency: lockedRide.currency_code || 'USD',
      paymentStatus: lockedRide.payment_status,
      paymentMethod: lockedRide.payment_method,
      previousStatus: lockedRide.status,
    });
  });

  if (Number(ride.discount_code_id || 0) > 0 || Number(ride.discount_amount || 0) > 0) {
    await syncDiscountRedemptionForRide({
      rideRequestId,
      passengerUserId: ride.passenger_user_id,
      driverUserId,
      discount: {
        id: ride.discount_code_id,
        code: ride.discount_code,
        discountType: ride.discount_type,
        discountValue: Number(ride.discount_value || 0),
        originalFareAmount: Number(ride.original_estimated_amount || ride.estimated_amount || 0),
        discountAmount: Number(ride.discount_amount || 0),
        finalFareAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0),
        driverReimbursementAmount: Number(ride.driver_reimbursement_amount || 0),
      },
    });
  }

  await assignSafetyPinIfNeeded(rideRequestId, new Date());

  emitRideStatusToPassenger(ride.passenger_user_id, {
    rideRequestId,
    status: 'driver_assigned',
    driverUserId,
    driverCoordinate: {
      latitude: Number(driverAvailability.current_lat),
      longitude: Number(driverAvailability.current_lng),
    },
  });
  emitRideStatusToDriver(driverUserId, {
    rideRequestId,
    status: 'driver_assigned',
    passengerUserId: ride.passenger_user_id,
  });

  const otherDriverIds = await query(
    `SELECT driver_user_id
     FROM ride_request_driver_responses
     WHERE ride_request_id = ?
       AND driver_user_id <> ?`,
    [rideRequestId, driverUserId]
  );

  otherDriverIds.forEach((row) => {
    emitRideRequestRemovedFromDriver(row.driver_user_id, {
      rideRequestId,
      reason: 'selected_by_passenger',
    });
  });

  return {
    driverDistanceKm: Number(driverDistanceKm.toFixed(2)),
    driverEtaMinutes,
    commissionReserve,
  };
}
