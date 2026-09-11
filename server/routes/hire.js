import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, withTransaction } from '../db/connection.js';
import { getClerkUserById, toAppUser, normalizeRole } from '../lib/clerk-user.js';
import { upsertClerkUserToMysql } from '../lib/user-sync.js';
import { sendExpoPushNotifications, sendFcmNotifications } from '../lib/push.js';
import { emitHireQuoteToPassenger, emitHireRequestToDriver, emitToUser } from '../lib/realtime.js';
import {
  createHirePublicId,
  estimateHireFare,
  shapeHireBooking,
  shapeHireFleetVehicle,
  shapeHireQuote,
  shapeHireRequest,
  shapeHireVehicle,
} from '../lib/hire.js';
import { normalizeUploadPath } from '../lib/driver-verification-mysql.js';

const router = Router();

async function requireDriver(req, res) {
  const user = await getClerkUserById(req.userId);
  const [existingUser] = await query(
    `SELECT role FROM users WHERE clerk_user_id = ? LIMIT 1`,
    [req.userId]
  );
  const appUser = toAppUser(user);
  await upsertClerkUserToMysql(user);
  const isDriver = normalizeRole(appUser.role) === 'driver'
    || normalizeRole(existingUser?.role) === 'driver';
  if (normalizeRole(existingUser?.role) === 'driver' && normalizeRole(appUser.role) !== 'driver') {
    await query(
      `UPDATE users SET role = 'driver', updated_at = CURRENT_TIMESTAMP WHERE clerk_user_id = ?`,
      [req.userId]
    );
  }
  if (!isDriver) {
    res.status(403).json({ error: 'Not a driver' });
    return null;
  }
  return { user, appUser };
}

async function requirePassenger(req, res) {
  const user = await getClerkUserById(req.userId);
  await upsertClerkUserToMysql(user);
  const appUser = toAppUser(user);
  const role = normalizeRole(appUser.role);
  // Drivers can also book hire as consumers.
  if (role !== 'passenger' && role !== 'driver') {
    res.status(403).json({ error: 'Not allowed' });
    return null;
  }
  return { user, appUser };
}

function parsePhotos(input) {
  const list = Array.isArray(input) ? input : [];
  return list.map((item) => normalizeUploadPath(item)).filter(Boolean).slice(0, 8);
}

function buildHireRequestNotificationBody(request) {
  const title = String(request?.title || '').trim();
  const pickupLabel = request?.pickupLabel || request?.pickup_label || 'Pickup';
  const dropoffLabel = request?.dropoffLabel || request?.dropoff_label || 'destination';
  const category = request?.category ? String(request.category).replace(/_/g, ' ') : 'vehicle hire';
  const offerAmount = request?.passengerOfferAmount ?? request?.passenger_offer_amount;
  const currency = request?.fareCurrency || request?.fare_currency || 'USD';
  const offer = offerAmount ? ` · passenger bid ${currency} ${Number(offerAmount).toFixed(2)}` : '';
  if (title) {
    return `${title}: ${pickupLabel}${dropoffLabel ? ` to ${dropoffLabel}` : ''}${offer}`;
  }
  return `${category}: ${pickupLabel}${dropoffLabel ? ` to ${dropoffLabel}` : ''}${offer}`;
}

async function notifyDriversAboutHireRequest(request, passengerName = 'Passenger', { eventType = 'new' } = {}) {
  if (!request?.id) return;
  const category = String(request.category || '').trim().toLowerCase();
  const preferredVehicleId = Number(request.preferredHireVehicleId || request.preferred_hire_vehicle_id || 0);
  const params = [];
  let where = `hv.vehicle_status = 'approved'`;
  if (Number.isFinite(preferredVehicleId) && preferredVehicleId > 0) {
    where += ' AND hv.id = ?';
    params.push(preferredVehicleId);
  } else if (category) {
    where += ' AND hv.category = ?';
    params.push(category);
  }
  let drivers = await query(
    `SELECT DISTINCT hv.driver_user_id
     FROM hire_vehicles hv
     WHERE ${where}
     LIMIT 200`,
    params
  );

  // If preferred vehicle had no match, fall back to category/all approved.
  if (!drivers.length && Number.isFinite(preferredVehicleId) && preferredVehicleId > 0) {
    const fallbackParams = category ? [category] : [];
    drivers = await query(
      `SELECT DISTINCT hv.driver_user_id
       FROM hire_vehicles hv
       WHERE hv.vehicle_status = 'approved'
         ${category ? 'AND hv.category = ?' : ''}
       LIMIT 200`,
      fallbackParams
    );
  }
  if (!drivers.length) return;

  const isOfferUpdate = eventType === 'offer_updated';
  const offerAmount = request?.passengerOfferAmount ?? request?.passenger_offer_amount;
  const currency = request?.fareCurrency || request?.fare_currency || 'USD';
  const jobTitle = String(request?.title || '').trim();
  const body = isOfferUpdate
    ? `${jobTitle || 'Hire job'}: passenger offered ${currency} ${Number(offerAmount || 0).toFixed(2)}. Accept it or send your own quote.`
    : buildHireRequestNotificationBody(request);
  const pushTitle = isOfferUpdate ? 'New passenger offer' : 'New transport request';

  const destinations = (
    await Promise.all(drivers.map(async (driver) => {
      try {
        const driverUser = await getClerkUserById(driver.driver_user_id);
        return {
          driverId: driver.driver_user_id,
          expoToken: String(driverUser?.privateMetadata?.pushToken || '').trim() || null,
          fcmToken: String(driverUser?.privateMetadata?.fcmToken || '').trim() || null,
        };
      } catch {
        return { driverId: driver.driver_user_id, expoToken: null, fcmToken: null };
      }
    }))
  ).filter((item) => item.driverId);

  const payload = {
    type: isOfferUpdate ? 'driver_hire_offer_updated' : 'driver_new_hire_request',
    hireRequestId: String(request.id),
    publicId: String(request.publicId || request.public_id || ''),
    title: jobTitle,
    passengerName: String(passengerName || 'Passenger'),
    pickupLabel: String(request.pickupLabel || request.pickup_label || ''),
    dropoffLabel: String(request.dropoffLabel || request.dropoff_label || ''),
    category: String(request.category || ''),
    passengerOfferAmount: offerAmount ?? '',
    fareCurrency: String(currency),
  };

  destinations.forEach((driver) => {
    emitHireRequestToDriver(driver.driverId, payload);
  });

  const expoTokens = destinations.map((item) => item.expoToken).filter(Boolean);
  const fcmTokens = destinations.map((item) => item.fcmToken).filter(Boolean);

  const pushJobs = [];

  if (expoTokens.length) {
    pushJobs.push(sendExpoPushNotifications(expoTokens.map((token) => ({
      to: token,
      title: pushTitle,
      body,
      sound: 'sound2.mpeg',
      channelId: 'ride-requests-distant-v4',
      data: payload,
    }))));
  }

  if (fcmTokens.length) {
    pushJobs.push(sendFcmNotifications(fcmTokens.map((token) => ({
      to: token,
      title: pushTitle,
      body,
      android: {
        channelId: 'ride-requests-distant-v4',
        collapseKey: isOfferUpdate ? 'driver-hire-offer' : 'driver-hire-request',
        notification: {
          sound: 'sound2',
          tag: isOfferUpdate ? 'driver-hire-offer' : 'driver-hire-request',
        },
      },
      data: payload,
    }))));
  }

  await Promise.allSettled(pushJobs);
}

async function notifyPassengerAboutHireQuote({ request, quote, vehicle, driverName }) {
  if (!request?.passenger_user_id || !quote?.id) return;
  const amount = Number(quote.amount || 0);
  const currency = quote.currency || 'USD';
  const title = 'New hiring quote';
  const body = `${driverName || 'A driver'} sent a ${currency} ${amount.toFixed(2)} quote for your hiring request.`;
  const payload = {
    type: 'driver_new_hire_quote',
    hireRequestId: String(request.id),
    hireQuoteId: String(quote.id),
    publicId: String(request.public_id || ''),
    driverName: String(driverName || 'Driver'),
    vehicleTitle: String(vehicle?.title || ''),
    amount: String(amount),
    currency: String(currency),
    status: String(quote.status || 'pending'),
  };

  emitHireQuoteToPassenger(request.passenger_user_id, payload);

  try {
    const passengerUser = await getClerkUserById(request.passenger_user_id);
    const expoToken = String(passengerUser?.privateMetadata?.pushToken || '').trim();
    const fcmToken = String(passengerUser?.privateMetadata?.fcmToken || '').trim();
    const pushJobs = [];
    if (expoToken) {
      pushJobs.push(sendExpoPushNotifications({
        to: expoToken,
        title,
        body,
        data: payload,
      }));
    }
    if (fcmToken) {
      pushJobs.push(sendFcmNotifications({
        to: fcmToken,
        title,
        body,
        data: payload,
      }));
    }
    await Promise.allSettled(pushJobs);
  } catch (error) {
    console.error('Failed to send passenger hiring quote notification', error);
  }
}

async function notifyAboutHireBooking({ request, booking, recipientUserId, title, body, extra = {} }) {
  if (!recipientUserId || !booking?.id) return;
  const payload = {
    type: 'hire_booking_confirmed',
    hireRequestId: String(request?.id || booking.hire_request_id || ''),
    hireBookingId: String(booking.id),
    publicId: String(request?.public_id || request?.publicId || ''),
    amount: String(booking.amount || ''),
    currency: String(booking.currency || 'USD'),
    ...extra,
  };

  emitToUser(recipientUserId, 'hire_booking:confirmed', payload);

  try {
    const user = await getClerkUserById(recipientUserId);
    const expoToken = String(user?.privateMetadata?.pushToken || '').trim();
    const fcmToken = String(user?.privateMetadata?.fcmToken || '').trim();
    const pushJobs = [];
    if (expoToken) {
      pushJobs.push(sendExpoPushNotifications({
        to: expoToken,
        title,
        body,
        data: payload,
      }));
    }
    if (fcmToken) {
      pushJobs.push(sendFcmNotifications({
        to: fcmToken,
        title,
        body,
        data: payload,
      }));
    }
    await Promise.allSettled(pushJobs);
  } catch (error) {
    console.error('Failed to send hire booking notification', error);
  }
}

router.get('/fleet', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;

    const q = String(req.query?.q || '').trim().toLowerCase();
    const category = String(req.query?.category || '').trim().toLowerCase();
    const params = [];
    const where = [`hv.vehicle_status = 'approved'`];

    if (category && category !== 'all') {
      where.push('hv.category = ?');
      params.push(category);
    }
    if (q) {
      where.push(`(
        LOWER(hv.title) LIKE ?
        OR LOWER(COALESCE(hv.make, '')) LIKE ?
        OR LOWER(COALESCE(hv.model, '')) LIKE ?
        OR LOWER(COALESCE(hv.description, '')) LIKE ?
        OR LOWER(COALESCE(hv.category, '')) LIKE ?
      )`);
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }

    const rows = await query(
      `SELECT hv.*,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name
       FROM hire_vehicles hv
       LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY hv.driver_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE WHEN hv.daily_rate IS NULL THEN 1 ELSE 0 END,
         hv.daily_rate ASC,
         hv.updated_at DESC
       LIMIT 100`,
      params
    );

    return res.json({ vehicles: rows.map(shapeHireFleetVehicle) });
  } catch (err) {
    console.error('GET /api/hire/fleet', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/vehicles', requireAuth, async (req, res) => {
  try {
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const rows = await query(
      `SELECT * FROM hire_vehicles WHERE driver_user_id = ? ORDER BY updated_at DESC`,
      [req.userId]
    );
    return res.json({ vehicles: rows.map(shapeHireVehicle) });
  } catch (err) {
    console.error('GET /api/hire/vehicles', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/fare-estimate', requireAuth, async (req, res) => {
  try {
    const category = String(req.query?.category || 'other').trim().toLowerCase() || 'other';
    const passengerCount = Number(req.query?.passengerCount || 1);
    const startAt = String(req.query?.startAt || '').trim() || null;
    const endAt = String(req.query?.endAt || '').trim() || null;
    const estimate = estimateHireFare({ category, passengerCount, startAt, endAt });
    return res.json({ estimate });
  } catch (err) {
    console.error('GET /api/hire/fare-estimate', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/vehicles', requireAuth, async (req, res) => {
  try {
    const driver = await requireDriver(req, res);
    if (!driver) return;

    const title = String(req.body?.title || '').trim();
    const category = String(req.body?.category || 'sedan').trim().toLowerCase() || 'sedan';
    const make = String(req.body?.make || '').trim() || null;
    const model = String(req.body?.model || '').trim() || null;
    const color = String(req.body?.color || '').trim() || null;
    const numberPlate = String(req.body?.numberPlate || '').trim().toUpperCase() || null;
    const description = String(req.body?.description || '').trim() || null;
    const year = req.body?.year == null || req.body?.year === '' ? null : Number(req.body.year);
    const seatCount = req.body?.seatCount == null || req.body?.seatCount === ''
      ? null
      : Number(req.body.seatCount);
    const dailyRate = req.body?.dailyRate == null || req.body?.dailyRate === ''
      ? null
      : Number(req.body.dailyRate);
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';
    const photoUrls = parsePhotos(req.body?.photoUrls);

    if (!title || title.length < 3) {
      return res.status(400).json({ error: 'Vehicle title is required' });
    }
    if (photoUrls.length < 1) {
      return res.status(400).json({ error: 'Add at least one vehicle photo' });
    }
    if (year != null && (!Number.isFinite(year) || year < 1980 || year > 2100)) {
      return res.status(400).json({ error: 'Enter a valid vehicle year' });
    }
    if (seatCount != null && (!Number.isFinite(seatCount) || seatCount < 1 || seatCount > 60)) {
      return res.status(400).json({ error: 'Enter a valid seat count' });
    }
    if (dailyRate != null && (!Number.isFinite(dailyRate) || dailyRate < 0)) {
      return res.status(400).json({ error: 'Enter a valid daily rate' });
    }

    const publicId = createHirePublicId('HV');
    const result = await query(
      `INSERT INTO hire_vehicles (
         public_id, driver_user_id, title, category, make, model, year, color,
         number_plate, seat_count, description, daily_rate, currency, photo_urls,
         vehicle_status, submitted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
      [
        publicId,
        req.userId,
        title,
        category,
        make,
        model,
        year,
        color,
        numberPlate,
        seatCount,
        description,
        dailyRate,
        currency,
        JSON.stringify(photoUrls),
      ]
    );

    const [row] = await query(`SELECT * FROM hire_vehicles WHERE id = ? LIMIT 1`, [result.insertId]);
    return res.status(201).json({ vehicle: shapeHireVehicle(row) });
  } catch (err) {
    console.error('POST /api/hire/vehicles', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/vehicles/:id', requireAuth, async (req, res) => {
  try {
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const vehicleId = Number(req.params.id);
    if (!Number.isFinite(vehicleId)) return res.status(400).json({ error: 'Invalid vehicle id' });

    const [existing] = await query(
      `SELECT * FROM hire_vehicles WHERE id = ? AND driver_user_id = ? LIMIT 1`,
      [vehicleId, req.userId]
    );
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    const title = String(req.body?.title ?? existing.title ?? '').trim();
    const category = String(req.body?.category ?? existing.category ?? 'sedan').trim().toLowerCase() || 'sedan';
    const make = String(req.body?.make ?? existing.make ?? '').trim() || null;
    const model = String(req.body?.model ?? existing.model ?? '').trim() || null;
    const color = String(req.body?.color ?? existing.color ?? '').trim() || null;
    const numberPlate = String(req.body?.numberPlate ?? existing.number_plate ?? '').trim().toUpperCase() || null;
    const description = String(req.body?.description ?? existing.description ?? '').trim() || null;
    const year = req.body?.year !== undefined
      ? (req.body.year === '' || req.body.year == null ? null : Number(req.body.year))
      : existing.year;
    const seatCount = req.body?.seatCount !== undefined
      ? (req.body.seatCount === '' || req.body.seatCount == null ? null : Number(req.body.seatCount))
      : existing.seat_count;
    const dailyRate = req.body?.dailyRate !== undefined
      ? (req.body.dailyRate === '' || req.body.dailyRate == null ? null : Number(req.body.dailyRate))
      : existing.daily_rate;
    const currency = String(req.body?.currency ?? existing.currency ?? 'USD').trim().toUpperCase() || 'USD';
    const photoUrls = req.body?.photoUrls !== undefined
      ? parsePhotos(req.body.photoUrls)
      : JSON.parse(existing.photo_urls || '[]');

    if (!title || title.length < 3) {
      return res.status(400).json({ error: 'Vehicle title is required' });
    }
    if (!Array.isArray(photoUrls) || photoUrls.length < 1) {
      return res.status(400).json({ error: 'Add at least one vehicle photo' });
    }

    await query(
      `UPDATE hire_vehicles
       SET title = ?, category = ?, make = ?, model = ?, year = ?, color = ?,
           number_plate = ?, seat_count = ?, description = ?, daily_rate = ?, currency = ?,
           photo_urls = ?, vehicle_status = 'pending', rejection_reason = NULL,
           submitted_at = CURRENT_TIMESTAMP, reviewed_at = NULL
       WHERE id = ? AND driver_user_id = ?`,
      [
        title,
        category,
        make,
        model,
        year,
        color,
        numberPlate,
        seatCount,
        description,
        dailyRate,
        currency,
        JSON.stringify(photoUrls),
        vehicleId,
        req.userId,
      ]
    );

    const [row] = await query(`SELECT * FROM hire_vehicles WHERE id = ? LIMIT 1`, [vehicleId]);
    return res.json({ vehicle: shapeHireVehicle(row) });
  } catch (err) {
    console.error('PATCH /api/hire/vehicles/:id', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/requests', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const rows = await query(
      `SELECT hr.*,
              (SELECT COUNT(*) FROM hire_quotes hq WHERE hq.hire_request_id = hr.id) AS quote_count
       FROM hire_requests hr
       WHERE hr.passenger_user_id = ?
       ORDER BY hr.created_at DESC
       LIMIT 100`,
      [req.userId]
    );
    return res.json({ requests: rows.map(shapeHireRequest) });
  } catch (err) {
    console.error('GET /api/hire/requests', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/requests', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;

    const pickupLabel = String(req.body?.pickupLabel || '').trim();
    const dropoffLabel = String(req.body?.dropoffLabel || '').trim() || null;
    const title = String(req.body?.title || '').trim();
    const category = String(req.body?.category || '').trim().toLowerCase() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const startAtRaw = String(req.body?.startAt || '').trim();
    const endAtRaw = String(req.body?.endAt || '').trim();
    const passengerCount = Number(req.body?.passengerCount || 1);
    const passengerOfferAmount = req.body?.passengerOfferAmount == null || req.body?.passengerOfferAmount === ''
      ? null
      : Number(req.body.passengerOfferAmount);
    const fareCurrency = String(req.body?.fareCurrency || 'USD').trim().toUpperCase() || 'USD';
    const preferredHireVehicleIdRaw = req.body?.preferredHireVehicleId;
    const preferredHireVehicleId = preferredHireVehicleIdRaw == null || preferredHireVehicleIdRaw === ''
      ? null
      : Number(preferredHireVehicleIdRaw);
    const pickupLat = req.body?.pickupLat == null ? null : Number(req.body.pickupLat);
    const pickupLng = req.body?.pickupLng == null ? null : Number(req.body.pickupLng);
    const dropoffLat = req.body?.dropoffLat == null ? null : Number(req.body.dropoffLat);
    const dropoffLng = req.body?.dropoffLng == null ? null : Number(req.body.dropoffLng);

    if (!title) return res.status(400).json({ error: 'Give this hire request a name' });
    if (title.length > 160) return res.status(400).json({ error: 'Request name is too long' });
    if (!pickupLabel) return res.status(400).json({ error: 'Pickup location is required' });
    if (!startAtRaw) return res.status(400).json({ error: 'Start date/time is required' });
    const startAt = new Date(startAtRaw);
    if (Number.isNaN(startAt.getTime())) {
      return res.status(400).json({ error: 'Enter a valid start date/time' });
    }
    const endAt = endAtRaw ? new Date(endAtRaw) : null;
    if (endAtRaw && Number.isNaN(endAt.getTime())) {
      return res.status(400).json({ error: 'Enter a valid end date/time' });
    }
    if (!Number.isFinite(passengerCount) || passengerCount < 1 || passengerCount > 60) {
      return res.status(400).json({ error: 'Enter a valid passenger count' });
    }
    if (passengerOfferAmount != null && (!Number.isFinite(passengerOfferAmount) || passengerOfferAmount <= 0)) {
      return res.status(400).json({ error: 'Enter a valid offer amount' });
    }

    let preferredVehicle = null;
    if (preferredHireVehicleId != null) {
      if (!Number.isFinite(preferredHireVehicleId) || preferredHireVehicleId <= 0) {
        return res.status(400).json({ error: 'Invalid preferred vehicle' });
      }
      const [vehicleRow] = await query(
        `SELECT * FROM hire_vehicles WHERE id = ? AND vehicle_status = 'approved' LIMIT 1`,
        [preferredHireVehicleId]
      );
      if (!vehicleRow) {
        return res.status(400).json({ error: 'Selected hire vehicle is not available' });
      }
      preferredVehicle = vehicleRow;
    }

    const resolvedCategory = category
      || (preferredVehicle?.category ? String(preferredVehicle.category).toLowerCase() : null);

    const publicId = createHirePublicId('TH');
    const fareEstimate = estimateHireFare({
      category: resolvedCategory,
      passengerCount,
      startAt,
      endAt,
    });
    const result = await query(
      `INSERT INTO hire_requests (
         public_id, passenger_user_id, category, title, pickup_label, pickup_lat, pickup_lng,
         dropoff_label, dropoff_lat, dropoff_lng, start_at, end_at, passenger_count,
         recommended_fare_min, recommended_fare_max, passenger_offer_amount, fare_currency,
         notes, preferred_hire_vehicle_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        publicId,
        req.userId,
        resolvedCategory,
        title,
        pickupLabel,
        Number.isFinite(pickupLat) ? pickupLat : null,
        Number.isFinite(pickupLng) ? pickupLng : null,
        dropoffLabel,
        Number.isFinite(dropoffLat) ? dropoffLat : null,
        Number.isFinite(dropoffLng) ? dropoffLng : null,
        startAt,
        endAt,
        passengerCount,
        fareEstimate.min,
        fareEstimate.max,
        passengerOfferAmount,
        fareCurrency || fareEstimate.currency,
        notes,
        preferredVehicle ? preferredVehicle.id : null,
      ]
    );

    const [row] = await query(`SELECT * FROM hire_requests WHERE id = ? LIMIT 1`, [result.insertId]);
    const shapedRequest = shapeHireRequest(row);
    notifyDriversAboutHireRequest(
      shapedRequest,
      [passenger.appUser?.first_name, passenger.appUser?.last_name].filter(Boolean).join(' ') || 'Passenger'
    ).catch((notifyError) => {
      console.error('POST /api/hire/requests notify drivers', notifyError);
    });
    return res.status(201).json({ request: shapedRequest });
  } catch (err) {
    console.error('POST /api/hire/requests', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/requests/:id', requireAuth, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request id' });

    const [row] = await query(`SELECT * FROM hire_requests WHERE id = ? LIMIT 1`, [requestId]);
    if (!row) return res.status(404).json({ error: 'Request not found' });

    const isOwner = row.passenger_user_id === req.userId;
    const [roleRow] = await query(
      `SELECT role FROM users WHERE clerk_user_id = ? LIMIT 1`,
      [req.userId]
    );
    const isDriver = normalizeRole(roleRow?.role) === 'driver';

    if (!isOwner && !isDriver) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    const quotes = await query(
      `SELECT hq.*,
              hv.title AS vehicle_title,
              hv.category AS vehicle_category,
              hv.make AS vehicle_make,
              hv.model AS vehicle_model,
              hv.photo_urls AS vehicle_photo_urls,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name
       FROM hire_quotes hq
       INNER JOIN hire_vehicles hv ON hv.id = hq.hire_vehicle_id
       LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY hq.driver_user_id
       WHERE hq.hire_request_id = ?
       ORDER BY hq.created_at ASC`,
      [requestId]
    );

    return res.json({
      request: shapeHireRequest(row),
      quotes: quotes.map(shapeHireQuote),
    });
  } catch (err) {
    console.error('GET /api/hire/requests/:id', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/requests/:id/offer', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const requestId = Number(req.params.id);
    const rawOffer = req.body?.passengerOfferAmount;
    const passengerOfferAmount = rawOffer == null || rawOffer === ''
      ? null
      : Number(rawOffer);
    const fareCurrency = String(req.body?.fareCurrency || 'USD').trim().toUpperCase() || 'USD';

    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request id' });
    if (passengerOfferAmount != null && (!Number.isFinite(passengerOfferAmount) || passengerOfferAmount <= 0)) {
      return res.status(400).json({ error: 'Enter a valid offer amount' });
    }

    const [row] = await query(
      `SELECT * FROM hire_requests WHERE id = ? AND passenger_user_id = ? LIMIT 1`,
      [requestId, req.userId]
    );
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (!['open', 'quoted'].includes(row.status)) {
      return res.status(400).json({ error: 'This request can no longer accept an offer update' });
    }

    await query(
      `UPDATE hire_requests
       SET passenger_offer_amount = ?, fare_currency = ?
       WHERE id = ?`,
      [passengerOfferAmount, fareCurrency, requestId]
    );
    const [updated] = await query(`SELECT * FROM hire_requests WHERE id = ? LIMIT 1`, [requestId]);
    const shaped = shapeHireRequest(updated);
    if (passengerOfferAmount != null) {
      notifyDriversAboutHireRequest(
        shaped,
        [passenger.appUser?.first_name, passenger.appUser?.last_name].filter(Boolean).join(' ') || 'Passenger',
        { eventType: 'offer_updated' }
      ).catch((notifyError) => {
        console.error('PATCH /api/hire/requests/:id/offer notify drivers', notifyError);
      });
    }
    return res.json({ request: shaped });
  } catch (err) {
    console.error('PATCH /api/hire/requests/:id/offer', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/requests/:id/cancel', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const requestId = Number(req.params.id);
    const [row] = await query(
      `SELECT * FROM hire_requests WHERE id = ? AND passenger_user_id = ? LIMIT 1`,
      [requestId, req.userId]
    );
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.status === 'booked') {
      return res.status(400).json({ error: 'Cancel the booking instead' });
    }
    await query(
      `UPDATE hire_requests
       SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [requestId]
    );
    await query(
      `UPDATE hire_quotes
       SET status = 'expired'
       WHERE hire_request_id = ? AND status = 'pending'`,
      [requestId]
    );
    const [updated] = await query(`SELECT * FROM hire_requests WHERE id = ? LIMIT 1`, [requestId]);
    return res.json({ request: shapeHireRequest(updated) });
  } catch (err) {
    console.error('PATCH /api/hire/requests/:id/cancel', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/open-requests', requireAuth, async (req, res) => {
  try {
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const rows = await query(
      `SELECT hr.*,
              (SELECT COUNT(*) FROM hire_quotes hq WHERE hq.hire_request_id = hr.id) AS quote_count
       FROM hire_requests hr
       WHERE hr.status IN ('open', 'quoted')
         AND hr.start_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
       ORDER BY hr.start_at ASC
       LIMIT 100`
    );
    return res.json({ requests: rows.map(shapeHireRequest) });
  } catch (err) {
    console.error('GET /api/hire/open-requests', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/requests/:id/quotes', requireAuth, async (req, res) => {
  try {
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const requestId = Number(req.params.id);
    const hireVehicleId = Number(req.body?.hireVehicleId);
    const amount = Number(req.body?.amount);
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';
    const message = String(req.body?.message || '').trim() || null;

    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request id' });
    if (!Number.isFinite(hireVehicleId)) return res.status(400).json({ error: 'Select a hire vehicle' });
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Enter a valid quote amount' });
    }

    const [request] = await query(`SELECT * FROM hire_requests WHERE id = ? LIMIT 1`, [requestId]);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!['open', 'quoted'].includes(request.status)) {
      return res.status(400).json({ error: 'This request is no longer open for quotes' });
    }

    const [vehicle] = await query(
      `SELECT * FROM hire_vehicles
       WHERE id = ? AND driver_user_id = ? AND vehicle_status = 'approved'
       LIMIT 1`,
      [hireVehicleId, req.userId]
    );
    if (!vehicle) {
      return res.status(400).json({ error: 'Use an approved hire vehicle for quoting' });
    }

    const publicId = createHirePublicId('HQ');
    try {
      await query(
        `INSERT INTO hire_quotes (
           public_id, hire_request_id, driver_user_id, hire_vehicle_id,
           amount, currency, message, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
         ON DUPLICATE KEY UPDATE
           hire_vehicle_id = VALUES(hire_vehicle_id),
           amount = VALUES(amount),
           currency = VALUES(currency),
           message = VALUES(message),
           status = 'pending',
           updated_at = CURRENT_TIMESTAMP`,
        [publicId, requestId, req.userId, hireVehicleId, amount, currency, message]
      );
      await query(
        `UPDATE hire_requests SET status = 'quoted' WHERE id = ? AND status = 'open'`,
        [requestId]
      );
      const [row] = await query(
        `SELECT * FROM hire_quotes WHERE hire_request_id = ? AND driver_user_id = ? LIMIT 1`,
        [requestId, req.userId]
      );
      const shapedQuote = shapeHireQuote(row);
      notifyPassengerAboutHireQuote({
        request,
        quote: row,
        vehicle,
        driverName: [driver.appUser?.first_name, driver.appUser?.last_name].filter(Boolean).join(' ') || 'Driver',
      }).catch((notifyError) => {
        console.error('POST /api/hire/requests/:id/quotes notify passenger', notifyError);
      });
      return res.status(201).json({ quote: shapedQuote });
    } catch (err) {
      throw err;
    }
  } catch (err) {
    console.error('POST /api/hire/requests/:id/quotes', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/requests/:id/accept-passenger-offer', requireAuth, async (req, res) => {
  try {
    const driver = await requireDriver(req, res);
    if (!driver) return;
    const requestId = Number(req.params.id);
    const hireVehicleId = Number(req.body?.hireVehicleId);
    const message = String(req.body?.message || '').trim() || null;

    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request id' });
    if (!Number.isFinite(hireVehicleId)) return res.status(400).json({ error: 'Select a hire vehicle' });

    const bookingResult = await withTransaction(async (connection) => {
      const [requestRows] = await connection.execute(
        `SELECT * FROM hire_requests WHERE id = ? LIMIT 1 FOR UPDATE`,
        [requestId]
      );
      const request = requestRows[0] || null;
      if (!request) {
        const error = new Error('Request not found');
        error.status = 404;
        throw error;
      }
      if (!['open', 'quoted'].includes(request.status)) {
        const error = new Error('This request is no longer open');
        error.status = 400;
        throw error;
      }
      const offerAmount = Number(request.passenger_offer_amount);
      if (!(offerAmount > 0)) {
        const error = new Error('Passenger has not set an offer yet');
        error.status = 400;
        throw error;
      }

      const [vehicleRows] = await connection.execute(
        `SELECT * FROM hire_vehicles
         WHERE id = ? AND driver_user_id = ? AND vehicle_status = 'approved'
         LIMIT 1`,
        [hireVehicleId, req.userId]
      );
      const vehicle = vehicleRows[0] || null;
      if (!vehicle) {
        const error = new Error('Use an approved hire vehicle');
        error.status = 400;
        throw error;
      }

      const currency = String(request.fare_currency || 'USD').trim().toUpperCase() || 'USD';
      const quotePublicId = createHirePublicId('HQ');

      await connection.execute(
        `INSERT INTO hire_quotes (
           public_id, hire_request_id, driver_user_id, hire_vehicle_id,
           amount, currency, message, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted')
         ON DUPLICATE KEY UPDATE
           hire_vehicle_id = VALUES(hire_vehicle_id),
           amount = VALUES(amount),
           currency = VALUES(currency),
           message = VALUES(message),
           status = 'accepted',
           updated_at = CURRENT_TIMESTAMP`,
        [quotePublicId, requestId, req.userId, hireVehicleId, offerAmount, currency, message]
      );

      const [quoteRows] = await connection.execute(
        `SELECT * FROM hire_quotes WHERE hire_request_id = ? AND driver_user_id = ? LIMIT 1`,
        [requestId, req.userId]
      );
      const quote = quoteRows[0];
      if (!quote) {
        const error = new Error('Could not create booking quote');
        error.status = 500;
        throw error;
      }

      await connection.execute(
        `UPDATE hire_quotes
         SET status = 'declined'
         WHERE hire_request_id = ? AND id <> ? AND status = 'pending'`,
        [requestId, quote.id]
      );
      await connection.execute(
        `UPDATE hire_requests SET status = 'booked' WHERE id = ?`,
        [requestId]
      );

      const bookingPublicId = createHirePublicId('HB');
      const [insertResult] = await connection.execute(
        `INSERT INTO hire_bookings (
           public_id, hire_request_id, hire_quote_id, hire_vehicle_id,
           passenger_user_id, driver_user_id, amount, currency, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
        [
          bookingPublicId,
          requestId,
          quote.id,
          hireVehicleId,
          request.passenger_user_id,
          req.userId,
          offerAmount,
          currency,
        ]
      );
      const [bookingRows] = await connection.execute(
        `SELECT * FROM hire_bookings WHERE id = ? LIMIT 1`,
        [insertResult.insertId]
      );
      return { booking: bookingRows[0], request, vehicle, quote };
    });

    const shapedBooking = shapeHireBooking(bookingResult.booking);
    const currency = bookingResult.booking.currency || 'USD';
    const amount = Number(bookingResult.booking.amount || 0).toFixed(2);
    notifyAboutHireBooking({
      request: bookingResult.request,
      booking: bookingResult.booking,
      recipientUserId: bookingResult.request.passenger_user_id,
      title: 'Hire offer accepted',
      body: `A driver accepted your ${currency} ${amount} offer. The job is now booked.`,
    }).catch((notifyError) => {
      console.error('POST accept-passenger-offer notify passenger', notifyError);
    });

    return res.status(201).json({
      booking: shapedBooking,
      request: shapeHireRequest({ ...bookingResult.request, status: 'booked' }),
    });
  } catch (err) {
    console.error('POST /api/hire/requests/:id/accept-passenger-offer', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.patch('/quotes/:id/accept', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const quoteId = Number(req.params.id);
    if (!Number.isFinite(quoteId)) return res.status(400).json({ error: 'Invalid quote id' });

    const bookingResult = await withTransaction(async (connection) => {
      const [quoteRows] = await connection.execute(
        `SELECT hq.*, hr.passenger_user_id, hr.status AS request_status,
                hr.public_id AS request_public_id, hr.title AS request_title,
                hr.pickup_label, hr.dropoff_label
         FROM hire_quotes hq
         INNER JOIN hire_requests hr ON hr.id = hq.hire_request_id
         WHERE hq.id = ?
         LIMIT 1
         FOR UPDATE`,
        [quoteId]
      );
      const quote = quoteRows[0] || null;
      if (!quote) {
        const error = new Error('Quote not found');
        error.status = 404;
        throw error;
      }
      if (quote.passenger_user_id !== req.userId) {
        const error = new Error('Not allowed');
        error.status = 403;
        throw error;
      }
      if (quote.status !== 'pending' || !['open', 'quoted'].includes(quote.request_status)) {
        const error = new Error('Quote is no longer available');
        error.status = 400;
        throw error;
      }

      await connection.execute(
        `UPDATE hire_quotes SET status = 'accepted' WHERE id = ?`,
        [quoteId]
      );
      await connection.execute(
        `UPDATE hire_quotes
         SET status = 'declined'
         WHERE hire_request_id = ? AND id <> ? AND status = 'pending'`,
        [quote.hire_request_id, quoteId]
      );
      await connection.execute(
        `UPDATE hire_requests SET status = 'booked' WHERE id = ?`,
        [quote.hire_request_id]
      );

      const publicId = createHirePublicId('HB');
      const [insertResult] = await connection.execute(
        `INSERT INTO hire_bookings (
           public_id, hire_request_id, hire_quote_id, hire_vehicle_id,
           passenger_user_id, driver_user_id, amount, currency, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
        [
          publicId,
          quote.hire_request_id,
          quote.id,
          quote.hire_vehicle_id,
          req.userId,
          quote.driver_user_id,
          quote.amount,
          quote.currency,
        ]
      );
      const [rows] = await connection.execute(
        `SELECT * FROM hire_bookings WHERE id = ? LIMIT 1`,
        [insertResult.insertId]
      );
      return { booking: rows[0], quote };
    });

    const shapedBooking = shapeHireBooking(bookingResult.booking);
    const currency = bookingResult.booking.currency || 'USD';
    const amount = Number(bookingResult.booking.amount || 0).toFixed(2);
    const jobLabel = bookingResult.quote.request_title || bookingResult.quote.request_public_id || 'hire job';
    notifyAboutHireBooking({
      request: {
        id: bookingResult.quote.hire_request_id,
        public_id: bookingResult.quote.request_public_id,
      },
      booking: bookingResult.booking,
      recipientUserId: bookingResult.quote.driver_user_id,
      title: 'Hire job booked',
      body: `Passenger accepted your ${currency} ${amount} quote for ${jobLabel}. The job is now closed.`,
    }).catch((notifyError) => {
      console.error('PATCH /api/hire/quotes/:id/accept notify driver', notifyError);
    });

    return res.json({
      booking: shapedBooking,
      requestStatus: 'booked',
    });
  } catch (err) {
    console.error('PATCH /api/hire/quotes/:id/accept', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.get('/bookings', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT hb.*,
              hr.public_id AS request_public_id,
              hr.pickup_label,
              hr.dropoff_label,
              hr.start_at,
              hv.title AS vehicle_title,
              hv.category AS vehicle_category,
              hv.photo_urls AS vehicle_photo_urls
       FROM hire_bookings hb
       INNER JOIN hire_requests hr ON hr.id = hb.hire_request_id
       INNER JOIN hire_vehicles hv ON hv.id = hb.hire_vehicle_id
       WHERE hb.passenger_user_id = ? OR hb.driver_user_id = ?
       ORDER BY hb.created_at DESC
       LIMIT 100`,
      [req.userId, req.userId]
    );
    return res.json({ bookings: rows.map(shapeHireBooking) });
  } catch (err) {
    console.error('GET /api/hire/bookings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/bookings/:id/status', requireAuth, async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!['in_progress', 'completed', 'cancelled'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const [booking] = await query(`SELECT * FROM hire_bookings WHERE id = ? LIMIT 1`, [bookingId]);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isDriver = booking.driver_user_id === req.userId;
    const isPassenger = booking.passenger_user_id === req.userId;
    if (!isDriver && !isPassenger) return res.status(403).json({ error: 'Not allowed' });
    if (nextStatus === 'in_progress' && !isDriver) {
      return res.status(403).json({ error: 'Only the driver can start the hire' });
    }
    if (nextStatus === 'completed' && !isDriver) {
      return res.status(403).json({ error: 'Only the driver can complete the hire' });
    }

    const sets = ['status = ?'];
    const params = [nextStatus];
    if (nextStatus === 'in_progress') sets.push('started_at = CURRENT_TIMESTAMP');
    if (nextStatus === 'completed') sets.push('completed_at = CURRENT_TIMESTAMP');
    if (nextStatus === 'cancelled') sets.push('cancelled_at = CURRENT_TIMESTAMP');
    params.push(bookingId);

    await query(`UPDATE hire_bookings SET ${sets.join(', ')} WHERE id = ?`, params);
    const [row] = await query(`SELECT * FROM hire_bookings WHERE id = ? LIMIT 1`, [bookingId]);
    return res.json({ booking: shapeHireBooking(row) });
  } catch (err) {
    console.error('PATCH /api/hire/bookings/:id/status', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
