import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { getClerkUserById, normalizeRole, toAppUser } from '../lib/clerk-user.js';
import { getPassengerVerificationFromMysql } from '../lib/passenger-verification-mysql.js';

const router = Router();
const DRIVER_ONLINE_STALE_DAYS = 1;

async function requirePassenger(req, res) {
  const user = await getClerkUserById(req.userId);
  const appUser = toAppUser(user);
  const role = normalizeRole(appUser.role);
  // Allow both dedicated passengers and drivers to request ride tiers,
  // since drivers can also act as riders in the consumer app.
  if (role !== 'passenger' && role !== 'driver') {
    res.status(403).json({ error: 'Not allowed to request ride options' });
    return null;
  }
  return user;
}

router.get('/ride-options', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const rows = await query(
      `SELECT
        t.id,
        t.tier_key,
        t.tier_name,
        t.price_per_km,
        t.base_fare,
        t.per_minute_rate,
        t.minimum_fare,
        t.sort_order
      FROM operating_region_pricing_tiers t
      INNER JOIN operating_regions r ON r.id = t.region_id
      WHERE r.is_active = 1 AND t.is_active = 1
      ORDER BY t.sort_order ASC, t.id ASC`
    );

    if (!rows.length) {
      return res.json({ tiers: [] });
    }

    return res.json({
      tiers: rows.map((row) => ({
        id: row.id,
        tierKey: row.tier_key,
        tierName: row.tier_name,
        pricePerKm: Number(row.price_per_km || 0),
        baseFare: Number(row.base_fare || 0),
        perMinuteRate: Number(row.per_minute_rate || 0),
        minimumFare: Number(row.minimum_fare || 0),
        sortOrder: Number(row.sort_order || 0),
        regionName: null,
        city: null,
        countryCode: null,
      })),
    });
  } catch (err) {
    console.error('GET /api/passengers/ride-options', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/nearby-drivers', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const latitude = Number(req.query?.latitude);
    const longitude = Number(req.query?.longitude);
    const radiusKm = Math.min(Math.max(Number(req.query?.radiusKm || 8), 1), 25);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }

    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2));

    const rows = await query(
      `SELECT
         da.driver_user_id,
         da.driver_name,
         da.vehicle_tier_name,
         da.vehicle_make,
         da.vehicle_model,
         da.number_plate,
         da.current_lat,
         da.current_lng
       FROM driver_availability da
       LEFT JOIN ride_requests active_ride
         ON active_ride.driver_user_id = da.driver_user_id
        AND active_ride.status IN ('driver_assigned', 'driver_arrived', 'in_progress')
       WHERE da.is_online = 1
         AND da.current_lat IS NOT NULL
         AND da.current_lng IS NOT NULL
         AND da.last_seen_at >= (CURRENT_TIMESTAMP - INTERVAL ${DRIVER_ONLINE_STALE_DAYS} DAY)
         AND active_ride.id IS NULL
         AND da.current_lat BETWEEN ? AND ?
         AND da.current_lng BETWEEN ? AND ?
       ORDER BY da.updated_at DESC
       LIMIT 50`,
      [latitude - latDelta, latitude + latDelta, longitude - lngDelta, longitude + lngDelta]
    );

    const drivers = rows.map((row) => ({
      id: row.driver_user_id,
      driverName: row.driver_name || 'Driver',
      tierName: row.vehicle_tier_name || null,
      carName: [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle',
      plate: row.number_plate || null,
      coordinate: {
        latitude: Number(row.current_lat),
        longitude: Number(row.current_lng),
      },
    }));

    return res.json({ drivers });
  } catch (err) {
    console.error('GET /api/passengers/nearby-drivers', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me/verification', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const verification = await getPassengerVerificationFromMysql(req.userId);
    return res.json(verification);
  } catch (err) {
    console.error('GET /api/passengers/me/verification', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/identity', requireAuth, async (req, res) => {
  try {
    const user = await requirePassenger(req, res);
    if (!user) return;

    const nationalIdFrontUrl = String(req.body?.nationalIdFrontUrl || '').trim();
    const nationalIdBackUrl = String(req.body?.nationalIdBackUrl || '').trim();

    if (!nationalIdFrontUrl || !nationalIdBackUrl) {
      return res.status(400).json({ error: 'National ID front and back images are required' });
    }

    const existing = await query(
      `SELECT identity_status, identity_can_resubmit
       FROM passenger_identity
       WHERE passenger_user_id = ?
       LIMIT 1`,
      [req.userId]
    );

    const currentRow = existing[0] || null;
    if (currentRow?.identity_status === 'rejected' && currentRow.identity_can_resubmit === 0) {
      return res.status(403).json({ error: 'Resubmission is currently blocked. Please contact support.' });
    }

    await query(
      `INSERT INTO passenger_identity (
         passenger_user_id,
         national_id_front_url,
         national_id_back_url,
         identity_status,
         identity_submitted_at,
         identity_reviewed_at,
         identity_rejection_reason,
         identity_can_resubmit
       ) VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP, NULL, NULL, 1)
       ON DUPLICATE KEY UPDATE
         national_id_front_url = VALUES(national_id_front_url),
         national_id_back_url = VALUES(national_id_back_url),
         identity_status = 'pending',
         identity_submitted_at = CURRENT_TIMESTAMP,
         identity_reviewed_at = NULL,
         identity_rejection_reason = NULL,
         identity_can_resubmit = 1`,
      [req.userId, nationalIdFrontUrl, nationalIdBackUrl]
    );

    const verification = await getPassengerVerificationFromMysql(req.userId);
    return res.status(201).json(verification);
  } catch (err) {
    console.error('POST /api/passengers/identity', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
