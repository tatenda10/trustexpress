import crypto from 'crypto';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { query } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import { fetchCachedGoogleDirections } from '../lib/google-directions.js';
import { sendExpoPushNotifications, sendFcmNotifications } from '../lib/push.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideChatMessageToUser,
  emitRideRequestToDriver,
  emitRideStatusToDriver,
  emitRideStatusToPassenger,
  emitTripRatingToDriver,
} from '../lib/realtime.js';

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
const DRIVER_FOUND_SELECTION_TTL_MINUTES = 2;
const ACTIVE_RIDE_STATUSES = ['driver_assigned', 'driver_arrived', 'in_progress'];
const STALE_ACTIVE_RIDE_TTL_MINUTES = 20;
const DRIVER_REQUEST_RADIUS_KM = 20;
const MAX_DRIVER_OFFERS = 8;
const DRIVER_ONLINE_STALE_DAYS = 1;
const LOST_ITEM_MAX_LENGTH = 2000;
const MAX_RIDE_TIP_AMOUNT = 200;

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
  const coordinate = {
    latitude: Number(row.current_lat),
    longitude: Number(row.current_lng),
  };
  const driverDistanceKm = calculateDistanceKm(pickupCoordinate, coordinate);
  return {
    id: row.driver_user_id,
    tierName: row.vehicle_tier_name,
    carName: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle',
    plate: row.number_plate || 'Unknown plate',
    driverName: row.driver_name || 'Driver',
    etaMinutes: Math.max(1, Math.round(driverDistanceKm * 4)),
    driverDistanceKm,
    amount: Number(row.estimated_amount || 0),
    rating: 4.9,
    trips: 0,
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
    : pickupCoordinate;
  const driverDistanceKm = calculateDistanceKm(pickupCoordinate, coordinate);
  return {
    id: row.driver_user_id,
    tierName: row.vehicle_tier_name || 'Ride',
    carName: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle',
    plate: row.number_plate || 'Unknown plate',
    driverName: row.driver_name || 'Driver',
    etaMinutes: Math.max(1, Math.round(driverDistanceKm * 4)),
    driverDistanceKm,
    amount: Number(estimatedAmount || 0),
    rating: 4.9,
    trips: 0,
    phoneNumber: row.phone_number || null,
    coordinate,
    tier: {
      tierKey: row.vehicle_tier_key || null,
      tierName: row.vehicle_tier_name || 'Ride',
    },
    carImage: row.car_photo_url || null,
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

function computeRideExpiresAt(status, requestedAt, driverFoundAt = null) {
  if (String(status || '') === 'driver_found') {
    return computeExpiresAt(driverFoundAt || requestedAt, DRIVER_FOUND_SELECTION_TTL_MINUTES);
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
  const fareAmount = Number(ride.estimated_amount || 0);
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
    `Drop-off: ${ride.dropoff_label || '-'}`,
    '',
    `Tier: ${ride.requested_tier_name || 'Ride'}`,
    `Fare: $${fareAmount.toFixed(2)}`,
    `Tip: $${tipAmount.toFixed(2)}`,
    `Total: $${totalAmount.toFixed(2)}`,
  ];
  return `${lines.join('\n')}\n`;
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
           AND COALESCE(driver_found_at, requested_at) < (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_FOUND_SELECTION_TTL_MINUTES} MINUTE)
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

async function notifyDriversAboutRideRequest({ drivers, passengerName, pickupLabel, dropoffLabel, rideRequestId, publicId, tierName }) {
  if (!Array.isArray(drivers) || !drivers.length) return;

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
        body: `${pickupLabel} to ${dropoffLabel}`,
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
        body: `${pickupLabel} to ${dropoffLabel}`,
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
         estimated_amount,
         tip_amount,
         requested_tier_name,
         driver_user_id,
         driver_name,
         status,
         passenger_driver_rating,
         passenger_driver_review,
         passenger_driver_rated_at,
         driver_passenger_rating,
         driver_passenger_review,
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
        estimatedAmount: Number(row.estimated_amount || 0),
        tipAmount: Number(row.tip_amount || 0),
        totalAmount: Number(row.estimated_amount || 0) + Number(row.tip_amount || 0),
        tierName: row.requested_tier_name,
        driverName: row.driver_name || null,
        status: mapPassengerRideStatus(row.status),
        rawStatus: row.status,
        passengerDriverRating: row.passenger_driver_rating === null ? null : Number(row.passenger_driver_rating),
        passengerDriverReview: row.passenger_driver_review || '',
        passengerDriverRatedAt: row.passenger_driver_rated_at || null,
        driverPassengerRating: row.driver_passenger_rating === null ? null : Number(row.driver_passenger_rating),
        driverPassengerReview: row.driver_passenger_review || '',
        driverPassengerRatedAt: row.driver_passenger_rated_at || null,
        canRateDriver: row.status === 'completed' && !!row.driver_name,
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
      pickupLabel,
      dropoffLabel,
      routePolyline,
      selectedTier,
    } = req.body || {};

    const pickupLat = Number(pickupCoordinate?.latitude);
    const pickupLng = Number(pickupCoordinate?.longitude);
    const dropoffLat = Number(dropoffCoordinate?.latitude);
    const dropoffLng = Number(dropoffCoordinate?.longitude);
    const tier = await loadPassengerTier(selectedTier?.tierKey);

    if (!pickupLabel || !dropoffLabel || !tier) {
      return res.status(400).json({ error: 'pickup, drop-off, and pricing configuration are required' });
    }
    if (![pickupLat, pickupLng, dropoffLat, dropoffLng].every(Number.isFinite)) {
      return res.status(400).json({ error: 'Valid pickup and drop-off coordinates are required' });
    }

    const pickupPoint = { latitude: pickupLat, longitude: pickupLng };
    const dropoffPoint = { latitude: dropoffLat, longitude: dropoffLng };
    let authoritativeRoute = null;
    try {
      authoritativeRoute = await fetchCachedGoogleDirections({
        origin: pickupPoint,
        destination: dropoffPoint,
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
        route_polyline,
        route_distance_km,
        route_duration_minutes,
        estimated_distance_km,
        estimated_minutes,
        estimated_amount,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
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
        String(authoritativeRoute?.polyline || routePolyline || '').trim() || null,
        authoritativeDistanceKm,
        authoritativeMinutes,
        authoritativeDistanceKm,
        authoritativeMinutes,
        authoritativeAmount,
      ]
    );

    const rideRequestId = result.insertId;

    const nearbyDrivers = await loadEligibleDriversForRide({
      pickupPoint,
      estimatedAmount: authoritativeAmount,
      tierKey: tier.tier_key,
    });

    console.log('[rides.findDriver] request created', {
      rideRequestId,
      publicId,
      passengerUserId: req.userId,
      requestedTierKey: tier.tier_key,
      requestedTierName: tier.tier_name,
      pickupPoint,
      dropoffPoint,
      routeDistanceKm: authoritativeDistanceKm,
      routeDurationMinutes: authoritativeMinutes,
      routeCacheHit: authoritativeRoute?.cacheHit === true,
      nearbyDriverIds: nearbyDrivers.map((driver) => driver.id),
    });

    await createPendingDriverOffers(rideRequestId, nearbyDrivers);
    await notifyDriversAboutRideRequest({
      drivers: nearbyDrivers,
      passengerName,
      pickupLabel: String(pickupLabel).trim(),
      dropoffLabel: String(dropoffLabel).trim(),
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
        estimatedDistanceKm: authoritativeDistanceKm,
        estimatedMinutes: authoritativeMinutes,
        estimatedAmount: authoritativeAmount,
        requestedTierKey: tier.tier_key,
        requestedTierName: tier.tier_name,
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
                    THEN ${(DRIVER_FOUND_SELECTION_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, COALESCE(driver_found_at, requested_at), CURRENT_TIMESTAMP)
                  ELSE ${(OPEN_REQUEST_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, requested_at, CURRENT_TIMESTAMP)
                END
              ) AS remaining_seconds
       FROM ride_requests
       WHERE passenger_user_id = ?
         AND status IN ('requested', 'driver_found', 'driver_assigned', 'driver_arrived', 'in_progress')
       ORDER BY
         COALESCE(started_at, arrived_at, assigned_at, requested_at) DESC,
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
         da.is_online
       FROM ride_request_driver_responses rr
       LEFT JOIN driver_availability da ON da.driver_user_id = rr.driver_user_id
       WHERE rr.ride_request_id = ?
         AND rr.status IN ('accepted', 'selected')
       ORDER BY rr.responded_at ASC`,
      [ride.id]
    );

    const acceptedDrivers = respondingDrivers.map((row) =>
      mapAcceptedDriverOffer(row, pickupCoordinate, ride.estimated_amount)
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
          {
            ...driverAvailability,
            estimated_amount: ride.estimated_amount,
          },
          pickupCoordinate
        )
      : (
          ride.driver_user_id
            ? acceptedDrivers.find((item) => item.id === ride.driver_user_id) || null
            : null
        );

    const driverCoordinate = assignedDriver?.coordinate || null;

    return res.json({
      rideRequest: {
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
        estimatedAmount: Number(ride.estimated_amount || 0),
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
        passengerDriverRatedAt: ride.passenger_driver_rated_at || null,
        driversViewingCount: 0,
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
                    THEN ${(DRIVER_FOUND_SELECTION_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, COALESCE(driver_found_at, requested_at), CURRENT_TIMESTAMP)
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
         da.is_online
       FROM ride_request_driver_responses rr
       LEFT JOIN driver_availability da ON da.driver_user_id = rr.driver_user_id
       WHERE rr.ride_request_id = ?
         AND rr.status IN ('accepted', 'selected')
       ORDER BY rr.responded_at ASC`,
      [rideRequestId]
    );
    console.log('[rides.passenger.status] accepted drivers snapshot', {
      passengerUserId: req.userId,
      rideRequestId,
      rideStatus: ride.status,
      respondingCount: respondingDrivers.length,
      respondingStatuses: respondingDrivers.map((row) => ({
        driverUserId: row.driver_user_id,
        status: row.response_status,
        hasAvailability: row.current_lat !== null && row.current_lng !== null,
      })),
      nowIso: new Date().toISOString(),
    });

    const acceptedDrivers = respondingDrivers.map((row) =>
      mapAcceptedDriverOffer(row, pickupCoordinate, ride.estimated_amount)
    );

    const assignedDriver = ride.driver_user_id
      ? acceptedDrivers.find((item) => item.id === ride.driver_user_id) || (() => {
          const selectedRow = respondingDrivers.find((item) => item.driver_user_id === ride.driver_user_id);
          if (!selectedRow) return null;
          return mapDriverAvailability({
            ...selectedRow,
            estimated_amount: ride.estimated_amount,
          }, pickupCoordinate);
        })()
      : null;
    const assignedDriverProfileImageUrl = ride.driver_user_id
      ? await getUserProfileImageUrl(ride.driver_user_id)
      : null;

    const driverCoordinate = assignedDriver?.coordinate || null;

    let driversViewingCount = 0;
    if (ride.status === 'requested' || ride.status === 'driver_found') {
      const [countRow] = await query(
        `SELECT COUNT(*) AS total
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
           AND active_ride.id IS NULL`,
        [rideRequestId]
      );
      driversViewingCount = Number(countRow?.total || 0);
    }

    return res.json({
      rideRequest: {
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
        estimatedAmount: Number(ride.estimated_amount || 0),
        tipAmount: Number(ride.tip_amount || 0),
        totalAmount: Number(ride.estimated_amount || 0) + Number(ride.tip_amount || 0),
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
        passengerDriverRatedAt: ride.passenger_driver_rated_at || null,
        driversViewingCount,
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
        id: ride.id,
        publicId: ride.public_id,
        pickupLabel: ride.pickup_label,
        dropoffLabel: ride.dropoff_label,
        estimatedAmount: Number(ride.estimated_amount || 0),
        tipAmount: Number(ride.tip_amount || 0),
        totalAmount: Number(ride.estimated_amount || 0) + Number(ride.tip_amount || 0),
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
        passengerDriverRatedAt: ride.passenger_driver_rated_at || null,
        driverPassengerRating: ride.driver_passenger_rating === null ? null : Number(ride.driver_passenger_rating),
        driverPassengerReview: ride.driver_passenger_review || '',
        driverPassengerRatedAt: ride.driver_passenger_rated_at || null,
        canRateDriver: ride.status === 'completed' && !!ride.driver_user_id,
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
         estimated_amount,
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
         estimated_amount,
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

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const fareAmount = Number(ride.estimated_amount || 0);
    const tipAmount = Number(ride.tip_amount || 0);
    const totalAmount = fareAmount + tipAmount;
    const requestedAt = ride.requested_at ? new Date(ride.requested_at).toISOString() : '-';
    const completedAt = ride.completed_at ? new Date(ride.completed_at).toISOString() : '-';
    const statusLabel = mapPassengerRideStatus(ride.status);

    doc.fillColor('#0C1F49').fontSize(22).font('Helvetica-Bold').text('TRUST EXPRESS APP', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#999').fontSize(12).font('Helvetica').text('Trust Express Ride Receipt', { align: 'center' });
    doc.moveDown(1);

    doc.fillColor('#206EFF').fontSize(10).font('Helvetica-Bold').text('Receipt #:', { continued: true }).fillColor('#000').text(` RCPT-${ride.id}`);
    doc.fillColor('#206EFF').text('Trip ID:', { continued: true }).fillColor('#000').text(` ${ride.public_id || ride.id}`);
    doc.fillColor('#206EFF').text('Status:', { continued: true }).fillColor('#000').text(` ${statusLabel}`);
    doc.fillColor('#206EFF').text('Requested:', { continued: true }).fillColor('#000').text(` ${requestedAt}`);
    doc.fillColor('#206EFF').text('Completed:', { continued: true }).fillColor('#000').text(` ${completedAt}`);

    doc.moveDown(0.5);
    doc.strokeColor('#D9D9D9').lineWidth(1).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor('#0C1F49').font('Helvetica-Bold').text('Passenger:', { continued: true }).fillColor('#000').text(` ${ride.passenger_name || 'Passenger'}`);
    doc.font('Helvetica-Bold').fillColor('#0C1F49').text('Driver:', { continued: true }).fillColor('#000').text(` ${ride.driver_name || 'N/A'}`);
    doc.font('Helvetica-Bold').fillColor('#0C1F49').text('Pickup:', { continued: true }).fillColor('#000').text(` ${ride.pickup_label || '-'}`);
    doc.font('Helvetica-Bold').fillColor('#0C1F49').text('Drop-off:', { continued: true }).fillColor('#000').text(` ${ride.dropoff_label || '-'}`);

    doc.moveDown(0.5);
    doc.strokeColor('#D9D9D9').lineWidth(1).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor('#0C1F49').font('Helvetica-Bold').text('Tier:', { continued: true }).fillColor('#000').text(` ${ride.requested_tier_name || 'Trust Express'}`);
    doc.font('Helvetica-Bold').fillColor('#0C1F49').text('Fare:', { continued: true }).fillColor('#000').text(` $${fareAmount.toFixed(2)}`);
    doc.font('Helvetica-Bold').fillColor('#0C1F49').text('Tip:', { continued: true }).fillColor('#000').text(` $${tipAmount.toFixed(2)}`);
    doc.font('Helvetica-Bold').fillColor('#206EFF').fontSize(14).text('Total:', { continued: true }).fillColor('#000').text(` $${totalAmount.toFixed(2)}`);

    doc.moveDown(1);
    doc.fontSize(10).fillColor('#666').font('Helvetica').text('Thank you for riding with Trust Express!', { align: 'center' });
    doc.moveDown(0.25);
    doc.fontSize(9).fillColor('#666').text('Safe rides. Trusted drivers. Always.', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#999').text('Support: support@trustexpress.co.zw | +263 713 834 565 | trustjavvehicles.co.zw', { align: 'center' });

    doc.end();
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
         status
       ) VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [
        rideRequestId,
        ride.public_id || null,
        req.userId,
        ride.driver_user_id || null,
        itemDescription,
        contactPhone || null,
      ]
    );

    return res.status(201).json({
      lostItemReport: {
        id: Number(insertResult?.insertId || 0),
        rideRequestId,
        status: 'open',
        itemDescription,
        contactPhone: contactPhone || null,
      },
    });
  } catch (err) {
    console.error('POST /api/rides/passenger/:rideRequestId/lost-items', err);
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
           passenger_driver_rated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND passenger_user_id = ?`,
      [rating, review || null, rideRequestId, req.userId]
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
      from: 'passenger',
    });

    return res.json({
      ok: true,
      rating,
      review,
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

    await query(
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

    emitRideStatusToPassenger(req.userId, {
      rideRequestId,
      status: 'driver_assigned',
      driverUserId,
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

    return res.json({
      rideRequest: {
        id: rideRequestId,
        status: 'driver_assigned',
        driverDistanceKm: Number(driverDistanceKm.toFixed(2)),
        driverEtaMinutes,
      },
    });
  } catch (err) {
    console.error('PATCH /api/rides/passenger/:rideRequestId/select-driver', err);
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
