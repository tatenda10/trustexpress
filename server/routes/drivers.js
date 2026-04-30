import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, mergePrivateMetadata, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import { loadVehicleTierRules } from '../lib/vehicle-tier-matching.js';
import { getDriverVerificationFromMysql } from '../lib/driver-verification-mysql.js';
import { sendExpoPushNotifications } from '../lib/push.js';
import {
  emitRideRequestRemovedFromDriver,
  emitRideStatusToDriver,
  emitRideStatusToPassenger,
  emitTripRatingToPassenger,
} from '../lib/realtime.js';

const router = Router();
const OPEN_REQUEST_TTL_MINUTES = 3;
const DRIVER_FOUND_SELECTION_TTL_MINUTES = 2;
const OPEN_REQUEST_MIN_REMAINING_SECONDS = 30;
const STALE_SIM_ACTIVE_RIDE_TTL_MINUTES = 20;
const DEADLOCK_RETRY_DELAY_MS = 120;
const DEADLOCK_RETRY_ATTEMPTS = 3;
const DRIVER_ONLINE_STALE_DAYS = 1;
const DRIVER_REVIEW_VISIBILITY_DELAY_MINUTES = 30;

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

function getDriverDisplayName(user) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (user.username) return user.username;
  const email = Array.isArray(user.emailAddresses) ? user.emailAddresses[0]?.emailAddress : '';
  if (email && String(email).includes('@')) return String(email).split('@')[0];
  return 'Driver';
}

function getPassengerDisplayName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Passenger';
  if (raw.includes('@')) return 'Passenger';
  if (raw.startsWith('user_')) return 'Passenger';
  return raw;
}

async function notifyPassengerRideStatus(passengerUserId, { title, body, data = {} } = {}) {
  if (!passengerUserId || !title || !body) return;
  try {
    const passengerUser = await getClerkUserById(passengerUserId);
    const pushToken = String(passengerUser?.privateMetadata?.pushToken || '').trim();
    if (!pushToken) return;

    await sendExpoPushNotifications({
      to: pushToken,
      title,
      body,
      data,
    });
  } catch (error) {
    console.error('Failed to send passenger ride notification', error);
  }
}

function mapDriverRideStatus(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled' || status === 'expired') return 'Cancelled';
  if (status === 'in_progress') return 'In Progress';
  if (status === 'driver_arrived') return 'Arrived';
  if (status === 'driver_assigned') return 'Assigned';
  if (status === 'driver_found') return 'Matched';
  return 'Requested';
}

function mapTripStage(status) {
  if (status === 'driver_arrived') return 'waiting_for_customer';
  if (status === 'in_progress') return 'on_trip';
  return 'to_pickup';
}

function toIsoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

function shouldHideFreshPassengerReview(passengerDriverRatedAt) {
  if (!passengerDriverRatedAt) return false;
  const ratedAtMs = new Date(passengerDriverRatedAt).getTime();
  if (!Number.isFinite(ratedAtMs)) return false;
  const revealAtMs = ratedAtMs + DRIVER_REVIEW_VISIBILITY_DELAY_MINUTES * 60 * 1000;
  return Date.now() < revealAtMs;
}

function isDriverAvailabilityFresh(lastSeenAt) {
  if (!lastSeenAt) return false;
  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) return false;
  return (Date.now() - lastSeenMs) <= DRIVER_ONLINE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

function computeExpiresAt(value) {
  if (!value) return null;
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + OPEN_REQUEST_TTL_MINUTES);
  return date.toISOString();
}

function computeRideExpiresAt(status, requestedAt, driverFoundAt = null) {
  const normalized = String(status || '');
  if (normalized === 'driver_found') {
    if (!requestedAt && !driverFoundAt) return null;
    const date = new Date(driverFoundAt || requestedAt);
    date.setMinutes(date.getMinutes() + DRIVER_FOUND_SELECTION_TTL_MINUTES);
    return date.toISOString();
  }
  return computeExpiresAt(requestedAt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryWithDeadlockRetry(sql, params = [], attempts = DEADLOCK_RETRY_ATTEMPTS) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await query(sql, params);
    } catch (error) {
      lastError = error;
      if (error?.code !== 'ER_LOCK_DEADLOCK' || attempt === attempts) {
        throw error;
      }
      await sleep(DEADLOCK_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

async function cleanupStaleActiveRides(driverUserId = null) {
  // Intentionally no-op: active rides must survive app/background/network disconnects.
  // Auto-cancelling stale active trips caused mid-trip cancellations while users were still driving.
  // We keep this hook for future non-destructive stale handling (alerts/recovery), not cancellation.
  return;
}

async function requireDriver(req, res) {
  const user = await getClerkUserById(req.userId);
  const appUser = toAppUser(user);
  if (normalizeRole(appUser.role) !== 'driver') {
    res.status(403).json({ error: 'Not a driver' });
    return null;
  }
  return user;
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

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const [verification, availability] = await Promise.all([
      getDriverVerificationFromMysql(req.userId, user),
      query(
        `SELECT is_online, current_lat, current_lng, last_seen_at
         FROM driver_availability
         WHERE driver_user_id = ?
         LIMIT 1`,
        [req.userId]
      ).then((rows) => rows[0] || null),
    ]);

    return res.json({
      ...verification,
      availability: availability ? {
        isOnline: !!availability.is_online && isDriverAvailabilityFresh(availability.last_seen_at),
        latitude: availability.current_lat === null ? null : Number(availability.current_lat),
        longitude: availability.current_lng === null ? null : Number(availability.current_lng),
        lastSeenAt: availability.last_seen_at || null,
      } : {
        isOnline: false,
        latitude: null,
        longitude: null,
        lastSeenAt: null,
      },
    });
  } catch (err) {
    console.error('GET /api/drivers/me', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/vehicle-options', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const rules = await loadVehicleTierRules();
    if (rules.length > 0) {
      return res.json({
        tiers: rules.map((rule) => ({
          id: rule.id,
          tierKey: rule.tierKey,
          tierName: rule.tierName,
          sortOrder: rule.sortOrder,
          shortDescription: rule.shortDescription || null,
          regionName: null,
          city: null,
          countryCode: null,
        })),
      });
    }

    const rows = await query(
      `SELECT
        t.id,
        t.region_id,
        t.tier_key,
        t.tier_name,
        t.sort_order,
        r.region_name,
        r.city,
        r.country_code
      FROM operating_region_pricing_tiers t
      INNER JOIN operating_regions r ON r.id = t.region_id
      WHERE r.is_active = 1 AND t.is_active = 1
      ORDER BY t.sort_order ASC, t.id ASC`
    );

    const deduped = [];
    const seenKeys = new Set();
    for (const row of rows) {
      const tierKey = String(row.tier_key || '').trim().toLowerCase();
      if (!tierKey || seenKeys.has(tierKey)) continue;
      seenKeys.add(tierKey);
      deduped.push({
        id: row.id,
        regionId: row.region_id,
        tierKey,
        tierName: row.tier_name,
        sortOrder: Number(row.sort_order || 0),
        regionName: row.region_name,
        city: row.city || null,
        countryCode: row.country_code || null,
      });
    }

    return res.json({ tiers: deduped });
  } catch (err) {
    console.error('GET /api/drivers/vehicle-options', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/availability', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const verification = await getDriverVerificationFromMysql(req.userId, user);
    const profile = verification.driverProfile || null;
    const vehicle = verification.vehicle || null;
    const profileStatus = String(profile?.status || '').trim().toLowerCase();
    const vehicleStatus = String(vehicle?.status || '').trim().toLowerCase();
    const profileApproved = profileStatus === 'approved' || profileStatus === 'verified';
    const vehicleApproved = vehicleStatus === 'approved' || vehicleStatus === 'verified';
    const phoneVerified = verification?.phoneVerified === true;

    const isOnline = req.body?.isOnline === true;
    const latitude = req.body?.latitude === null || req.body?.latitude === undefined ? null : Number(req.body.latitude);
    const longitude = req.body?.longitude === null || req.body?.longitude === undefined ? null : Number(req.body.longitude);

    if (isOnline && (!profileApproved || !vehicleApproved || !phoneVerified)) {
      return res.status(403).json({
        error: 'Complete profile approval, vehicle approval, and phone verification before going online.',
      });
    }

    if (isOnline && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return res.status(400).json({ error: 'A valid driver location is required to go online.' });
    }

    await query(
      `INSERT INTO driver_availability (
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
        current_lng,
        is_online,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        driver_name = VALUES(driver_name),
        phone_number = VALUES(phone_number),
        vehicle_tier_key = VALUES(vehicle_tier_key),
        vehicle_tier_name = VALUES(vehicle_tier_name),
        vehicle_make = VALUES(vehicle_make),
        vehicle_model = VALUES(vehicle_model),
        number_plate = VALUES(number_plate),
        car_photo_url = VALUES(car_photo_url),
        current_lat = VALUES(current_lat),
        current_lng = VALUES(current_lng),
        is_online = VALUES(is_online),
        last_seen_at = CURRENT_TIMESTAMP`,
      [
        req.userId,
        getDriverDisplayName(user),
        user.privateMetadata?.phoneNumber || null,
        vehicle?.vehicleTierKey || null,
        vehicle?.vehicleTierName || null,
        vehicle?.make || null,
        vehicle?.model || null,
        vehicle?.numberPlate || null,
        vehicle?.carPhotoFrontUrl || vehicle?.carPhotoUrls?.[0] || null,
        Number.isFinite(latitude) ? latitude : null,
        Number.isFinite(longitude) ? longitude : null,
        isOnline ? 1 : 0,
      ]
    );

    return res.json({
      isOnline,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
    });
  } catch (err) {
    console.error('POST /api/drivers/availability', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/push-token', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const pushToken = String(req.body?.pushToken || '').trim();
    if (!pushToken) {
      return res.status(400).json({ error: 'pushToken is required' });
    }

    const nextMeta = await mergePrivateMetadata(req.userId, {
      pushToken,
    });

    console.log('[drivers.push-token] saved', {
      driverUserId: req.userId,
      hasToken: !!(nextMeta.pushToken || pushToken),
      tokenPreview: String(nextMeta.pushToken || pushToken).slice(0, 18),
    });

    return res.status(201).json({ pushToken: nextMeta.pushToken || pushToken });
  } catch (err) {
    console.error('POST /api/drivers/push-token', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/fcm-token', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const fcmToken = String(req.body?.fcmToken || '').trim();
    if (!fcmToken) {
      return res.status(400).json({ error: 'fcmToken is required' });
    }

    const nextMeta = await mergePrivateMetadata(req.userId, {
      fcmToken,
    });

    console.log('[drivers.fcm-token] saved', {
      driverUserId: req.userId,
      hasToken: !!(nextMeta.fcmToken || fcmToken),
      tokenPreview: String(nextMeta.fcmToken || fcmToken).slice(0, 18),
    });

    return res.status(201).json({ fcmToken: nextMeta.fcmToken || fcmToken });
  } catch (err) {
    console.error('POST /api/drivers/fcm-token', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/ride-requests', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    await cleanupStaleActiveRides(req.userId);

    const [availability] = await query(
      `SELECT driver_user_id, current_lat, current_lng, vehicle_tier_key, is_online
       FROM driver_availability
       WHERE driver_user_id = ?
         AND last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
       LIMIT 1`,
      [req.userId]
    );

    if (!availability || !availability.is_online || availability.current_lat === null || availability.current_lng === null) {
      console.log('[drivers.rideRequests] unavailable for requests', {
        driverUserId: req.userId,
        hasAvailability: !!availability,
        isOnline: !!availability?.is_online,
        currentLat: availability?.current_lat ?? null,
        currentLng: availability?.current_lng ?? null,
        vehicleTierKey: availability?.vehicle_tier_key ?? null,
      });
      return res.json({ requests: [] });
    }

    const [activeRide] = await query(
      `SELECT id
       FROM ride_requests
       WHERE driver_user_id = ?
         AND status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       LIMIT 1`,
      [req.userId]
    );
    if (activeRide) {
      console.log('[drivers.rideRequests] blocked by active ride', {
        driverUserId: req.userId,
        activeRideId: activeRide.id,
      });
      return res.json({ requests: [] });
    }

    await query(
      `UPDATE ride_requests
       SET status = 'expired'
       WHERE
         (status = 'requested' AND requested_at < (CURRENT_TIMESTAMP - INTERVAL ${OPEN_REQUEST_TTL_MINUTES} MINUTE))
         OR (
           status = 'driver_found'
           AND COALESCE(driver_found_at, requested_at) < (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_FOUND_SELECTION_TTL_MINUTES} MINUTE)
         )`
    );

    await query(
      `UPDATE ride_request_driver_responses rr
       INNER JOIN ride_requests r ON r.id = rr.ride_request_id
       SET rr.status = 'expired',
           rr.responded_at = CURRENT_TIMESTAMP
       WHERE rr.driver_user_id = ?
         AND rr.status = 'pending'
         AND (
           r.status NOT IN ('requested', 'driver_found')
           OR r.requested_at < (CURRENT_TIMESTAMP - INTERVAL ${OPEN_REQUEST_TTL_MINUTES} MINUTE)
         )`,
      [req.userId]
    );

    const driverPoint = {
      latitude: Number(availability.current_lat),
      longitude: Number(availability.current_lng),
    };

    const rows = await query(
      `SELECT
         r.id,
         r.public_id,
         r.passenger_user_id,
         r.passenger_name,
         r.passenger_phone,
         r.requested_tier_key,
         r.requested_tier_name,
         r.pickup_label,
         r.pickup_lat,
         r.pickup_lng,
         r.dropoff_label,
         r.dropoff_lat,
         r.dropoff_lng,
         r.estimated_distance_km,
         r.estimated_minutes,
         r.estimated_amount,
         r.status,
         r.requested_at,
         r.driver_found_at,
         GREATEST(
           0,
           CASE
             WHEN r.status = 'driver_found'
               THEN ${(DRIVER_FOUND_SELECTION_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, COALESCE(r.driver_found_at, r.requested_at), CURRENT_TIMESTAMP)
             ELSE ${(OPEN_REQUEST_TTL_MINUTES * 60)} - TIMESTAMPDIFF(SECOND, r.requested_at, CURRENT_TIMESTAMP)
           END
         ) AS remaining_seconds,
         r.driver_user_id
       FROM ride_request_driver_responses rr
       INNER JOIN ride_requests r ON r.id = rr.ride_request_id
       WHERE rr.driver_user_id = ?
         AND rr.status = 'pending'
         AND r.public_id NOT LIKE 'SIM-%'
         AND r.passenger_user_id IS NOT NULL
         AND r.status IN ('requested', 'driver_found')
         AND TIMESTAMPDIFF(SECOND, r.requested_at, CURRENT_TIMESTAMP) <= ${(OPEN_REQUEST_TTL_MINUTES * 60) - OPEN_REQUEST_MIN_REMAINING_SECONDS}
       ORDER BY requested_at DESC
       LIMIT 20`,
      [req.userId]
    );

    console.log('[drivers.rideRequests] fetched pending rows', {
      driverUserId: req.userId,
      vehicleTierKey: availability.vehicle_tier_key || null,
      coordinate: {
        latitude: Number(availability.current_lat),
        longitude: Number(availability.current_lng),
      },
      pendingRowCount: rows.length,
      pendingRows: rows.map((row) => ({
        rideRequestId: row.id,
        publicId: row.public_id,
        requestedTierKey: row.requested_tier_key,
        requestedTierName: row.requested_tier_name,
        rideStatus: row.status,
        requestedAt: row.requested_at,
        passengerUserId: row.passenger_user_id,
      })),
    });
    console.log('[drivers.rideRequests] ttl snapshot', {
      driverUserId: req.userId,
      openRequestTtlMinutes: OPEN_REQUEST_TTL_MINUTES,
      driverFoundSelectionTtlMinutes: DRIVER_FOUND_SELECTION_TTL_MINUTES,
      minRemainingSeconds: OPEN_REQUEST_MIN_REMAINING_SECONDS,
      nowIso: new Date().toISOString(),
      rows: rows.map((row) => ({
        rideRequestId: row.id,
        status: row.status,
        requestedAt: row.requested_at,
        driverFoundAt: row.driver_found_at || null,
        remainingSeconds: Number(row.remaining_seconds || 0),
      })),
    });

    const resolvedRequests = await Promise.all(rows.map(async (row) => {
      const passengerProfileImageUrl = await getUserProfileImageUrl(row.passenger_user_id);
      const pickupCoordinate = {
        latitude: Number(row.pickup_lat),
        longitude: Number(row.pickup_lng),
      };
      const dropoffCoordinate = {
        latitude: Number(row.dropoff_lat),
        longitude: Number(row.dropoff_lng),
      };
      const driverDistanceKm = calculateDistanceKm(driverPoint, pickupCoordinate);

      return {
        id: row.id,
        publicId: row.public_id,
        passengerName: getPassengerDisplayName(row.passenger_name),
        passengerPhone: row.passenger_phone || null,
        passengerProfile: {
          firstName: null,
          lastName: null,
          fullName: row.passenger_name || 'Passenger',
          email: null,
          imageUrl: passengerProfileImageUrl,
          phoneNumber: row.passenger_phone || null,
          phoneVisibleToDrivers: !!row.passenger_phone,
          phoneVerified: false,
        },
        tierKey: row.requested_tier_key,
        tierName: row.requested_tier_name,
        pickup: row.pickup_label,
        dropoff: row.dropoff_label,
        pickupCoordinate,
        dropoffCoordinate,
        estimatedDistanceKm: Number(row.estimated_distance_km || 0),
        estimatedMinutes: Number(row.estimated_minutes || 0),
        estimatedAmount: Number(row.estimated_amount || 0),
        status: row.status,
        requestedAt: toIsoOrNull(row.requested_at),
        expiresAt: computeRideExpiresAt(row.status, row.requested_at, row.driver_found_at),
        remainingSeconds: Number(row.remaining_seconds || 0),
        driverDistanceKm,
        etaMinutes: Math.max(1, Math.round(driverDistanceKm * 4)),
      };
    }));

    const requests = resolvedRequests
      .sort((a, b) => a.driverDistanceKm - b.driverDistanceKm)
      .slice(0, 8);

    console.log('[drivers.rideRequests] returning requests', {
      driverUserId: req.userId,
      requestCount: requests.length,
      requestIds: requests.map((request) => request.id),
    });

    return res.json({ requests });
  } catch (err) {
    console.error('GET /api/drivers/ride-requests', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/ride-requests/:rideRequestId/accept', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    await cleanupStaleActiveRides(req.userId);

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const [availability] = await query(
      `SELECT *
       FROM driver_availability
       WHERE driver_user_id = ?
         AND last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
       LIMIT 1`,
      [req.userId]
    );
    if (!availability || !availability.is_online) {
      return res.status(400).json({ error: 'Driver must be online before accepting rides' });
    }

    const [activeRide] = await query(
      `SELECT id
       FROM ride_requests
       WHERE driver_user_id = ?
         AND status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       LIMIT 1`,
      [req.userId]
    );
    if (activeRide) {
      return res.status(409).json({ error: 'Finish the current trip before accepting another ride' });
    }

    const [ride] = await query(
      `SELECT *,
              CASE
                WHEN status = 'driver_found'
                  THEN TIMESTAMPDIFF(SECOND, COALESCE(driver_found_at, requested_at), CURRENT_TIMESTAMP)
                ELSE TIMESTAMPDIFF(SECOND, requested_at, CURRENT_TIMESTAMP)
              END AS age_seconds
       FROM ride_requests
       WHERE id = ?
       LIMIT 1`,
      [rideRequestId]
    );
    if (!ride) {
      console.log('[drivers.accept] ride not found', {
        driverUserId: req.userId,
        rideRequestId,
      });
      return res.status(404).json({ error: 'Ride request not found' });
    }
    console.log('[drivers.accept] fetched ride snapshot', {
      driverUserId: req.userId,
      rideRequestId,
      rideStatus: ride.status,
      requestedAt: ride.requested_at,
      driverFoundAt: ride.driver_found_at || null,
      ageSeconds: Number(ride?.age_seconds || 0),
      nowIso: new Date().toISOString(),
      openRequestTtlMinutes: OPEN_REQUEST_TTL_MINUTES,
      driverFoundSelectionTtlMinutes: DRIVER_FOUND_SELECTION_TTL_MINUTES,
    });
    if (!['requested', 'driver_found'].includes(String(ride.status || ''))) {
      console.log('[drivers.accept] blocked by ride status', {
        driverUserId: req.userId,
        rideRequestId,
        rideStatus: ride.status,
      });
      return res.status(409).json({ error: 'Ride request is no longer available' });
    }
    const [offer] = await query(
      `SELECT status
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?
         AND driver_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!offer || !['pending', 'accepted'].includes(String(offer.status || ''))) {
      console.log('[drivers.accept] blocked by offer status', {
        driverUserId: req.userId,
        rideRequestId,
        offerStatus: offer?.status || null,
      });
      return res.status(409).json({ error: 'This ride offer is no longer available to you' });
    }
    const driverPoint = {
      latitude: Number(availability.current_lat),
      longitude: Number(availability.current_lng),
    };
    const pickupPoint = {
      latitude: Number(ride.pickup_lat),
      longitude: Number(ride.pickup_lng),
    };
    const driverDistanceKm = calculateDistanceKm(driverPoint, pickupPoint);
    const driverEtaMinutes = Math.max(1, Math.round(driverDistanceKm * 4));
    const acceptedDriverPayload = {
      id: req.userId,
      tierName: availability.vehicle_tier_name || 'Ride',
      carName: [availability.vehicle_make, availability.vehicle_model].filter(Boolean).join(' ') || 'Vehicle',
      plate: availability.number_plate || 'Unknown plate',
      driverName: availability.driver_name || getDriverDisplayName(user),
      etaMinutes: driverEtaMinutes,
      driverDistanceKm,
      amount: Number(ride.estimated_amount || 0),
      rating: 4.9,
      trips: 0,
      phoneNumber: availability.phone_number || null,
      coordinate: {
        latitude: Number.isFinite(Number(availability.current_lat)) ? Number(availability.current_lat) : pickupPoint.latitude,
        longitude: Number.isFinite(Number(availability.current_lng)) ? Number(availability.current_lng) : pickupPoint.longitude,
      },
      tier: {
        tierKey: availability.vehicle_tier_key || null,
        tierName: availability.vehicle_tier_name || 'Ride',
      },
      carImage: availability.car_photo_url || null,
    };

    await query(
      `INSERT INTO ride_request_driver_responses (
         ride_request_id,
         driver_user_id,
         status,
         responded_at
       ) VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         status = 'accepted',
         responded_at = CURRENT_TIMESTAMP`,
      [rideRequestId, req.userId]
    );
    const [acceptedSnapshot] = await query(
      `SELECT status, responded_at
       FROM ride_request_driver_responses
       WHERE ride_request_id = ?
         AND driver_user_id = ?
       LIMIT 1`,
      [rideRequestId, req.userId]
    );
    console.log('[drivers.accept] response row after accept upsert', {
      driverUserId: req.userId,
      rideRequestId,
      responseStatus: acceptedSnapshot?.status || null,
      respondedAt: acceptedSnapshot?.responded_at || null,
      nowIso: new Date().toISOString(),
    });

    const acceptableRideUpdate = await query(
      `UPDATE ride_requests
       SET status = CASE WHEN status = 'requested' THEN 'driver_found' ELSE status END,
           driver_found_at = COALESCE(driver_found_at, CURRENT_TIMESTAMP)
       WHERE id = ?
         AND status IN ('requested', 'driver_found')
         AND (
           (status = 'requested' AND requested_at >= (CURRENT_TIMESTAMP - INTERVAL ${OPEN_REQUEST_TTL_MINUTES} MINUTE))
           OR (
             status = 'driver_found'
             AND COALESCE(driver_found_at, requested_at) >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_FOUND_SELECTION_TTL_MINUTES} MINUTE)
           )
         )`,
      [rideRequestId]
    );
    console.log('[drivers.accept] ttl-gated update result', {
      driverUserId: req.userId,
      rideRequestId,
      affectedRows: Number(acceptableRideUpdate?.affectedRows || 0),
      changedRows: Number(acceptableRideUpdate?.changedRows || 0),
      nowIso: new Date().toISOString(),
    });
    if (Number(acceptableRideUpdate?.affectedRows || 0) < 1) {
      const [latestRide] = await query(
        `SELECT
           id,
           status,
           requested_at,
           driver_found_at,
           TIMESTAMPDIFF(SECOND, requested_at, CURRENT_TIMESTAMP) AS requested_age_seconds,
           TIMESTAMPDIFF(SECOND, COALESCE(driver_found_at, requested_at), CURRENT_TIMESTAMP) AS selection_age_seconds
         FROM ride_requests
         WHERE id = ?
         LIMIT 1`,
        [rideRequestId]
      );
      const latestStatus = String(latestRide?.status || '');
      const requestedAgeSeconds = Number(latestRide?.requested_age_seconds || 0);
      const selectionAgeSeconds = Number(latestRide?.selection_age_seconds || 0);
      const stillEligibleNoop =
        (latestStatus === 'requested' && requestedAgeSeconds < OPEN_REQUEST_TTL_MINUTES * 60) ||
        (latestStatus === 'driver_found' && selectionAgeSeconds < DRIVER_FOUND_SELECTION_TTL_MINUTES * 60);
      if (stillEligibleNoop) {
        console.log('[drivers.accept] ttl-gated update no-op but still eligible', {
          driverUserId: req.userId,
          rideRequestId,
          latestRide,
          nowIso: new Date().toISOString(),
        });
      } else {
      await query(
        `UPDATE ride_requests
         SET status = 'expired',
             cancellation_reason = 'No driver accepted the request in time',
             cancelled_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (
             (status = 'requested' AND requested_at < (CURRENT_TIMESTAMP - INTERVAL ${OPEN_REQUEST_TTL_MINUTES} MINUTE))
             OR (
               status = 'driver_found'
               AND COALESCE(driver_found_at, requested_at) < (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_FOUND_SELECTION_TTL_MINUTES} MINUTE)
             )
           )`,
        [rideRequestId]
      );
      console.log('[drivers.accept] marked expired after ttl gate miss', {
        driverUserId: req.userId,
        rideRequestId,
        latestRide: latestRide || null,
        openRequestTtlSeconds: OPEN_REQUEST_TTL_MINUTES * 60,
        driverFoundSelectionTtlSeconds: DRIVER_FOUND_SELECTION_TTL_MINUTES * 60,
        nowIso: new Date().toISOString(),
      });
      return res.status(409).json({ error: 'Ride request has expired' });
      }
    }

    emitRideStatusToPassenger(ride.passenger_user_id, {
      rideRequestId,
      status: 'driver_found',
      driverUserId: req.userId,
      acceptedDriver: acceptedDriverPayload,
    });
    await notifyPassengerRideStatus(ride.passenger_user_id, {
      title: 'Driver accepted your request',
      body: 'A nearby driver accepted. Open the app to continue your ride.',
      data: {
        type: 'ride_status',
        status: 'driver_found',
        rideRequestId,
        driverUserId: req.userId,
      },
    });
    emitRideStatusToDriver(req.userId, {
      rideRequestId,
      status: 'driver_found',
      passengerUserId: ride.passenger_user_id,
    });

    return res.json({
      rideRequest: {
        id: rideRequestId,
        status: 'driver_found',
        driverDistanceKm: Number(driverDistanceKm.toFixed(2)),
        driverEtaMinutes,
        awaitingPassengerSelection: true,
      },
    });
  } catch (err) {
    console.error('PATCH /api/drivers/ride-requests/:rideRequestId/accept', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/current-ride', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    await cleanupStaleActiveRides(req.userId);

    const [ride] = await query(
      `SELECT
         id,
         public_id,
         passenger_user_id,
         passenger_name,
         passenger_phone,
         pickup_label,
         pickup_lat,
         pickup_lng,
         dropoff_label,
         dropoff_lat,
         dropoff_lng,
         estimated_distance_km,
         estimated_minutes,
         estimated_amount,
         tip_amount,
         status,
         requested_at,
         assigned_at,
         arrived_at,
         completed_at
       FROM ride_requests
       WHERE driver_user_id = ?
         AND status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       ORDER BY COALESCE(arrived_at, assigned_at, requested_at) DESC, id DESC
       LIMIT 1`,
      [req.userId]
    );

    if (!ride) {
      return res.json({ ride: null });
    }

    const [availability] = await query(
      `SELECT current_lat, current_lng
       FROM driver_availability
       WHERE driver_user_id = ?
       LIMIT 1`,
      [req.userId]
    );

    const driverCoordinate = availability?.current_lat !== null && availability?.current_lng !== null
      ? {
          latitude: Number(availability.current_lat),
          longitude: Number(availability.current_lng),
        }
      : null;

    const passengerProfileImageUrl = await getUserProfileImageUrl(ride.passenger_user_id);

    return res.json({
      ride: {
        id: ride.id,
        publicId: ride.public_id,
        passengerName: getPassengerDisplayName(ride.passenger_name),
        passengerPhone: ride.passenger_phone || null,
        pickupLabel: ride.pickup_label,
        pickupCoordinate: {
          latitude: Number(ride.pickup_lat),
          longitude: Number(ride.pickup_lng),
        },
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
        status: ride.status,
        stage: mapTripStage(ride.status),
        driverCoordinate,
        requestedAt: toIsoOrNull(ride.requested_at),
        assignedAt: toIsoOrNull(ride.assigned_at),
        arrivedAt: toIsoOrNull(ride.arrived_at),
        passengerConfirmedAt: toIsoOrNull(ride.passenger_confirmed_at),
        completedAt: toIsoOrNull(ride.completed_at),
        passengerProfileImageUrl,
      },
    });
  } catch (err) {
    console.error('GET /api/drivers/current-ride', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/current-ride/:rideRequestId/arrived', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await queryWithDeadlockRetry(
      `UPDATE ride_requests
       SET status = 'driver_arrived', arrived_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND driver_user_id = ?
         AND status = 'driver_assigned'`,
      [rideRequestId, req.userId]
    );
    const arrivedAt = new Date().toISOString();

    const [ride] = await query(
      'SELECT passenger_user_id FROM ride_requests WHERE id = ? AND driver_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.passenger_user_id) {
      emitRideStatusToPassenger(ride.passenger_user_id, {
        rideRequestId,
        status: 'driver_arrived',
        arrivedAt,
        driverUserId: req.userId,
      });
      await notifyPassengerRideStatus(ride.passenger_user_id, {
        title: 'Driver has arrived',
        body: 'Your driver is waiting at the pickup point.',
        data: {
          type: 'ride_status',
          status: 'driver_arrived',
          arrivedAt,
          rideRequestId,
          driverUserId: req.userId,
        },
      });
    }
    emitRideStatusToDriver(req.userId, {
      rideRequestId,
      status: 'driver_arrived',
      arrivedAt,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/drivers/current-ride/:rideRequestId/arrived', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/current-ride/:rideRequestId/start', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await queryWithDeadlockRetry(
      `UPDATE ride_requests
       SET status = 'in_progress',
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = ?
         AND driver_user_id = ?
         AND status IN ('driver_arrived', 'driver_assigned')`,
      [rideRequestId, req.userId]
    );

    const [ride] = await query(
      'SELECT passenger_user_id FROM ride_requests WHERE id = ? AND driver_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.passenger_user_id) {
      emitRideStatusToPassenger(ride.passenger_user_id, {
        rideRequestId,
        status: 'in_progress',
        driverUserId: req.userId,
      });
      await notifyPassengerRideStatus(ride.passenger_user_id, {
        title: 'Ride started',
        body: 'Your trip is now in progress.',
        data: {
          type: 'ride_status',
          status: 'in_progress',
          rideRequestId,
          driverUserId: req.userId,
        },
      });
    }
    emitRideStatusToDriver(req.userId, {
      rideRequestId,
      status: 'in_progress',
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/drivers/current-ride/:rideRequestId/start', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/current-ride/:rideRequestId/complete', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    await queryWithDeadlockRetry(
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
       WHERE id = ?
         AND driver_user_id = ?
         AND status IN ('in_progress', 'driver_arrived', 'driver_assigned')`,
      [rideRequestId, req.userId]
    );

    const [ride] = await query(
      'SELECT passenger_user_id FROM ride_requests WHERE id = ? AND driver_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.passenger_user_id) {
      emitRideStatusToPassenger(ride.passenger_user_id, {
        rideRequestId,
        status: 'completed',
        driverUserId: req.userId,
      });
      await notifyPassengerRideStatus(ride.passenger_user_id, {
        title: 'Ride completed',
        body: 'Your trip has been completed. Please rate your driver.',
        data: {
          type: 'ride_status',
          status: 'completed',
          rideRequestId,
          driverUserId: req.userId,
        },
      });
    }
    emitRideStatusToDriver(req.userId, {
      rideRequestId,
      status: 'completed',
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/drivers/current-ride/:rideRequestId/complete', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/ride-requests/:rideRequestId/rate-passenger', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
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
      `SELECT id, passenger_user_id, status FROM ride_requests
       WHERE id = ? AND driver_user_id = ? LIMIT 1`,
      [rideRequestId, req.userId]
    );
    if (!ride) {
      return res.status(404).json({ error: 'Ride request not found' });
    }
    if (ride.status !== 'completed') {
      return res.status(409).json({ error: 'You can only rate a passenger after the ride is completed' });
    }

    await query(
      `UPDATE ride_requests
       SET driver_passenger_rating = ?,
           driver_passenger_review = ?,
           driver_passenger_rated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND driver_user_id = ?`,
      [rating, review || null, rideRequestId, req.userId]
    );

    try {
      const passengerUser = await getClerkUserById(ride.passenger_user_id);
      const pushToken = passengerUser?.privateMetadata?.pushToken;
      if (pushToken) {
        await sendExpoPushNotifications({
          to: pushToken,
          title: 'New driver rating',
          body: `Your driver rated this trip ${rating} star${rating === 1 ? '' : 's'}.`,
          data: {
            type: 'passenger_rating',
            rating,
            review,
            rideRequestId,
          },
        });
      }
    } catch (pushError) {
      console.error('Failed to send passenger rating push', pushError);
    }

    emitTripRatingToPassenger(ride.passenger_user_id, {
      rideRequestId,
      rating,
      review,
      from: 'driver',
    });

    return res.json({ ok: true, rating, review });
  } catch (err) {
    console.error('POST /api/drivers/ride-requests/:rideRequestId/rate-passenger', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/current-ride/:rideRequestId/cancel', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const rideRequestId = Number(req.params.rideRequestId);
    if (!Number.isInteger(rideRequestId)) {
      return res.status(400).json({ error: 'Invalid rideRequestId' });
    }

    const reason = String(req.body?.reason || 'Driver cancelled').trim();

    await queryWithDeadlockRetry(
      `UPDATE ride_requests
       SET status = 'cancelled',
           cancellation_reason = ?,
           cancelled_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND driver_user_id = ?
         AND status IN ('driver_assigned', 'driver_arrived', 'in_progress')`,
      [reason, rideRequestId, req.userId]
    );

    const [ride] = await query(
      'SELECT passenger_user_id FROM ride_requests WHERE id = ? AND driver_user_id = ? LIMIT 1',
      [rideRequestId, req.userId]
    );
    if (ride?.passenger_user_id) {
      emitRideStatusToPassenger(ride.passenger_user_id, {
        rideRequestId,
        status: 'cancelled',
        driverUserId: req.userId,
      });
      await notifyPassengerRideStatus(ride.passenger_user_id, {
        title: 'Ride cancelled',
        body: 'Your driver cancelled the trip.',
        data: {
          type: 'ride_status',
          status: 'cancelled',
          rideRequestId,
          driverUserId: req.userId,
        },
      });
    }
    emitRideRequestRemovedFromDriver(req.userId, {
      rideRequestId,
      reason: 'driver_cancelled',
    });
    emitRideStatusToDriver(req.userId, {
      rideRequestId,
      status: 'cancelled',
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/drivers/current-ride/:rideRequestId/cancel', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
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
       WHERE driver_user_id = ?`,
      [req.userId]
    );
    const total = Number(countRow?.total || 0);

    const rows = await query(
      `SELECT
         id,
         public_id,
         passenger_name,
         requested_tier_name,
         pickup_label,
         dropoff_label,
         estimated_distance_km,
         estimated_minutes,
         estimated_amount,
         tip_amount,
         driver_distance_km,
         driver_eta_minutes,
         passenger_driver_rating,
         passenger_driver_review,
         passenger_driver_rated_at,
         status,
         requested_at,
         assigned_at,
         arrived_at,
         completed_at,
         cancelled_at
       FROM ride_requests
       WHERE driver_user_id = ?
       ORDER BY COALESCE(completed_at, cancelled_at, arrived_at, assigned_at, requested_at) DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [req.userId]
    );

    const [summaryRow] = await query(
      `SELECT
         COUNT(*) AS total_rides,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_rides,
         SUM(CASE WHEN status IN ('driver_assigned', 'driver_arrived', 'in_progress') THEN 1 ELSE 0 END) AS active_rides,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN estimated_amount + COALESCE(tip_amount, 0) ELSE 0 END), 0) AS total_earnings,
         COALESCE(SUM(CASE
           WHEN status = 'completed' AND DATE(completed_at) = CURRENT_DATE THEN estimated_amount + COALESCE(tip_amount, 0)
           ELSE 0
         END), 0) AS today_earnings,
         AVG(CASE WHEN passenger_driver_rating IS NOT NULL THEN passenger_driver_rating END) AS avg_rating,
         COUNT(passenger_driver_rating) AS rating_count
       FROM ride_requests
       WHERE driver_user_id = ?`,
      [req.userId]
    );

    return res.json({
      rides: rows.map((row) => ({
        ...(function buildReviewPayload() {
          const hideFreshReview = shouldHideFreshPassengerReview(row.passenger_driver_rated_at);
          return {
            passengerDriverRating: hideFreshReview
              ? null
              : (row.passenger_driver_rating === null ? null : Number(row.passenger_driver_rating)),
            passengerDriverReview: hideFreshReview ? '' : (row.passenger_driver_review || ''),
            passengerDriverRatedAt: hideFreshReview ? null : (row.passenger_driver_rated_at || null),
            passengerDriverReviewPending:
              hideFreshReview && (row.passenger_driver_rating !== null || !!String(row.passenger_driver_review || '').trim()),
          };
        })(),
        id: row.id,
        publicId: row.public_id,
        passengerName: getPassengerDisplayName(row.passenger_name),
        tierName: row.requested_tier_name,
        pickupLabel: row.pickup_label,
        dropoffLabel: row.dropoff_label,
        estimatedDistanceKm: Number(row.estimated_distance_km || 0),
        estimatedMinutes: Number(row.estimated_minutes || 0),
        estimatedAmount: Number(row.estimated_amount || 0),
        tipAmount: Number(row.tip_amount || 0),
        totalEarned: Number(row.estimated_amount || 0) + Number(row.tip_amount || 0),
        driverDistanceKm: row.driver_distance_km === null ? null : Number(row.driver_distance_km),
        driverEtaMinutes: row.driver_eta_minutes === null ? null : Number(row.driver_eta_minutes),
        status: mapDriverRideStatus(row.status),
        rawStatus: row.status,
        requestedAt: row.requested_at,
        assignedAt: row.assigned_at,
        arrivedAt: row.arrived_at,
        completedAt: row.completed_at,
        cancelledAt: row.cancelled_at,
      })),
      summary: {
        totalRides: Number(summaryRow?.total_rides || 0),
        completedRides: Number(summaryRow?.completed_rides || 0),
        activeRides: Number(summaryRow?.active_rides || 0),
        totalEarnings: Number(summaryRow?.total_earnings || 0),
        todayEarnings: Number(summaryRow?.today_earnings || 0),
        averageRating: summaryRow?.avg_rating === null ? null : Number(summaryRow.avg_rating),
        ratingCount: Number(summaryRow?.rating_count || 0),
      },
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
    console.error('GET /api/drivers/history', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/documents', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const existing = await getDriverVerificationFromMysql(req.userId, user);
    if (existing.driverProfile?.status === 'rejected' && existing.driverProfile?.canResubmit === false) {
      return res.status(403).json({ error: 'You are not allowed to resubmit documents. Contact support.' });
    }

    const { nationalIdFrontUrl, nationalIdBackUrl, driverLicenceUrl, selfieUrl, selfieWithIdCardUrl } = req.body || {};
    const currentProfile = existing.driverProfile || null;
    const currentValues = {
      nationalIdFrontUrl: currentProfile?.nationalIdFrontUrl || null,
      nationalIdBackUrl: currentProfile?.nationalIdBackUrl || null,
      driverLicenceUrl: currentProfile?.driverLicenceUrl || null,
      selfieUrl: currentProfile?.selfieUrl || null,
      selfieWithIdCardUrl: currentProfile?.selfieWithIdCardUrl || null,
    };
    const nextValues = {
      nationalIdFrontUrl: nationalIdFrontUrl || currentValues.nationalIdFrontUrl,
      nationalIdBackUrl: nationalIdBackUrl || currentValues.nationalIdBackUrl,
      driverLicenceUrl: driverLicenceUrl || currentValues.driverLicenceUrl,
      selfieUrl: selfieUrl || currentValues.selfieUrl,
      selfieWithIdCardUrl: selfieWithIdCardUrl || currentValues.selfieWithIdCardUrl,
    };

    const providedCount = [
      nextValues.nationalIdFrontUrl,
      nextValues.nationalIdBackUrl,
      nextValues.driverLicenceUrl,
      nextValues.selfieUrl,
      nextValues.selfieWithIdCardUrl,
    ].filter(Boolean).length;

    if (providedCount === 0) {
      return res.status(400).json({
        error: 'Submit at least one identity document to save progress',
      });
    }

    const submittedAt = new Date();
    await query(
      `INSERT INTO driver_identity (
        driver_user_id, national_id_front_url, national_id_back_url, driver_licence_url, selfie_url, selfie_with_id_card_url,
        profile_status, profile_submitted_at, profile_rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
      ON DUPLICATE KEY UPDATE
        national_id_front_url = VALUES(national_id_front_url),
        national_id_back_url = VALUES(national_id_back_url),
        driver_licence_url = VALUES(driver_licence_url),
        selfie_url = VALUES(selfie_url),
        selfie_with_id_card_url = VALUES(selfie_with_id_card_url),
        profile_status = 'pending',
        profile_submitted_at = COALESCE(driver_identity.profile_submitted_at, VALUES(profile_submitted_at)),
        profile_reviewed_at = NULL,
        profile_rejection_reason = NULL,
        updated_at = CURRENT_TIMESTAMP`,
      [
        req.userId,
        nextValues.nationalIdFrontUrl,
        nextValues.nationalIdBackUrl,
        nextValues.driverLicenceUrl,
        nextValues.selfieUrl,
        nextValues.selfieWithIdCardUrl,
        submittedAt,
      ]
    );

    const [identity] = await query('SELECT * FROM driver_identity WHERE driver_user_id = ? LIMIT 1', [req.userId]);
    const row = identity || {};
    const driverProfile = {
      id: `profile_${req.userId}`,
      status: row.profile_status || 'pending',
      submittedAt: row.profile_submitted_at ? new Date(row.profile_submitted_at).toISOString() : submittedAt.toISOString(),
      rejectionReason: row.profile_rejection_reason || null,
      selfieWithIdCardUrl: row.selfie_with_id_card_url || null,
    };
    return res.status(201).json(driverProfile);
  } catch (err) {
    console.error('POST /api/drivers/documents', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/vehicle', requireAuth, async (req, res) => {
  try {
    const user = await requireDriver(req, res);
    if (!user) return;

    const verification = await getDriverVerificationFromMysql(req.userId, user);
    if (verification.vehicle?.status === 'rejected' && verification.vehicle?.canResubmit === false) {
      return res.status(403).json({ error: 'You are not allowed to resubmit vehicle documents. Contact support.' });
    }

    const {
      carPhotoFrontUrl,
      carPhotoRearUrl,
      carPhotoUrls,
      numberPlate,
      make,
      model,
      year,
      color,
      vehicleRegistrationUrl,
      vehicleRegistrationBookUrl,
      insuranceUrl,
      zinaraUrl,
      vehicleTierKey,
      vehicleTierName,
      seatCount,
      doorCount,
      vehicleCategory,
      hasAirConditioning,
      hasChargingPorts,
      hasWifi,
      hasLeatherSeats,
      hasLargeLuggageSpace,
      hasSlidingDoors,
      isHighEnd,
    } = req.body || {};

    const normalizedPhotoUrls = Array.from(
      new Set(
        (Array.isArray(carPhotoUrls) ? carPhotoUrls : [carPhotoFrontUrl, carPhotoRearUrl])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
    const normalizedTierKey = String(vehicleTierKey || '').trim().toLowerCase();
    const registrationBookUrl = String(vehicleRegistrationBookUrl || vehicleRegistrationUrl || '').trim();
    const normalizedInsuranceUrl = String(insuranceUrl || '').trim();
    const normalizedZinaraUrl = String(zinaraUrl || '').trim();
    const parsedYear = Number(year);
    const parsedSeatCount = seatCount === '' || seatCount === null || seatCount === undefined ? null : Number(seatCount);
    const parsedDoorCount = doorCount === '' || doorCount === null || doorCount === undefined ? null : Number(doorCount);

    const [existingVehicleRow] = await query(
      'SELECT * FROM driver_vehicle WHERE driver_user_id = ? LIMIT 1',
      [req.userId]
    );

    const existingVehicle = existingVehicleRow || null;
    const [activeRide] = await query(
      `SELECT id
       FROM ride_requests
       WHERE driver_user_id = ?
         AND status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       LIMIT 1`,
      [req.userId]
    );
    if (activeRide) {
      return res.status(409).json({ error: 'Complete or cancel your active ride before changing your car.' });
    }

    const mergedPhotoUrls = Array.from(
      new Set([
        ...(Array.isArray(existingVehicle?.car_photo_urls)
          ? (() => {
              try {
                return JSON.parse(existingVehicle.car_photo_urls);
              } catch (_) {
                return [];
              }
            })()
          : []),
        ...(normalizedPhotoUrls || []),
      ].filter(Boolean))
    );

    const nextNumberPlate = String(numberPlate || existingVehicle?.number_plate || '').trim();
    const nextMake = String(make || existingVehicle?.make || '').trim();
    const nextModel = String(model || existingVehicle?.model || '').trim();
    const nextRegistrationBookUrl = String(registrationBookUrl || existingVehicle?.vehicle_registration_book_url || existingVehicle?.vehicle_registration_url || '').trim();
    const nextInsuranceUrl = String(normalizedInsuranceUrl || existingVehicle?.insurance_url || '').trim();
    const nextZinaraUrl = String(normalizedZinaraUrl || existingVehicle?.zinara_url || '').trim();
    const nextTierKey = String(normalizedTierKey || existingVehicle?.vehicle_tier_key || '').trim().toLowerCase();
    const nextTierNameInput = String(vehicleTierName || existingVehicle?.vehicle_tier_name || '').trim();
    const nextYear = Number.isInteger(parsedYear) ? parsedYear : (existingVehicle?.year ?? null);
    const nextSeatCount = parsedSeatCount !== null ? parsedSeatCount : (existingVehicle?.seat_count ?? null);
    const nextDoorCount = parsedDoorCount !== null ? parsedDoorCount : (existingVehicle?.door_count ?? null);
    const nextColor = color?.trim?.() || existingVehicle?.color || null;
    const nextCategory = vehicleCategory ? String(vehicleCategory).trim().toLowerCase() : (existingVehicle?.vehicle_category || null);
    const nextHasAirConditioning = hasAirConditioning === undefined ? !!existingVehicle?.has_air_conditioning : hasAirConditioning === true;
    const nextHasChargingPorts = hasChargingPorts === undefined ? !!existingVehicle?.has_charging_ports : hasChargingPorts === true;
    const nextHasWifi = hasWifi === undefined ? !!existingVehicle?.has_wifi : hasWifi === true;
    const nextHasLeatherSeats = hasLeatherSeats === undefined ? !!existingVehicle?.has_leather_seats : hasLeatherSeats === true;
    const nextHasLargeLuggageSpace = hasLargeLuggageSpace === undefined ? !!existingVehicle?.has_large_luggage_space : hasLargeLuggageSpace === true;
    const nextHasSlidingDoors = hasSlidingDoors === undefined ? !!existingVehicle?.has_sliding_doors : hasSlidingDoors === true;
    const nextIsHighEnd = isHighEnd === undefined ? !!existingVehicle?.is_high_end : isHighEnd === true;

    const providedVehicleCount = [
      nextNumberPlate,
      nextMake,
      nextModel,
      nextYear,
      nextRegistrationBookUrl,
      nextInsuranceUrl,
      nextZinaraUrl,
      nextTierKey,
      ...mergedPhotoUrls,
    ].filter(Boolean).length;

    if (providedVehicleCount === 0) {
      return res.status(400).json({ error: 'Submit at least one vehicle detail or document to save progress' });
    }
    if (nextYear !== null && (!Number.isInteger(Number(nextYear)) || Number(nextYear) < 1900)) {
      return res.status(400).json({ error: 'A valid vehicle year is required when provided' });
    }
    if (nextSeatCount !== null && (!Number.isInteger(nextSeatCount) || nextSeatCount < 1)) {
      return res.status(400).json({ error: 'seatCount must be a valid whole number when provided' });
    }
    if (nextDoorCount !== null && (!Number.isInteger(nextDoorCount) || nextDoorCount < 1)) {
      return res.status(400).json({ error: 'doorCount must be a valid whole number when provided' });
    }
    let tierKey = nextTierKey || null;
    let tierName = nextTierNameInput || null;
    if (tierKey) {
      const configuredVehicleTiers = await loadVehicleTierRules();
      let matchedTier = configuredVehicleTiers.find((tier) => String(tier.tierKey || '').trim().toLowerCase() === tierKey) || null;

      if (!matchedTier) {
        const [legacyMatchedTier] = await query(
          `SELECT t.tier_key, t.tier_name
           FROM operating_region_pricing_tiers t
           INNER JOIN operating_regions r ON r.id = t.region_id
           WHERE r.is_active = 1 AND t.is_active = 1 AND LOWER(t.tier_key) = ?
           ORDER BY t.sort_order ASC, t.id ASC
           LIMIT 1`,
          [tierKey]
        );
        matchedTier = legacyMatchedTier || null;
      }

      if (!matchedTier) {
        return res.status(400).json({ error: 'Selected vehicle tier is invalid' });
      }

      tierKey = matchedTier.tier_key || matchedTier.tierKey;
      tierName = tierName || matchedTier.tier_name || matchedTier.tierName;
    }

    const submittedAt = new Date();

    await query(
      `INSERT INTO driver_vehicle (
        driver_user_id, car_photo_front_url, car_photo_rear_url, car_photo_urls,
        vehicle_registration_url, vehicle_registration_book_url, insurance_url, zinara_url,
        number_plate, make, model, year, color, vehicle_tier_key, vehicle_tier_name,
        seat_count, door_count, vehicle_category,
        has_air_conditioning, has_charging_ports, has_wifi, has_leather_seats,
        has_large_luggage_space, has_sliding_doors, is_high_end,
        vehicle_status, vehicle_submitted_at, vehicle_rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        car_photo_front_url = VALUES(car_photo_front_url),
        car_photo_rear_url = VALUES(car_photo_rear_url),
        car_photo_urls = VALUES(car_photo_urls),
        vehicle_registration_url = VALUES(vehicle_registration_url),
        vehicle_registration_book_url = VALUES(vehicle_registration_book_url),
        insurance_url = VALUES(insurance_url),
        zinara_url = VALUES(zinara_url),
        number_plate = VALUES(number_plate),
        make = VALUES(make),
        model = VALUES(model),
        year = VALUES(year),
        color = VALUES(color),
        vehicle_tier_key = VALUES(vehicle_tier_key),
        vehicle_tier_name = VALUES(vehicle_tier_name),
        seat_count = VALUES(seat_count),
        door_count = VALUES(door_count),
        vehicle_category = VALUES(vehicle_category),
        has_air_conditioning = VALUES(has_air_conditioning),
        has_charging_ports = VALUES(has_charging_ports),
        has_wifi = VALUES(has_wifi),
        has_leather_seats = VALUES(has_leather_seats),
        has_large_luggage_space = VALUES(has_large_luggage_space),
        has_sliding_doors = VALUES(has_sliding_doors),
        is_high_end = VALUES(is_high_end),
        vehicle_status = 'pending',
        vehicle_submitted_at = VALUES(vehicle_submitted_at),
        vehicle_reviewed_at = NULL,
        vehicle_rejection_reason = NULL,
        updated_at = CURRENT_TIMESTAMP`,
      [
        req.userId,
        mergedPhotoUrls[0] || existingVehicle?.car_photo_front_url || null,
        mergedPhotoUrls[1] || existingVehicle?.car_photo_rear_url || null,
        JSON.stringify(mergedPhotoUrls),
        nextRegistrationBookUrl || null,
        nextRegistrationBookUrl || null,
        nextInsuranceUrl || null,
        nextZinaraUrl || null,
        nextNumberPlate || null,
        nextMake || null,
        nextModel || null,
        nextYear,
        nextColor,
        tierKey,
        tierName,
        nextSeatCount,
        nextDoorCount,
        nextCategory,
        nextHasAirConditioning ? 1 : 0,
        nextHasChargingPorts ? 1 : 0,
        nextHasWifi ? 1 : 0,
        nextHasLeatherSeats ? 1 : 0,
        nextHasLargeLuggageSpace ? 1 : 0,
        nextHasSlidingDoors ? 1 : 0,
        nextIsHighEnd ? 1 : 0,
        'pending',
        submittedAt,
      ]
    );

    await query(
      `UPDATE driver_availability
       SET is_online = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE driver_user_id = ?`,
      [req.userId]
    );

    const vehicle = {
      id: `vehicle_${req.userId}`,
      status: 'pending',
      submittedAt: submittedAt.toISOString(),
      rejectionReason: null,
    };
    return res.status(201).json(vehicle);
  } catch (err) {
    console.error('POST /api/drivers/vehicle', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
