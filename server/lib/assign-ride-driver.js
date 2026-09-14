import { query } from '../db/connection.js';
import { assignSafetyPinIfNeeded } from './ride-safety-pin.js';
import { syncDiscountRedemptionForRide } from './ride-discounts.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideStatusToDriver,
  emitRideStatusToPassenger,
} from './realtime.js';

export function isAdminDispatchedRide(ride) {
  return String(ride?.booking_source || '') === 'admin_dispatch'
    || String(ride?.passenger_user_id || '').startsWith('dispatch:');
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return 0;
  const earthRadiusKm = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(end.latitude - start.latitude);
  const dLng = toRadians(end.longitude - start.longitude);
  const lat1 = toRadians(start.latitude);
  const lat2 = toRadians(end.latitude);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  );
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
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
  const driverDistanceKm = calculateDistanceKm(driverPoint, pickupPoint);
  const driverEtaMinutes = Math.max(1, Math.round(driverDistanceKm * 4));

  const updateResult = await query(
    `UPDATE ride_requests
     SET driver_user_id = ?,
         driver_name = ?,
         driver_phone = ?,
         driver_distance_km = ?,
         driver_eta_minutes = ?,
         status = 'driver_assigned',
         assigned_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status IN ('requested', 'driver_found')
       AND driver_user_id IS NULL`,
    [
      driverUserId,
      driverAvailability.driver_name,
      driverAvailability.phone_number,
      Number(driverDistanceKm.toFixed(2)),
      driverEtaMinutes,
      rideRequestId,
    ]
  );

  if (Number(updateResult?.affectedRows || 0) < 1) {
    const error = new Error('This ride could not be assigned to the driver anymore.');
    error.status = 409;
    throw error;
  }

  await query(
    `UPDATE ride_request_driver_responses
     SET status = CASE WHEN driver_user_id = ? THEN 'selected' ELSE status END,
         selected_at = CASE WHEN driver_user_id = ? THEN CURRENT_TIMESTAMP ELSE selected_at END
     WHERE ride_request_id = ?`,
    [driverUserId, driverUserId, rideRequestId]
  );

  await query(
    `UPDATE driver_availability
     SET is_online = 0,
         last_seen_at = CURRENT_TIMESTAMP
     WHERE driver_user_id = ?`,
    [driverUserId]
  );

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
  };
}
