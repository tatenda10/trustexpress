import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, withTransaction } from '../db/connection.js';
import { getClerkUserById, toAppUser, normalizeRole } from '../lib/clerk-user.js';
import { upsertClerkUserToMysql } from '../lib/user-sync.js';
import {
  createHirePublicId,
  shapeHireBooking,
  shapeHireQuote,
  shapeHireRequest,
  shapeHireVehicle,
} from '../lib/hire.js';
import { normalizeUploadPath } from '../lib/driver-verification-mysql.js';

const router = Router();

async function requireDriver(req, res) {
  const user = await getClerkUserById(req.userId);
  await upsertClerkUserToMysql(user);
  const appUser = toAppUser(user);
  if (normalizeRole(appUser.role) !== 'driver') {
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
    const category = String(req.body?.category || '').trim().toLowerCase() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const startAtRaw = String(req.body?.startAt || '').trim();
    const endAtRaw = String(req.body?.endAt || '').trim();
    const passengerCount = Number(req.body?.passengerCount || 1);
    const pickupLat = req.body?.pickupLat == null ? null : Number(req.body.pickupLat);
    const pickupLng = req.body?.pickupLng == null ? null : Number(req.body.pickupLng);
    const dropoffLat = req.body?.dropoffLat == null ? null : Number(req.body.dropoffLat);
    const dropoffLng = req.body?.dropoffLng == null ? null : Number(req.body.dropoffLng);

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

    const publicId = createHirePublicId('TH');
    const result = await query(
      `INSERT INTO hire_requests (
         public_id, passenger_user_id, category, pickup_label, pickup_lat, pickup_lng,
         dropoff_label, dropoff_lat, dropoff_lng, start_at, end_at, passenger_count, notes, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        publicId,
        req.userId,
        category,
        pickupLabel,
        Number.isFinite(pickupLat) ? pickupLat : null,
        Number.isFinite(pickupLng) ? pickupLng : null,
        dropoffLabel,
        Number.isFinite(dropoffLat) ? dropoffLat : null,
        Number.isFinite(dropoffLng) ? dropoffLng : null,
        startAt,
        endAt,
        passengerCount,
        notes,
      ]
    );

    const [row] = await query(`SELECT * FROM hire_requests WHERE id = ? LIMIT 1`, [result.insertId]);
    return res.status(201).json({ request: shapeHireRequest(row) });
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
       LEFT JOIN users u ON u.clerk_user_id = hq.driver_user_id
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
      const result = await query(
        `INSERT INTO hire_quotes (
           public_id, hire_request_id, driver_user_id, hire_vehicle_id,
           amount, currency, message, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [publicId, requestId, req.userId, hireVehicleId, amount, currency, message]
      );
      await query(
        `UPDATE hire_requests SET status = 'quoted' WHERE id = ? AND status = 'open'`,
        [requestId]
      );
      const [row] = await query(`SELECT * FROM hire_quotes WHERE id = ? LIMIT 1`, [result.insertId]);
      return res.status(201).json({ quote: shapeHireQuote(row) });
    } catch (err) {
      if (String(err?.code || '') === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'You already quoted this request' });
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /api/hire/requests/:id/quotes', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/quotes/:id/accept', requireAuth, async (req, res) => {
  try {
    const passenger = await requirePassenger(req, res);
    if (!passenger) return;
    const quoteId = Number(req.params.id);
    if (!Number.isFinite(quoteId)) return res.status(400).json({ error: 'Invalid quote id' });

    const booking = await withTransaction(async (connection) => {
      const [quoteRows] = await connection.execute(
        `SELECT hq.*, hr.passenger_user_id, hr.status AS request_status
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
      return rows[0];
    });

    return res.json({ booking: shapeHireBooking(booking) });
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
