import crypto from 'crypto';
import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import { fetchCachedDirections } from '../lib/maps-directions.js';
import { isCoordinateInBulawayoServiceArea } from '../lib/service-area.js';
import { writeRideReceiptPdf } from '../lib/ride-receipt-pdf.js';
import { sendExpoPushNotifications, sendFcmNotifications } from '../lib/push.js';
import { findBestAutoDiscountForRide, syncDiscountRedemptionForRide, validateDiscountForRide } from '../lib/ride-discounts.js';
import { normalizeRatingTags } from '../lib/ride-rating-tags.js';
import { buildRideStopsPayload, sanitizeIntermediateStops, stringifyIntermediateStops } from '../lib/ride-stops.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideChatMessageToUser,
  emitRideRequestToDriver,
  emitRideStatusToDriver,
  emitRideStatusToPassenger,
  emitTripRatingToDriver,
} from '../lib/realtime.js';
import { loadDriversViewingSnapshot } from '../lib/ride-driver-responses.js';

const router = Router();

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(start, end) {
  if (!start || !end) return 0;
  const earthRadiusKm = 6371;
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

function createPublicRideId() {
  return `TR-${crypto.randomInt(100000, 999999)}`;
}

const OPEN_REQUEST_TTL_MINUTES = 3;
const DRIVER_FOUND_SELECTION_TTL_SECONDS = 30;
const ACTIVE_RIDE_STATUSES = ['driver_assigned', 'driver_arrived', 'in_progress'];
const STALE_ACTIVE_RIDE_TTL_MINUTES = 20;
const DRIVER_REQUEST_RADIUS_KM = 20;
const MAX_DRIVER_OFFERS = 8;
const DRIVER_ONLINE_STALE_DAYS = 1;
const LOST_ITEM_MAX_LENGTH = 2000;
const MAX_RIDE_TIP_AMOUNT = 200;
const PANIC_ALERT_MESSAGE_MAX_LENGTH = 500;

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function createCaseReference(prefix, rideRequestId) {
  return `${prefix}-${String(rideRequestId || '').padStart(6, '0')}-${crypto.randomInt(100, 999)}`;
}

async function requirePassenger(req, res) {
  const user = await getClerkUserById(req.userId);
  const appUser = toAppUser(user);
  const role = normalizeRole(appUser.role);
  // Allow both passengers and drivers to create and manage ride requests
  // when they are using the consumer (passenger) side of the app.
  if (role !== 'passenger' && role !== 'driver') {
    res.status(403).json({ error: 'Not allowed to perform passenger ride actions' });
    return null;
  }
  return user;
}

async function loadPassengerTier(selectedTierKey) {
  const normalizedTierKey = String(selectedTierKey || '').trim().toLowerCase();
  const rows = await query(
    `SELECT
       t.tier_key,
       t.tier_name,
       t.price_per_km,
       t.base_fare,
       t.per_minute_rate,
       t.minimum_fare
     FROM operating_region_pricing_tiers t
     INNER JOIN operating_regions r ON r.id = t.region_id
     WHERE t.is_active = 1 AND r.is_active = 1
     ORDER BY
       CASE WHEN LOWER(t.tier_key) = ? THEN 0 ELSE 1 END,
       t.sort_order ASC,
       t.id ASC`,
    [normalizedTierKey]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    tier_key: row.tier_key,
    tier_name: row.tier_name,
    price_per_km: Number(row.price_per_km || 0),
    base_fare: Number(row.base_fare || 0),
    per_minute_rate: Number(row.per_minute_rate || 0),
    minimum_fare: Number(row.minimum_fare || 0),
  };
}

function calculateTierFare(tier, distanceKm) {
  const baseFare = Number(tier?.base_fare || 0);
  const pricePerKm = Number(tier?.price_per_km || 0);
  const minimumFare = Number(tier?.minimum_fare || 0);
  return Math.ceil(Math.max(baseFare + (Number(distanceKm || 0) * pricePerKm), minimumFare));
}

function mapDriverAvailability(row, pickupCoordinate) {
  const lat = Number(row.current_lat);
  const lng = Number(row.current_lng);
  const hasCoordinate = Number.isFinite(lat) && Number.isFinite(lng);
  const coordinate = hasCoordinate
    ? {
        latitude: lat,
        longitude: lng,
      }
    : null;
  const driverDistanceKm = hasCoordinate ? calculateDistanceKm(pickupCoordinate, coordinate) : null;
  return {
    id: row.driver_user_id,
    tierName: row.vehicle_tier_name,
    carName: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle',
    plate: row.number_plate || 'Unknown plate',
    driverName: row.driver_name || 'Driver',
    etaMinutes: hasCoordinate ? Math.max(1, Math.round(driverDistanceKm * 4)) : null,
    driverDistanceKm,
    amount: Number(row.estimated_amount || 0),
    rating: 4.9,
    trips: Number(row.completed_rides || row.total_rides || 0),
    phoneNumber: row.phone_number || null,
    coordinate,
    tier: {
      tierKey: row.vehicle_tier_key,
      tierName: row.vehicle_tier_name,
    },
    carImage: row.car_photo_url || null,
  };
}

function mapAcceptedDriverOffer(row, pickupCoordinate, estimatedAmount = 0) {
  const lat = Number(row.current_lat);
  const lng = Number(row.current_lng);
  const coordinate = Number.isFinite(lat) && Number.isFinite(lng)
    ? { latitude: lat, longitude: lng }
    : null;
  const driverDistanceKm = coordinate ? calculateDistanceKm(pickupCoordinate, coordinate) : null;
  return {
    id: row.driver_user_id,
    tierName: row.vehicle_tier_name || 'Ride',
    carName: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle',
    plate: row.number_plate || 'Unknown plate',
    driverName: row.driver_name || 'Driver',
    etaMinutes: coordinate ? Math.max(1, Math.round(driverDistanceKm * 4)) : null,
    driverDistanceKm,
    amount: Number(estimatedAmount || 0),
    rating: 4.9,
    trips: Number(row.completed_rides || row.total_rides || 0),
    phoneNumber: row.phone_number || null,
    coordinate,
    tier: {
      tierKey: row.vehicle_tier_key || null,
      tierName: row.vehicle_tier_name || 'Ride',
    },
    carImage: row.car_photo_url || null,
    profileImageUrl: row.profile_image_url || null,
  };
}

async function loadDriverRideStats(driverUserIds = []) {
  const normalizedIds = Array.from(
    new Set(driverUserIds.map((value) => String(value || '').trim()).filter(Boolean))
  );
  if (normalizedIds.length === 0) return new Map();

  const placeholders = normalizedIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT
       driver_user_id,
       COUNT(*) AS total_rides,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_rides
     FROM ride_requests
     WHERE driver_user_id IN (${placeholders})
     GROUP BY driver_user_id`,
    normalizedIds
  );

  return new Map(
    rows.map((row) => [
      row.driver_user_id,
      {
        totalRides: Number(row.total_rides || 0),
        completedRides: Number(row.completed_rides || 0),
      },
    ])
  );
}

function attachDriverRideStats(row, driverStatsMap) {
  const stats = driverStatsMap.get(row?.driver_user_id) || null;
  return {
    ...row,
    total_rides: stats?.totalRides || 0,
    completed_rides: stats?.completedRides || 0,
  };
}

function mapPassengerRideStatus(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled' || status === 'expired') return 'Cancelled';
  return 'Requested';
}

function mapPassengerTripStage(status) {
  if (status === 'driver_arrived') return 'waiting_at_pickup';
  if (status === 'in_progress') return 'on_trip';
  if (status === 'completed') return 'completed';
  return 'driver_on_the_way';
}

function toIsoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

function computeExpiresAt(value, ttlMinutes = OPEN_REQUEST_TTL_MINUTES) {
  if (!value) return null;
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + ttlMinutes);
  return date.toISOString();
}

function computeExpiresAtSeconds(value, ttlSeconds) {
  if (!value) return null;
  const date = new Date(value);
  date.setSeconds(date.getSeconds() + ttlSeconds);
  return date.toISOString();
}

function computeRideExpiresAt(status, requestedAt, driverFoundAt = null) {
  if (String(status || '') === 'driver_found') {
    return computeExpiresAtSeconds(driverFoundAt || requestedAt, DRIVER_FOUND_SELECTION_TTL_SECONDS);
  }
  return computeExpiresAt(requestedAt, OPEN_REQUEST_TTL_MINUTES);
}

function isOpenRideRequest(status) {
  return status === 'requested' || status === 'driver_found';
}

function mapRideMessage(row) {
  return {
    id: row.id,
    rideRequestId: row.ride_request_id,
    senderUserId: row.sender_user_id,
    recipientUserId: row.recipient_user_id,
    senderRole: row.sender_role,
    message: row.message,
    createdAt: toIsoOrNull(row.created_at),
    readAt: toIsoOrNull(row.read_at),
  };
}

function formatRideReceiptText(ride) {
  const fareAmount = Number(ride.final_estimated_amount || ride.estimated_amount || 0);
  const originalFareAmount = Number(ride.original_estimated_amount || fareAmount);
  const discountAmount = Number(ride.discount_amount || 0);
  const tipAmount = Number(ride.tip_amount || 0);
  const totalAmount = fareAmount + tipAmount;
  const lines = [
    'TrustCars Ride Receipt',
    '----------------------',
    `Receipt #: RCPT-${ride.id}`,
    `Trip ID: ${ride.public_id || ride.id}`,
    `Status: ${mapPassengerRideStatus(ride.status)}`,
    `Requested: ${ride.requested_at ? new Date(ride.requested_at).toISOString() : '-'}`,
    `Completed: ${ride.completed_at ? new Date(ride.completed_at).toISOString() : '-'}`,
    '',
    `Passenger: ${ride.passenger_name || 'Passenger'}`,
    `Driver: ${ride.driver_name || 'N/A'}`,
    `Pickup: ${ride.pickup_label || '-'}`,
    ...buildRideStopsPayload(ride).intermediateStops.map((stop, index) => `Stop ${index + 1}: ${stop.label}`),
    `Drop-off: ${ride.dropoff_label || '-'}`,
    '',
    `Tier: ${ride.requested_tier_name || 'Ride'}`,
    `Original Fare: $${originalFareAmount.toFixed(2)}`,
    `Discount: -$${discountAmount.toFixed(2)}`,
    `Fare: $${fareAmount.toFixed(2)}`,
    `Tip: $${tipAmount.toFixed(2)}`,
    `Total: $${totalAmount.toFixed(2)}`,
  ];
  return `${lines.join('\n')}\n`;
}

function buildRideDiscountPayload(ride) {
  const originalEstimatedAmount = Number(ride.original_estimated_amount || ride.originalEstimatedAmount || ride.estimated_amount || 0);
  const discountAmount = Number(ride.discount_amount || ride.discountAmount || 0);
  const finalEstimatedAmount = Number(ride.final_estimated_amount || ride.finalEstimatedAmount || ride.estimated_amount || 0);
  const driverReimbursementAmount = Number(ride.driver_reimbursement_amount || ride.driverReimbursementAmount || 0);
  return {
    originalEstimatedAmount,
    discountAmount,
    finalEstimatedAmount,
    driverReimbursementAmount,
    discountCode: ride.discount_code || ride.discountCode || null,
    discountType: ride.discount_type || ride.discountType || null,
    discountValue: ride.discount_value === null || ride.discount_value === undefined
      ? null
      : Number(ride.discount_value),
    discountAppliedAt: toIsoOrNull(ride.discount_applied_at || ride.discountAppliedAt),
    hasDiscountApplied: discountAmount > 0,
  };
}

async function getUserProfileImageUrl(userId) {
  if (!userId) return null;
  try {
    const user = await getClerkUserById(userId);
    return toAppUser(user)?.image_url || null;
  } catch {
    return null;
  }
}

async function loadAuthorizedRideChat(rideRequestId, userId) {
  if (!rideRequestId || !userId) return null;

  const rows = await query(
    `SELECT
       id,
       passenger_user_id,
       driver_user_id,
       passenger_name,
       driver_name,
       status
     FROM ride_requests
     WHERE id = ?
       AND (passenger_user_id = ? OR driver_user_id = ?)
     LIMIT 1`,
    [rideRequestId, userId, userId]
  );

  const ride = rows[0];
  if (!ride) return null;

  const isPassenger = String(ride.passenger_user_id || '') === String(userId);
  const senderRole = isPassenger ? 'passenger' : 'driver';
  const recipientUserId = isPassenger ? ride.driver_user_id : ride.passenger_user_id;
  const chatTitle = isPassenger ? (ride.driver_name || 'Driver') : (ride.passenger_name || 'Passenger');

  return {
    ride,
    senderRole,
    recipientUserId: recipientUserId || null,
    chatTitle,
  };
}

async function expireRideRequestIfTimedOut(rideId, passengerUserId = null) {
  if (!rideId) return false;

  const params = [rideId];
  let passengerClause = '';
  if (passengerUserId) {
    passengerClause = ' AND passenger_user_id = ?';
    params.push(passengerUserId);
  }

  const result = await query(
    `UPDATE ride_requests
     SET status = 'expired',
         cancellation_reason = 'No driver accepted the request in time',
         cancelled_at = CURRENT_TIMESTAMP
     WHERE id = ?
       ${passengerClause}
       AND (
         (status = 'requested' AND requested_at < (CURRENT_TIMESTAMP - INTERVAL ${OPEN_REQUEST_TTL_MINUTES} MINUTE))
         OR (
           status = 'driver_found'
           AND COALESCE(driver_found_at, requested_at) < (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_FOUND_SELECTION_TTL_SECONDS} SECOND)
         )
       )`,
    params
  );

  return Number(result?.affectedRows || 0) > 0;
}

async function loadEligibleDriversForRide({ pickupPoint, estimatedAmount, tierKey }) {
  const availabilityRows = await query(
    `SELECT da.*
     FROM driver_availability da
     LEFT JOIN ride_requests active_ride
       ON active_ride.driver_user_id = da.driver_user_id
      AND active_ride.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
     WHERE da.is_online = 1
       AND da.current_lat IS NOT NULL
       AND da.current_lng IS NOT NULL
       AND da.last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
       AND active_ride.id IS NULL
     ORDER BY da.updated_at DESC`
  );

  const eligibleDrivers = availabilityRows
    .map((row) => mapDriverAvailability({ ...row, estimated_amount: estimatedAmount }, pickupPoint))
    .filter((item) => item.driverDistanceKm <= DRIVER_REQUEST_RADIUS_KM)
    .sort((a, b) => a.driverDistanceKm - b.driverDistanceKm)
    .slice(0, MAX_DRIVER_OFFERS);

  console.log('[rides.findDriver] eligible drivers', {
    requestedTierKey: String(tierKey || '').trim().toLowerCase(),
    pickupPoint,
    totalAvailabilityRows: availabilityRows.length,
    eligibleCount: eligibleDrivers.length,
    eligibleDrivers: eligibleDrivers.map((driver) => ({
      id: driver.id,
      tierKey: driver.tier?.tierKey || null,
      tierName: driver.tier?.tierName || null,
      driverDistanceKm: Number(driver.driverDistanceKm.toFixed(2)),
      etaMinutes: driver.etaMinutes,
      coordinate: driver.coordinate,
    })),
  });

  return eligibleDrivers;
}

async function createPendingDriverOffers(rideRequestId, drivers) {
  if (!rideRequestId || !Array.isArray(drivers) || !drivers.length) return;

  const placeholders = drivers.map(() => '(?, ?, \'pending\', CURRENT_TIMESTAMP)').join(', ');
  const params = drivers.flatMap((driver) => [rideRequestId, driver.id]);
  await query(
    `INSERT INTO ride_request_driver_responses (
       ride_request_id,
       driver_user_id,
       status,
       responded_at
     ) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       responded_at = VALUES(responded_at)`,
    params
  );
}

function buildDriverRideRequestNotificationBody({ pickupLabel, dropoffLabel, intermediateStops = [] }) {
  const stopCount = Array.isArray(intermediateStops) ? intermediateStops.length : 0;
  if (stopCount > 0) {
    return `${pickupLabel} via ${stopCount} stop${stopCount === 1 ? '' : 's'} to ${dropoffLabel}`;
  }
  return `${pickupLabel} to ${dropoffLabel}`;
}

async function notifyDriversAboutRideRequest({ drivers, passengerName, pickupLabel, dropoffLabel, intermediateStops = [], rideRequestId, publicId, tierName }) {
  if (!Array.isArray(drivers) || !drivers.length) return;
  const stopCount = Array.isArray(intermediateStops) ? intermediateStops.length : 0;
  const notificationBody = buildDriverRideRequestNotificationBody({ pickupLabel, dropoffLabel, intermediateStops });

  const destinations = (
    await Promise.all(
      drivers.map(async (driver) => {
        try {
          const driverUser = await getClerkUserById(driver.id);
          return {
            expoToken: String(driverUser?.privateMetadata?.pushToken || '').trim() || null,
            fcmToken: String(driverUser?.privateMetadata?.fcmToken || '').trim() || null,
          };
        } catch {
          return { expoToken: null, fcmToken: null };
        }
      })
    )
  ).filter((item) => item.expoToken || item.fcmToken);

  const expoTokens = destinations.map((item) => item.expoToken).filter(Boolean);
  const fcmTokens = destinations.map((item) => item.fcmToken).filter(Boolean);

  console.log('[rides.findDriver] push notification targets', {
    rideRequestId,
    driverCount: drivers.length,
    expoTokenCount: expoTokens.length,
    fcmTokenCount: fcmTokens.length,
    driverIds: drivers.map((driver) => driver.id),
  });

  if (expoTokens.length) {
    await sendExpoPushNotifications(
      expoTokens.map((token) => ({
        to: token,
        title: 'New ride request',
        body: notificationBody,
        data: {
          type: 'driver_new_ride_request',
          rideRequestId,
          publicId,
          passengerName,
          pickupLabel,
          dropoffLabel,
          tierName,
        },
      }))
    );
  }

  if (fcmTokens.length) {
    await sendFcmNotifications(
      fcmTokens.map((token) => ({
        to: token,
        title: 'New ride request',
        body: notificationBody,
        android: {
          channelId: 'ride-requests',
          notification: {
            sound: 'default',
            clickAction: 'TRUST_EXPRESS_FULL_SCREEN_RIDE_REQUEST',
          },
        },
        data: {
          type: 'driver_new_ride_request',
          rideRequestId: String(rideRequestId),
          publicId: String(publicId || ''),
          passengerName: String(passengerName || ''),
          pickupLabel: String(pickupLabel || ''),
          dropoffLabel: String(dropoffLabel || ''),
          intermediateStopCount: String(stopCount || 0),
          tierName: String(tierName || ''),
        },
      }))
    );
  }
}

router.get('/passenger/history', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const requestedPage = Number.parseInt(String(req.query?.page || '1'), 10);
    const requestedLimit = Number.parseInt(String(req.query?.limit || '10'), 10);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 10;
    const offset = (page - 1) * limit;

    const [countRow] = await query(
      `SELECT COUNT(*) AS total
       FROM ride_requests
       WHERE passenger_user_id = ?`,
      [req.userId]
    );
    const total = Number(countRow?.total || 0);

    const rows = await query(
      `SELECT
         id,
         public_id,
         pickup_label,
        pickup_lat,
         pickup_lng,
         dropoff_label,
         dropoff_lat,
         dropoff_lng,
         intermediate_stops_json,
         current_stop_index,
         estimated_amount,
         original_estimated_amount,
         discount_amount,
         final_estimated_amount,
         driver_reimbursement_amount,
         discount_code,
         discount_type,
         discount_value,
         tip_amount,
         requested_tier_name,
         driver_user_id,
         driver_name,
         status,
         passenger_driver_rating,
         passenger_driver_review,
         passenger_driver_feedback_tags,
         passenger_driver_rated_at,
         driver_passenger_rating,
         driver_passenger_review,
         driver_passenger_feedback_tags,
         driver_passenger_rated_at,
         requested_at,
        completed_at,
        cancelled_at
       FROM ride_requests
       WHERE passenger_user_id = ?
       ORDER BY requested_at DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [req.userId]
    );

    return res.json({
      rides: rows.map((row) => ({
        ...buildRideDiscountPayload(row),
        ...buildRideStopsPayload(row),
        id: row.id,
        publicId: row.public_id,
        pickupLabel: row.pickup_label,
        pickupCoordinate: {
          latitude: Number(row.pickup_lat),
          longitude: Number(row.pickup_lng),
        },
        dropoffLabel: row.dropoff_label,
        dropoffCoordinate: {
          latitude: Number(row.dropoff_lat),
          longitude: Number(row.dropoff_lng),
        },
        estimatedAmount: Number(row.final_estimated_amount || row.estimated_amount || 0),
        tipAmount: Number(row.tip_amount || 0),
        totalAmount: Number(row.final_estimated_amount || row.estimated_amount || 0) + Number(row.tip_amount || 0),
        tierName: row.requested_tier_name,
        driverName: row.driver_name || null,
        status: mapPassengerRideStatus(row.status),
        rawStatus: row.status,
        passengerDriverRating: row.passenger_driver_rating === null ? null : Number(row.passenger_driver_rating),
        passengerDriverReview: row.passenger_driver_review || '',
        passengerDriverFeedbackTags: parseJsonArray(row.passenger_driver_feedback_tags),
        passengerDriverRatedAt: row.passenger_driver_rated_at || null,
        driverPassengerRating: row.driver_passenger_rating === null ? null : Number(row.driver_passenger_rating),
        driverPassengerReview: row.driver_passenger_review || '',
        driverPassengerFeedbackTags: parseJsonArray(row.driver_passenger_feedback_tags),
        driverPassengerRatedAt: row.driver_passenger_rated_at || null,
        canRateDriver: row.status === 'completed' && !!row.driver_user_id && row.passenger_driver_rating === null,
        canTipDriver: row.status === 'completed' && !!row.driver_user_id && Number(row.tip_amount || 0) <= 0,
        requestedAt: row.requested_at,
        completedAt: row.completed_at,
        cancelledAt: row.cancelled_at,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNextPage: offset + rows.length < total,
        hasPreviousPage: page > 1,
      },
    });
  } catch (err) {
    console.error('GET /api/rides/passenger/history', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/passenger/validate-discount', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const discountCode = String(req.body?.discountCode || '').trim();
    const autoApply = req.body?.autoApply === true;
    const selectedTier = req.body?.selectedTier || {};
    const originalFareAmount = Number(req.body?.originalFareAmount || 0);
    if (!discountCode && !autoApply) {
      return res.status(400).json({ error: 'Discount code is required' });
    }
    if (!Number.isFinite(originalFareAmount) || originalFareAmount <= 0) {
      return res.status(400).json({ error: 'Original fare amount must be greater than zero' });
    }

    const validatedDiscount = discountCode
      ? await validateDiscountForRide({
          passengerUserId: req.userId,
          discountCode,
          originalFareAmount,
          selectedTierKey: selectedTier?.tierKey || null,
        })
      : await findBestAutoDiscountForRide({
          passengerUserId: req.userId,
          originalFareAmount,
          selectedTierKey: selectedTier?.tierKey || null,
        });

    return res.json({
      discount: validatedDiscount,
    });
  } catch (err) {
    if (Number(err?.status || 0) >= 400 && Number(err?.status || 0) < 500) {
      return res.status(err.status).json({ error: err.message || 'Discount code is invalid' });
    }
    console.error('POST /api/rides/passenger/validate-discount', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/passenger/find-driver', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const [existingOpenRide] = await query(
      `SELECT id, public_id, status
       FROM ride_requests
       WHERE passenger_user_id = ?
         AND status IN ('requested', 'driver_found', 'driver_assigned', 'driver_arrived', 'in_progress')
       ORDER BY COALESCE(started_at, arrived_at, assigned_at, requested_at) DESC, id DESC
       LIMIT 1`,
      [req.userId]
    );
    if (existingOpenRide) {
      return res.status(409).json({
        error: 'You already have an active ride request. Complete or cancel it before requesting another ride.',
        activeRideRequest: {
          id: existingOpenRide.id,
          publicId: existingOpenRide.public_id,
          status: existingOpenRide.status,
        },
      });
    }

    const {
      pickupCoordinate,
      dropoffCoordinate,
      intermediateStops = [],
      pickupLabel,
      dropoffLabel,
      routePolyline,
      selectedTier,
      discountCode = '',
    } = req.body || {};

    const pickupLat = Number(pickupCoordinate?.latitude);
    const pickupLng = Number(pickupCoordinate?.longitude);
    const dropoffLat = Number(dropoffCoordinate?.latitude);
    const dropoffLng = Number(dropoffCoordinate?.longitude);
    const normalizedIntermediateStops = sanitizeIntermediateStops(intermediateStops);
    const tier = await loadPassengerTier(selectedTier?.tierKey);

    if (!pickupLabel || !dropoffLabel || !tier) {
      return res.status(400).json({ error: 'pickup, drop-off, and pricing configuration are required' });
    }
    if (![pickupLat, pickupLng, dropoffLat, dropoffLng].every(Number.isFinite)) {
      return res.status(400).json({ error: 'Valid pickup and drop-off coordinates are required' });
    }

    const pickupPoint = { latitude: pickupLat, longitude: pickupLng };
    const dropoffPoint = { latitude: dropoffLat, longitude: dropoffLng };
    if (!isCoordinateInBulawayoServiceArea(pickupPoint) || !isCoordinateInBulawayoServiceArea(dropoffPoint)) {
      return res.status(422).json({
        error: 'Trust Express currently supports rides within Bulawayo only. Please choose pickup and drop-off points in Bulawayo.',
      });
    }
    if (normalizedIntermediateStops.some((stop) => !isCoordinateInBulawayoServiceArea(stop.coordinate))) {
      return res.status(422).json({
        error: 'All stops must be inside Bulawayo.',
      });
    }

    let authoritativeRoute = null;
    try {
      authoritativeRoute = await fetchCachedDirections({
        origin: pickupPoint,
        destination: dropoffPoint,
        waypoints: normalizedIntermediateStops.map((stop) => stop.coordinate),
        cacheTtlSeconds: 1800,
      });
    } catch (routeError) {
      console.error('[rides.findDriver] road distance calculation failed', {
        status: routeError?.status,
        message: routeError?.message,
      });
      return res.status(422).json({
        error: 'Could not calculate the road distance for this trip. Please try again.',
      });
    }

    const authoritativeDistanceKm = Number(authoritativeRoute?.distanceKm || 0);
    const authoritativeMinutes = Number(authoritativeRoute?.durationMinutes || 0);
    if (authoritativeDistanceKm <= 0 || !Number.isFinite(authoritativeDistanceKm)) {
      return res.status(422).json({
        error: 'Could not calculate the road distance for this trip. Please try again.',
      });
    }
    const authoritativeAmount = calculateTierFare(tier, authoritativeDistanceKm);
    const validatedDiscount = discountCode
      ? await validateDiscountForRide({
          passengerUserId: req.userId,
          discountCode,
          originalFareAmount: authoritativeAmount,
          selectedTierKey: tier.tier_key,
        })
      : await findBestAutoDiscountForRide({
          passengerUserId: req.userId,
          originalFareAmount: authoritativeAmount,
          selectedTierKey: tier.tier_key,
        });
    const discountAmount = Number(validatedDiscount?.discountAmount || 0);
    const finalEstimatedAmount = Number(validatedDiscount?.finalFareAmount || authoritativeAmount);
    const driverReimbursementAmount = Number(validatedDiscount?.driverReimbursementAmount || 0);
    const passenger = toAppUser(user);
    const passengerFullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const passengerName = passengerFullName || 'Passenger';
    const passengerPhoneForDrivers = user?.privateMetadata?.phoneVisibleToDrivers === true
      && !!user?.privateMetadata?.phoneVerifiedAt
      ? passenger.phone_number
      : null;
    const publicId = createPublicRideId();

    const result = await query(
      `INSERT INTO ride_requests (
        public_id,
        passenger_user_id,
        passenger_name,
        passenger_phone,
        requested_tier_key,
        requested_tier_name,
        pickup_label,
        pickup_lat,
        pickup_lng,
        dropoff_label,
        dropoff_lat,
        dropoff_lng,
        intermediate_stops_json,
        current_stop_index,
        route_polyline,
        route_distance_km,
        route_duration_minutes,
        estimated_distance_km,
        estimated_minutes,
        estimated_amount,
        original_estimated_amount,
        discount_amount,
        final_estimated_amount,
        driver_reimbursement_amount,
        discount_code_id,
        discount_code,
        discount_type,
        discount_value,
        discount_applied_at,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
      [
        publicId,
        req.userId,
        passengerName,
        passengerPhoneForDrivers,
        tier.tier_key,
        tier.tier_name,
        String(pickupLabel).trim(),
        pickupLat,
        pickupLng,
        String(dropoffLabel).trim(),
        dropoffLat,
        dropoffLng,
        stringifyIntermediateStops(normalizedIntermediateStops),
        0,
        String(authoritativeRoute?.polyline || routePolyline || '').trim() || null,
        authoritativeDistanceKm,
        authoritativeMinutes,
        authoritativeDistanceKm,
        authoritativeMinutes,
        finalEstimatedAmount,
        authoritativeAmount,
        discountAmount,
        finalEstimatedAmount,
        driverReimbursementAmount,
        validatedDiscount?.id || null,
        validatedDiscount?.code || null,
        validatedDiscount?.discountType || null,
        validatedDiscount?.discountValue ?? null,
        validatedDiscount ? new Date() : null,
      ]
    );

    const rideRequestId = result.insertId;

    if (validatedDiscount) {
      await syncDiscountRedemptionForRide({
        rideRequestId,
        discount: validatedDiscount,
        passengerUserId: req.userId,
      });
    }

    const nearbyDriversBase = await loadEligibleDriversForRide({
      pickupPoint,
      estimatedAmount: authoritativeAmount,
      tierKey: tier.tier_key,
    });
    const nearbyDrivers = await Promise.all(
      nearbyDriversBase.map(async (driver) => ({
        ...driver,
        amount: finalEstimatedAmount,
        profileImageUrl: await getUserProfileImageUrl(driver.id),
      }))
    );

    console.log('[rides.findDriver] request created', {
      rideRequestId,
      publicId,
      passengerUserId: req.userId,
      requestedTierKey: tier.tier_key,
      requestedTierName: tier.tier_name,
      pickupPoint,
      dropoffPoint,
      intermediateStops: normalizedIntermediateStops,
      routeDistanceKm: authoritativeDistanceKm,
      routeDurationMinutes: authoritativeMinutes,
      originalEstimatedAmount: authoritativeAmount,
      discountAmount,
      finalEstimatedAmount,
      routeCacheHit: authoritativeRoute?.cacheHit === true,
      nearbyDriverIds: nearbyDrivers.map((driver) => driver.id),
    });

    await createPendingDriverOffers(rideRequestId, nearbyDrivers);
    await notifyDriversAboutRideRequest({
      drivers: nearbyDrivers,
      passengerName,
      pickupLabel: String(pickupLabel).trim(),
      dropoffLabel: String(dropoffLabel).trim(),
      intermediateStops: normalizedIntermediateStops,
      rideRequestId,
      publicId,
      tierName: tier.tier_name,
    });

    nearbyDrivers.forEach((driver) => {
      emitRideRequestToDriver(driver.id, {
        rideRequestId,
        publicId,
        passengerUserId: req.userId,
        passengerName,
        pickupLabel: String(pickupLabel).trim(),
        dropoffLabel: String(dropoffLabel).trim(),
        requestedTierKey: tier.tier_key,
        requestedTierName: tier.tier_name,
      });
    });

    console.log('[rides.findDriver] pending offers created', {
      rideRequestId,
      offeredDriverIds: nearbyDrivers.map((driver) => driver.id),
      offeredCount: nearbyDrivers.length,
    });

    const requestedAt = new Date().toISOString();

    return res.status(201).json({
      rideRequest: {
        id: rideRequestId,
        publicId,
        status: 'requested',
        requestedAt,
        expiresAt: computeExpiresAt(requestedAt),
        remainingSeconds: OPEN_REQUEST_TTL_MINUTES * 60,
        pickupLabel: String(pickupLabel).trim(),
        pickupCoordinate: pickupPoint,
        dropoffLabel: String(dropoffLabel).trim(),
        dropoffCoordinate: dropoffPoint,
        ...buildRideStopsPayload({
          intermediate_stops_json: stringifyIntermediateStops(normalizedIntermediateStops),
          current_stop_index: 0,
          dropoff_label: String(dropoffLabel).trim(),
          dropoff_lat: dropoffLat,
          dropoff_lng: dropoffLng,
        }),
        estimatedDistanceKm: authoritativeDistanceKm,
        estimatedMinutes: authoritativeMinutes,
        estimatedAmount: finalEstimatedAmount,
        ...buildRideDiscountPayload({
          original_estimated_amount: authoritativeAmount,
          discount_amount: discountAmount,
          final_estimated_amount: finalEstimatedAmount,
          driver_reimbursement_amount: driverReimbursementAmount,
          discount_code: validatedDiscount?.code || null,
          discount_type: validatedDiscount?.discountType || null,
          discount_value: validatedDiscount?.discountValue ?? null,
          discount_applied_at: validatedDiscount ? new Date() : null,
        }),
        requestedTierKey: tier.tier_key,
        requestedTierName: tier.tier_name,
        visibleDriversPreview: nearbyDrivers.slice(0, 4).map((driver) => ({
          id: driver.id,
          driverName: driver.driverName,
          profileImageUrl: driver.profileImageUrl || null,
          carImage: driver.carImage || null,
        })),
        driversViewingCount: 0,
      },
      nearbyDrivers,
    });
  } catch (err) {
    console.error('POST /api/rides/passenger/find-driver', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/passenger/current-ride', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const [ride] = await query(
      `SELECT *,
              GREATEST(
                0,
                CASE
                  WHEN status = 'driver_found'
                    THEN ${DRIVER_FOUND_SELECTION_TTL_SECONDS} - TIMESTAMPDIFF(SECOND, COALESCE(driver_found_at, requested_at), CURRENT_TIMESTAMP)
                  ELSE ${(OPEN_REQUEST_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, requested_at, CURRENT_TIMESTAMP)
                END
              ) AS remaining_seconds
       FROM ride_requests
       WHERE passenger_user_id = ?
         AND (
           status IN ('requested', 'driver_found', 'driver_assigned', 'driver_arrived', 'in_progress')
         )
       ORDER BY
         COALESCE(completed_at, started_at, arrived_at, assigned_at, requested_at) DESC,
         id DESC
       LIMIT 1`,
      [req.userId]
    );

    if (!ride) {
      return res.json({ rideRequest: null, assignedDriver: null });
    }

    const pickupCoordinate = {
      latitude: Number(ride.pickup_lat),
      longitude: Number(ride.pickup_lng),
    };

    const respondingDrivers = await query(
      `SELECT
         rr.driver_user_id,
         rr.status AS response_status,
         da.driver_name,
         da.phone_number,
         da.vehicle_tier_key,
         da.vehicle_tier_name,
         da.vehicle_make,
         da.vehicle_model,
         da.number_plate,
         da.car_photo_url,
         da.current_lat,
         da.current_lng,
         da.is_online,
         rr.driver_user_id AS profile_image_user_id
       FROM ride_request_driver_responses rr
       LEFT JOIN driver_availability da ON da.driver_user_id = rr.driver_user_id
       WHERE rr.ride_request_id = ?
         AND rr.status IN ('accepted', 'selected')
       ORDER BY rr.responded_at ASC`,
      [ride.id]
    );
    const driverStatsMap = await loadDriverRideStats([
      ...respondingDrivers.map((row) => row.driver_user_id),
      ride.driver_user_id,
    ]);

    const acceptedDrivers = await Promise.all(
      respondingDrivers.map(async (row) => ({
        ...mapAcceptedDriverOffer(
          attachDriverRideStats(row, driverStatsMap),
          pickupCoordinate,
          ride.final_estimated_amount || ride.estimated_amount
        ),
        profileImageUrl: await getUserProfileImageUrl(row.profile_image_user_id || row.driver_user_id),
      }))
    );

    const [driverAvailability] = await query(
      `SELECT
         driver_user_id,
         driver_name,
         phone_number,
         vehicle_tier_key,
         vehicle_tier_name,
         vehicle_make,
         vehicle_model,
         number_plate,
         car_photo_url,
         current_lat,
         current_lng
       FROM driver_availability
       WHERE driver_user_id = ?
       LIMIT 1`,
      [ride.driver_user_id]
    );

    const assignedDriver = driverAvailability
      ? mapDriverAvailability(
          attachDriverRideStats({
            ...driverAvailability,
            estimated_amount: ride.estimated_amount,
            driver_user_id: driverAvailability.driver_user_id || ride.driver_user_id,
          }, driverStatsMap),
          pickupCoordinate
        )
      : (
          ride.driver_user_id
            ? acceptedDrivers.find((item) => item.id === ride.driver_user_id) || null
            : null
        );

    const driverCoordinate = assignedDriver?.coordinate || null;

    const viewingSnapshot = (ride.status === 'requested' || ride.status === 'driver_found')
      ? await loadDriversViewingSnapshot(ride.id)
      : { driversViewingCount: 0, visibleDriversPreview: [] };

    return res.json({
      rideRequest: {
        ...buildRideDiscountPayload(ride),
        ...buildRideStopsPayload(ride),
        id: ride.id,
        publicId: ride.public_id,
        status: ride.status,
        stage: mapPassengerTripStage(ride.status),
        pickupLabel: ride.pickup_label,
        pickupCoordinate,
        dropoffLabel: ride.dropoff_label,
        dropoffCoordinate: {
          latitude: Number(ride.dropoff_lat),
          longitude: Number(ride.dropoff_lng),
        },
        estimatedDistanceKm: Number(ride.estimated_distance_km || 0),
        estimatedMinutes: Number(ride.estimated_minutes || 0),
        estimatedAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0),
        tipAmount: Number(ride.tip_amount || 0),
        totalAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0) + Number(ride.tip_amount || 0),
        requestedTierKey: ride.requested_tier_key,
        requestedTierName: ride.requested_tier_name,
        requestedAt: toIsoOrNull(ride.requested_at),
        arrivedAt: toIsoOrNull(ride.arrived_at),
        passengerConfirmedAt: toIsoOrNull(ride.passenger_confirmed_at),
        expiresAt: computeRideExpiresAt(ride.status, ride.requested_at, ride.driver_found_at),
        remainingSeconds: Number(ride.remaining_seconds || 0),
        driverDistanceKm: ride.driver_distance_km === null ? null : Number(ride.driver_distance_km),
        driverEtaMinutes: ride.driver_eta_minutes === null ? null : Number(ride.driver_eta_minutes),
        driverCoordinate,
        passengerDriverRating: ride.passenger_driver_rating === null ? null : Number(ride.passenger_driver_rating),
        passengerDriverReview: ride.passenger_driver_review || '',
        passengerDriverFeedbackTags: parseJsonArray(ride.passenger_driver_feedback_tags),
        passengerDriverRatedAt: ride.passenger_driver_rated_at || null,
        driversViewingCount: viewingSnapshot.driversViewingCount,
        visibleDriversPreview: viewingSnapshot.visibleDriversPreview,
      },
      acceptedDrivers,
      assignedDriver,
    });
  } catch (err) {
    console.error('GET /api/rides/passenger/current-ride', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/passenger/:rideRequestId/status', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const [ride] = await query(
      `SELECT *,
              GREATEST(
                0,
                CASE
                  WHEN status = 'driver_found'
                    THEN ${DRIVER_FOUND_SELECTION_TTL_SECONDS} - TIMESTAMPDIFF(SECOND, COALESCE(driver_found_at, requested_at), CURRENT_TIMESTAMP)
                  ELSE ${(OPEN_REQUEST_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, requested_at, CURRENT_TIMESTAMP)
                END
              ) AS remaining_seconds
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (isOpenRideRequest(ride.status)) {
      const expired = await expireRideRequestIfTimedOut(ride.id, req.userId);
      if (expired) {
        const [nextRide] = await query(
          `SELECT *
           FROM ride_requests
           WHERE id = ? AND passenger_user_id = ?
           LIMIT 1`,
          [rideRequestId, req.userId]
        );
        if (nextRide) Object.assign(ride, nextRide);
      }
    }

    const pickupCoordinate = {
      latitude: Number(ride.pickup_lat),
      longitude: Number(ride.pickup_lng),
    };

    const respondingDrivers = await query(
      `SELECT
         rr.driver_user_id,
         rr.status AS response_status,
         da.driver_name,
         da.phone_number,
         da.vehicle_tier_key,
         da.vehicle_tier_name,
         da.vehicle_make,
         da.vehicle_model,
         da.number_plate,
         da.car_photo_url,
         da.current_lat,
         da.current_lng,
         da.is_online,
         rr.driver_user_id AS profile_image_user_id
       FROM ride_request_driver_responses rr
       LEFT JOIN driver_availability da ON da.driver_user_id = rr.driver_user_id
       WHERE rr.ride_request_id = ?
         AND rr.status IN ('accepted', 'selected')
       ORDER BY rr.responded_at ASC`,
      [rideRequestId]
    );
    const driverStatsMap = await loadDriverRideStats([
      ...respondingDrivers.map((row) => row.driver_user_id),
      ride.driver_user_id,
    ]);
    const acceptedDrivers = await Promise.all(
      respondingDrivers.map(async (row) => ({
        ...mapAcceptedDriverOffer(
          attachDriverRideStats(row, driverStatsMap),
          pickupCoordinate,
          ride.final_estimated_amount || ride.estimated_amount
        ),
        profileImageUrl: await getUserProfileImageUrl(row.profile_image_user_id || row.driver_user_id),
      }))
    );

    const assignedDriver = ride.driver_user_id
      ? acceptedDrivers.find((item) => item.id === ride.driver_user_id) || (() => {
          const selectedRow = respondingDrivers.find((item) => item.driver_user_id === ride.driver_user_id);
          if (!selectedRow) return null;
          return mapDriverAvailability(attachDriverRideStats({
            ...selectedRow,
            estimated_amount: ride.estimated_amount,
          }, driverStatsMap), pickupCoordinate);
        })()
      : null;
    const assignedDriverProfileImageUrl = ride.driver_user_id
      ? await getUserProfileImageUrl(ride.driver_user_id)
      : null;

    const driverCoordinate = assignedDriver?.coordinate || null;

    const viewingSnapshot = (ride.status === 'requested' || ride.status === 'driver_found')
      ? await loadDriversViewingSnapshot(rideRequestId)
      : { driversViewingCount: 0, visibleDriversPreview: [] };

    return res.json({
      rideRequest: {
        ...buildRideStopsPayload(ride),
        id: ride.id,
        publicId: ride.public_id,
        status: ride.status,
        stage: mapPassengerTripStage(ride.status),
        pickupLabel: ride.pickup_label,
        pickupCoordinate,
        dropoffLabel: ride.dropoff_label,
        dropoffCoordinate: {
          latitude: Number(ride.dropoff_lat),
          longitude: Number(ride.dropoff_lng),
        },
        estimatedDistanceKm: Number(ride.estimated_distance_km || 0),
        estimatedMinutes: Number(ride.estimated_minutes || 0),
        estimatedAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0),
        tipAmount: Number(ride.tip_amount || 0),
        totalAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0) + Number(ride.tip_amount || 0),
        requestedTierKey: ride.requested_tier_key,
        requestedTierName: ride.requested_tier_name,
        requestedAt: toIsoOrNull(ride.requested_at),
        arrivedAt: toIsoOrNull(ride.arrived_at),
        passengerConfirmedAt: toIsoOrNull(ride.passenger_confirmed_at),
        expiresAt: computeRideExpiresAt(ride.status, ride.requested_at, ride.driver_found_at),
        remainingSeconds: Number(ride.remaining_seconds || 0),
        driverDistanceKm: ride.driver_distance_km === null ? null : Number(ride.driver_distance_km),
        driverEtaMinutes: ride.driver_eta_minutes === null ? null : Number(ride.driver_eta_minutes),
        driverCoordinate,
        passengerDriverRating: ride.passenger_driver_rating === null ? null : Number(ride.passenger_driver_rating),
        passengerDriverReview: ride.passenger_driver_review || '',
        passengerDriverFeedbackTags: parseJsonArray(ride.passenger_driver_feedback_tags),
        passengerDriverRatedAt: ride.passenger_driver_rated_at || null,
        driversViewingCount: viewingSnapshot.driversViewingCount,
        visibleDriversPreview: viewingSnapshot.visibleDriversPreview,
      },
      acceptedDrivers,
      assignedDriver: assignedDriver ? {
        ...assignedDriver,
        profileImageUrl: assignedDriverProfileImageUrl,
      } : null,
    });
  } catch (err) {
    console.error('GET /api/rides/passenger/:rideRequestId/status', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/passenger/:rideRequestId/details', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const [ride] = await query(
      `SELECT *
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    return res.json({
      ride: {
        ...buildRideDiscountPayload(ride),
        ...buildRideStopsPayload(ride),
        id: ride.id,
        publicId: ride.public_id,
        pickupLabel: ride.pickup_label,
        dropoffLabel: ride.dropoff_label,
        estimatedAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0),
        tipAmount: Number(ride.tip_amount || 0),
        totalAmount: Number(ride.final_estimated_amount || ride.estimated_amount || 0) + Number(ride.tip_amount || 0),
        tierName: ride.requested_tier_name,
        driverName: ride.driver_name || null,
        driverPhone: ride.driver_phone || null,
        rawStatus: ride.status,
        status: mapPassengerRideStatus(ride.status),
        requestedAt: ride.requested_at,
        completedAt: ride.completed_at,
        cancelledAt: ride.cancelled_at,
        passengerDriverRating: ride.passenger_driver_rating === null ? null : Number(ride.passenger_driver_rating),
        passengerDriverReview: ride.passenger_driver_review || '',
        passengerDriverFeedbackTags: parseJsonArray(ride.passenger_driver_feedback_tags),
        passengerDriverRatedAt: ride.passenger_driver_rated_at || null,
        driverPassengerRating: ride.driver_passenger_rating === null ? null : Number(ride.driver_passenger_rating),
        driverPassengerReview: ride.driver_passenger_review || '',
        driverPassengerFeedbackTags: parseJsonArray(ride.driver_passenger_feedback_tags),
        driverPassengerRatedAt: ride.driver_passenger_rated_at || null,
        canRateDriver: ride.status === 'completed' && !!ride.driver_user_id && ride.passenger_driver_rating === null,
        canTipDriver: ride.status === 'completed' && !!ride.driver_user_id && Number(ride.tip_amount || 0) <= 0,
      },
    });
  } catch (err) {
    console.error('GET /api/rides/passenger/:rideRequestId/details', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/passenger/:rideRequestId/receipt', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const [ride] = await query(
      `SELECT
         id,
         public_id,
         passenger_name,
         driver_name,
         requested_tier_name,
         pickup_label,
         dropoff_label,
         intermediate_stops_json,
         estimated_amount,
         original_estimated_amount,
         discount_amount,
         final_estimated_amount,
         tip_amount,
         status,
         requested_at,
         completed_at
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const fileName = `trustcars-receipt-${ride.public_id || ride.id}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(200).send(formatRideReceiptText(ride));
  } catch (err) {
    console.error('GET /api/rides/passenger/:rideRequestId/receipt', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/passenger/:rideRequestId/receipt-pdf', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const [ride] = await query(
      `SELECT
         id,
         public_id,
         passenger_name,
         driver_name,
         requested_tier_name,
         pickup_label,
         dropoff_label,
         intermediate_stops_json,
         estimated_amount,
         original_estimated_amount,
         discount_amount,
         final_estimated_amount,
         tip_amount,
         status,
         requested_at,
         completed_at
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const fileName = `trustcars-receipt-${ride.public_id || ride.id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    writeRideReceiptPdf(res, ride, {
      statusLabel: mapPassengerRideStatus(ride.status),
      footerText: 'Thank you for riding with Trust Express!',
    });
  } catch (err) {
    console.error('GET /api/rides/passenger/:rideRequestId/receipt-pdf', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/passenger/:rideRequestId/lost-items', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    const itemDescription = String(req.body?.itemDescription || '').trim();
    const contactPhone = String(req.body?.contactPhone || '').trim();

    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }
    if (!itemDescription) {
      return res.status(400).json({ error: 'itemDescription is required' });
    }
    if (itemDescription.length > LOST_ITEM_MAX_LENGTH) {
      return res.status(400).json({ error: `itemDescription must be ${LOST_ITEM_MAX_LENGTH} characters or less` });
    }

    const [ride] = await query(
      `SELECT id, public_id, driver_user_id, status
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const insertResult = await query(
      `INSERT INTO ride_lost_items (
         ride_request_id,
         ride_public_id,
         passenger_user_id,
         driver_user_id,
         item_description,
         contact_phone,
         case_reference,
         case_priority,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        rideRequestId,
        ride.public_id || null,
        req.userId,
        ride.driver_user_id || null,
        itemDescription,
        contactPhone || null,
        createCaseReference('LI', rideRequestId),
        'high',
      ]
    );

    return res.status(201).json({
      lostItemReport: {
        id: Number(insertResult?.insertId || 0),
        rideRequestId,
        status: 'open',
        itemDescription,
        contactPhone: contactPhone || null,
        followUpStatus: 'pending',
      },
    });
  } catch (err) {
    console.error('POST /api/rides/passenger/:rideRequestId/lost-items', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:rideRequestId/panic-alert', requireAuth, async (req, res) => {
  try {
    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const message = String(req.body?.message || '').trim();
    const alertStage = String(req.body?.alertStage || '').trim().toLowerCase();
    const latitude = req.body?.latitude === null || req.body?.latitude === undefined || req.body?.latitude === ''
      ? null
      : Number(req.body.latitude);
    const longitude = req.body?.longitude === null || req.body?.longitude === undefined || req.body?.longitude === ''
      ? null
      : Number(req.body.longitude);

    if (message.length > PANIC_ALERT_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({ error: `message must be ${PANIC_ALERT_MESSAGE_MAX_LENGTH} characters or less` });
    }
    if (latitude !== null && !Number.isFinite(latitude)) {
      return res.status(400).json({ error: 'latitude must be a valid number' });
    }
    if (longitude !== null && !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'longitude must be a valid number' });
    }

    const [ride] = await query(
      `SELECT
         id,
         public_id,
         passenger_user_id,
         passenger_name,
         driver_user_id,
         driver_name,
         status
       FROM ride_requests
       WHERE id = ?
         AND status IN ('driver_assigned', 'driver_arrived', 'in_progress')
         AND (passenger_user_id = ? OR driver_user_id = ?)
       LIMIT 1`,
      [rideRequestId, req.userId, req.userId]
    );

    if (!ride) {
      return res.status(404).json({ error: 'Active ride not found for this user' });
    }

    const actorRole = ride.driver_user_id && ride.driver_user_id === req.userId ? 'driver' : 'passenger';
    const actorName = actorRole === 'driver' ? (ride.driver_name || 'Driver') : (ride.passenger_name || 'Passenger');
    const defaultMessage = actorRole === 'driver'
      ? 'Driver requested urgent admin assistance during an active ride.'
      : 'Passenger requested urgent admin assistance during an active ride.';
    const casePriority = actorRole === 'driver' ? 'critical' : 'high';

    const insertResult = await query(
      `INSERT INTO ride_panic_alerts (
         ride_request_id,
         ride_public_id,
         actor_role,
         actor_user_id,
         actor_name,
         passenger_user_id,
         passenger_name,
         driver_user_id,
         driver_name,
         ride_status,
         alert_stage,
         message,
         case_reference,
         case_priority,
         latitude,
         longitude,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        rideRequestId,
        ride.public_id || null,
        actorRole,
        req.userId,
        actorName,
        ride.passenger_user_id,
        ride.passenger_name || null,
        ride.driver_user_id || null,
        ride.driver_name || null,
        ride.status,
        alertStage || null,
        message || defaultMessage,
        createCaseReference('PA', rideRequestId),
        casePriority,
        latitude,
        longitude,
      ]
    );

    return res.status(201).json({
      panicAlert: {
        id: Number(insertResult?.insertId || 0),
        rideRequestId,
        actorRole,
        actorName,
        rideStatus: ride.status,
        alertStage: alertStage || null,
        message: message || defaultMessage,
        casePriority,
        latitude,
        longitude,
        status: 'open',
        followUpStatus: 'pending',
      },
    });
  } catch (err) {
    console.error('POST /api/rides/:rideRequestId/panic-alert', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/passenger/:rideRequestId/rate-driver', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    const rating = Number(req.body?.rating);
    const review = String(req.body?.review || '').trim();
    const feedbackTags = normalizeRatingTags(req.body?.feedbackTags);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
    }

    const [ride] = await query(
      `SELECT id, driver_user_id, status
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }
    if (ride.status !== 'completed' || !ride.driver_user_id) {
      return res.status(409).json({ error: 'Driver can only be rated after a completed ride' });
    }

    await query(
      `UPDATE ride_requests
       SET passenger_driver_rating = ?,
           passenger_driver_review = ?,
           passenger_driver_feedback_tags = ?,
           passenger_driver_rated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND passenger_user_id = ?`,
      [rating, review || null, JSON.stringify(feedbackTags), rideRequestId, req.userId]
    );

    try {
      const driverUser = await getClerkUserById(ride.driver_user_id);
      const pushToken = driverUser?.privateMetadata?.pushToken;
      if (pushToken) {
        await sendExpoPushNotifications({
          to: pushToken,
          title: 'New passenger rating',
          body: `You were rated ${rating} star${rating === 1 ? '' : 's'}.`,
          data: {
            type: 'driver_rating',
            rating,
            review,
            feedbackTags,
            rideRequestId,
          },
        });
      }
    } catch (pushError) {
      console.error('Failed to send driver rating push', pushError);
    }

    emitTripRatingToDriver(ride.driver_user_id, {
      rideRequestId,
      rating,
      review,
      feedbackTags,
      from: 'passenger',
    });

    return res.json({
      ok: true,
      rating,
      review,
      feedbackTags,
    });
  } catch (err) {
    console.error('POST /api/rides/passenger/:rideRequestId/rate-driver', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/passenger/:rideRequestId/tip-driver', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Tip amount must be greater than zero' });
    }
    if (amount > MAX_RIDE_TIP_AMOUNT) {
      return res.status(400).json({ error: `Tip amount must be $${MAX_RIDE_TIP_AMOUNT.toFixed(2)} or less` });
    }

    const normalizedAmount = Number(amount.toFixed(2));
    const [ride] = await query(
      `SELECT id, public_id, driver_user_id, status, tip_amount
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }
    if (ride.status !== 'completed' || !ride.driver_user_id) {
      return res.status(409).json({ error: 'Drivers can only be tipped after a completed ride' });
    }
    if (Number(ride.tip_amount || 0) > 0) {
      return res.status(409).json({ error: 'A tip has already been added to this ride' });
    }

    await query(
      `UPDATE ride_requests
       SET tip_amount = ?,
           tipped_at = CURRENT_TIMESTAMP
       WHERE id = ? AND passenger_user_id = ?`,
      [normalizedAmount, rideRequestId, req.userId]
    );

    try {
      const driverUser = await getClerkUserById(ride.driver_user_id);
      const pushToken = String(driverUser?.privateMetadata?.pushToken || '').trim();
      if (pushToken) {
        await sendExpoPushNotifications({
          to: pushToken,
          title: 'New passenger tip',
          body: `You received a $${normalizedAmount.toFixed(2)} tip.`,
          data: {
            type: 'driver_tip_received',
            rideRequestId,
            tipAmount: normalizedAmount,
          },
        });
      }
    } catch (pushError) {
      console.error('Failed to send driver tip push', pushError);
    }

    emitTripRatingToDriver(ride.driver_user_id, {
      rideRequestId,
      tipAmount: normalizedAmount,
      from: 'passenger',
      type: 'tip',
    });

    return res.status(201).json({
      ok: true,
      tipAmount: normalizedAmount,
    });
  } catch (err) {
    console.error('POST /api/rides/passenger/:rideRequestId/tip-driver', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/passenger/:rideRequestId/select-driver', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    const driverUserId = String(req.body?.driverUserId || '').trim();
    if (!Number.isInteger(rideRequestId) || !driverUserId) {
      return res.status(400).json({ error: 'rideRequestId and driverUserId are required' });
    }

    const [ride] = await query(
      'SELECT * FROM ride_requests WHERE id = ? AND passenger_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const [driverResponse] = await query(
      `SELECT status
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?
         AND driver_user_id = ?
       LIMIT 1`,
      [rideRequestId, driverUserId]
    );
    if (!driverResponse || driverResponse.status !== 'accepted') {
      return res.status(409).json({ error: 'Selected driver has not accepted this request' });
    }

    const [driverAvailability] = await query(
      `SELECT *
       FROM driver_availability
       WHERE driver_user_id = ?
         AND is_online = 1
         AND last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
       LIMIT 1`,
      [driverUserId]
    );
    if (!driverAvailability) {
      return res.status(404).json({ error: 'Selected driver is no longer online' });
    }

    const pickupPoint = { latitude: Number(ride.pickup_lat), longitude: Number(ride.pickup_lng) };
    const driverPoint = { latitude: Number(driverAvailability.current_lat), longitude: Number(driverAvailability.current_lng) };
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
       WHERE id = ? AND passenger_user_id = ? AND status IN ('requested', 'driver_found')`,
      [
        driverUserId,
        driverAvailability.driver_name,
        driverAvailability.phone_number,
        Number(driverDistanceKm.toFixed(2)),
        driverEtaMinutes,
        rideRequestId,
        req.userId,
      ]
    );

    if (Number(updateResult?.affectedRows || 0) < 1) {
      return res.status(409).json({ error: 'This ride could not be assigned to the selected driver anymore. Please refresh and choose again.' });
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
        passengerUserId: req.userId,
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

    emitRideStatusToPassenger(req.userId, {
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
      passengerUserId: req.userId,
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

    const assignedDriver = mapDriverAvailability(
      {
        ...driverAvailability,
        estimated_amount: ride.final_estimated_amount || ride.estimated_amount,
      },
      pickupPoint
    );

    return res.json({
      rideRequest: {
        id: rideRequestId,
        status: 'driver_assigned',
        driverDistanceKm: Number(driverDistanceKm.toFixed(2)),
        driverEtaMinutes,
      },
      assignedDriver,
    });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/select-driver', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/passenger/:rideRequestId/decline-driver', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    const driverUserId = String(req.body?.driverUserId || '').trim();
    if (!Number.isInteger(rideRequestId) || !driverUserId) {
      return res.status(400).json({ error: 'rideRequestId and driverUserId are required' });
    }

    const [ride] = await query(
      `SELECT *
       FROM ride_requests
       WHERE id = ? AND passenger_user_id = ? AND status IN ('requested', 'driver_found')
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const [driverResponse] = await query(
      `SELECT status
       FROM ride_request_driver_responses
       WHERE ride_request_id = ? AND driver_user_id = ?
       LIMIT 1`,
      [rideRequestId, driverUserId]
    );
    if (!driverResponse || String(driverResponse.status || '') !== 'accepted') {
      return res.status(409).json({ error: 'This driver is no longer awaiting your selection' });
    }

    await query(
      `UPDATE ride_request_driver_responses
       SET status = 'declined',
           responded_at = CURRENT_TIMESTAMP
       WHERE ride_request_id = ?
         AND driver_user_id = ?
         AND status = 'accepted'`,
      [rideRequestId, driverUserId]
    );

    const [acceptedCountRow] = await query(
      `SELECT COUNT(*) AS total
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?
         AND status IN ('accepted', 'selected')`,
      [rideRequestId]
    );
    const acceptedCount = Number(acceptedCountRow?.total || 0);
    const [pendingCountRow] = await query(
      `SELECT COUNT(*) AS total
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?
         AND status = 'pending'`,
      [rideRequestId]
    );
    const pendingCount = Number(pendingCountRow?.total || 0);
    const nextRideStatus = acceptedCount > 0
      ? 'driver_found'
      : pendingCount > 0
        ? 'requested'
        : 'expired';

    if (acceptedCount === 0) {
      await query(
        `UPDATE ride_requests
         SET status = ?,
             driver_found_at = CASE WHEN ? = 'requested' THEN NULL ELSE driver_found_at END
         WHERE id = ?
           AND passenger_user_id = ?
           AND status = 'driver_found'
           AND driver_user_id IS NULL`,
        [nextRideStatus, nextRideStatus, rideRequestId, req.userId]
      );
    }

    emitRideRequestRemovedFromDriver(driverUserId, {
      rideRequestId,
      reason: 'declined_by_passenger',
    });
    emitRideStatusToDriver(driverUserId, {
      rideRequestId,
      status: nextRideStatus,
      passengerUserId: req.userId,
      reason: 'declined_by_passenger',
    });

    return res.json({
      ok: true,
      rideRequest: {
        id: rideRequestId,
        status: nextRideStatus,
      },
    });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/decline-driver', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/passenger/:rideRequestId/cancel', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await query(
      `UPDATE ride_requests
       SET status = 'cancelled',
           cancellation_reason = ?,
           cancelled_at = CURRENT_TIMESTAMP
       WHERE id = ? AND passenger_user_id = ?`,
      [String(req.body?.reason || 'Passenger cancelled').trim(), rideRequestId, req.userId]
    );

    const affectedDrivers = await query(
      `SELECT driver_user_id
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?`,
      [rideRequestId]
    );

    affectedDrivers.forEach((row) => {
      emitRideRequestRemovedFromDriver(row.driver_user_id, {
        rideRequestId,
        reason: 'passenger_cancelled',
      });
      emitRideStatusToDriver(row.driver_user_id, {
        rideRequestId,
        status: 'cancelled',
        passengerUserId: req.userId,
      });
    });

    emitRideStatusToPassenger(req.userId, {
      rideRequestId,
      status: 'cancelled',
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/cancel', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/passenger/:rideRequestId/arrived', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await query(
      `UPDATE ride_requests
       SET status = 'driver_arrived', arrived_at = CURRENT_TIMESTAMP
       WHERE id = ? AND passenger_user_id = ? AND status IN ('driver_assigned', 'driver_found')`,
      [rideRequestId, req.userId]
    );
    const arrivedAt = new Date().toISOString();

    const [ride] = await query(
      'SELECT driver_user_id FROM ride_requests WHERE id = ? AND passenger_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.driver_user_id) {
      emitRideStatusToDriver(ride.driver_user_id, {
        rideRequestId,
        status: 'driver_arrived',
        arrivedAt,
        passengerUserId: req.userId,
      });
    }
    emitRideStatusToPassenger(req.userId, {
      rideRequestId,
      status: 'driver_arrived',
      arrivedAt,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/arrived', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/passenger/:rideRequestId/confirm-pickup', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await query(
      `UPDATE ride_requests
       SET passenger_confirmed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND passenger_user_id = ? AND status = 'driver_arrived'`,
      [rideRequestId, req.userId]
    );

    const confirmedAt = new Date().toISOString();

    const [ride] = await query(
      'SELECT driver_user_id FROM ride_requests WHERE id = ? AND passenger_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.driver_user_id) {
      try {
        const driverUser = await getClerkUserById(ride.driver_user_id);
        const pushToken = String(driverUser?.privateMetadata?.pushToken || '').trim();
        if (pushToken) {
          await sendExpoPushNotifications({
            to: pushToken,
            title: 'Passenger is coming',
            body: 'Your passenger confirmed they are on their way to the pickup point.',
            data: {
              type: 'passenger_confirmed',
              rideRequestId,
              confirmedAt,
            },
          });
        }
      } catch (pushError) {
        console.error('PATCH /api/rides/passenger/:rideRequestId/confirm-pickup push', pushError);
      }
      emitRideStatusToDriver(ride.driver_user_id, {
        rideRequestId,
        status: 'passenger_confirmed',
        confirmedAt,
        passengerUserId: req.userId,
      });
    }
    emitRideStatusToPassenger(req.userId, {
      rideRequestId,
      status: 'passenger_confirmed',
      confirmedAt,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/confirm-pickup', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/passenger/:rideRequestId/complete', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await query(
      `UPDATE ride_requests
       SET status = 'completed',
           completed_at = CURRENT_TIMESTAMP,
           actual_distance_km = COALESCE(actual_distance_km, route_distance_km, estimated_distance_km),
           actual_minutes = GREATEST(
             1,
             TIMESTAMPDIFF(
               MINUTE,
               COALESCE(started_at, assigned_at, requested_at),
               CURRENT_TIMESTAMP
             )
           )
       WHERE id = ? AND passenger_user_id = ? AND status IN ('driver_arrived', 'in_progress', 'driver_assigned')`,
      [rideRequestId, req.userId]
    );

    const [ride] = await query(
      'SELECT driver_user_id FROM ride_requests WHERE id = ? AND passenger_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.driver_user_id) {
      emitRideStatusToDriver(ride.driver_user_id, {
        rideRequestId,
        status: 'completed',
        passengerUserId: req.userId,
      });
    }
    emitRideStatusToPassenger(req.userId, {
      rideRequestId,
      status: 'completed',
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/complete', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:rideRequestId/messages', requireAuth, async (req, res) => {
  try {
    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const chat = await loadAuthorizedRideChat(rideRequestId, req.userId);
    if (!chat) {
      return res.status(404).json({ error: 'Ride chat not found' });
    }

    const rows = await query(
      `SELECT
         id,
         ride_request_id,
         sender_user_id,
         recipient_user_id,
         sender_role,
         message,
         created_at,
         read_at
       FROM ride_messages
       WHERE ride_request_id = ?
       ORDER BY created_at ASC, id ASC`,
      [rideRequestId]
    );

    await query(
      `UPDATE ride_messages
       SET read_at = CURRENT_TIMESTAMP
       WHERE ride_request_id = ?
         AND recipient_user_id = ?
         AND read_at IS NULL`,
      [rideRequestId, req.userId]
    );

    return res.json({
      rideRequestId,
      chatTitle: chat.chatTitle,
      messages: rows.map(mapRideMessage),
    });
  } catch (err) {
    console.error('GET /api/rides/:rideRequestId/messages', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:rideRequestId/messages', requireAuth, async (req, res) => {
  try {
    const rideRequestId = Number(req.params.rideRequestId);
    const message = String(req.body?.message || '').trim();

    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Message is too long' });
    }

    const chat = await loadAuthorizedRideChat(rideRequestId, req.userId);
    if (!chat) {
      return res.status(404).json({ error: 'Ride chat not found' });
    }
    if (!chat.recipientUserId) {
      return res.status(409).json({ error: 'Chat is not available until a driver has been assigned' });
    }
    if (['cancelled', 'expired'].includes(String(chat.ride?.status || ''))) {
      return res.status(409).json({ error: 'Chat is not available for this ride anymore' });
    }

    const insertResult = await query(
      `INSERT INTO ride_messages (
         ride_request_id,
         sender_user_id,
         recipient_user_id,
         sender_role,
         message
       ) VALUES (?, ?, ?, ?, ?)`,
      [rideRequestId, req.userId, chat.recipientUserId, chat.senderRole, message]
    );

    const messageId = Number(insertResult?.insertId || 0);
    const [row] = await query(
      `SELECT
         id,
         ride_request_id,
         sender_user_id,
         recipient_user_id,
         sender_role,
         message,
         created_at,
         read_at
       FROM ride_messages
       WHERE id = ?
       LIMIT 1`,
      [messageId]
    );

    const messageRecord = row ? mapRideMessage(row) : null;
    const senderUser = await getClerkUserById(req.userId).catch(() => null);
    const senderName = [senderUser?.firstName, senderUser?.lastName].filter(Boolean).join(' ').trim() || (chat.senderRole === 'driver' ? 'Driver' : 'Passenger');
    const recipientUser = await getClerkUserById(chat.recipientUserId).catch(() => null);
    const recipientPushToken = String(recipientUser?.privateMetadata?.pushToken || '').trim();

    emitRideChatMessageToUser(chat.recipientUserId, {
      rideRequestId,
      messageId,
      senderUserId: req.userId,
      senderRole: chat.senderRole,
    });
    emitRideChatMessageToUser(req.userId, {
      rideRequestId,
      messageId,
      senderUserId: req.userId,
      senderRole: chat.senderRole,
    });

    if (recipientPushToken) {
      sendExpoPushNotifications({
        to: recipientPushToken,
        title: senderName,
        body: message,
        data: {
          type: 'ride_chat_message',
          rideRequestId,
        },
      }).catch((pushError) => {
        console.error('POST /api/rides/:rideRequestId/messages push', pushError);
      });
    }

    return res.status(201).json({
      messageRecord,
    });
  } catch (err) {
    console.error('POST /api/rides/:rideRequestId/messages', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
