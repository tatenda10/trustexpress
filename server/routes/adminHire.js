import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { query } from '../db/connection.js';
import {
  shapeHireVehicle,
  shapeHireBooking,
  shapeHireRequest,
  shapeHireQuote,
} from '../lib/hire.js';

const router = Router();

function moneyLabel(amount, currency = 'USD') {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  return `${currency || 'USD'} ${Number(amount).toFixed(2)}`;
}

router.get('/vehicles', requireAdminAuth, requirePermission('verification.read'), async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const params = [];
    let where = '1=1';
    if (['pending', 'approved', 'rejected'].includes(status)) {
      where = 'hv.vehicle_status = ?';
      params.push(status);
    }
    const rows = await query(
      `SELECT hv.*,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name,
              u.phone_number AS driver_phone
       FROM hire_vehicles hv
       LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY hv.driver_user_id
       WHERE ${where}
       ORDER BY hv.submitted_at DESC, hv.created_at DESC
       LIMIT 200`,
      params
    );
    return res.json({
      vehicles: rows.map((row) => ({
        ...shapeHireVehicle(row),
        driverName: row.driver_name || null,
        driverPhone: row.driver_phone || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/hire/vehicles', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/vehicles/:id/review', requireAdminAuth, requirePermission('verification.review'), async (req, res) => {
  try {
    const vehicleId = Number(req.params.id);
    const action = String(req.body?.action || '').trim().toLowerCase();
    const rejectionReason = String(req.body?.rejectionReason || '').trim() || null;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve or reject' });
    }
    if (action === 'reject' && !rejectionReason) {
      return res.status(400).json({ error: 'rejectionReason is required' });
    }

    const [existing] = await query(`SELECT * FROM hire_vehicles WHERE id = ? LIMIT 1`, [vehicleId]);
    if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

    await query(
      `UPDATE hire_vehicles
       SET vehicle_status = ?,
           rejection_reason = ?,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [action === 'approve' ? 'approved' : 'rejected', action === 'reject' ? rejectionReason : null, vehicleId]
    );

    const [row] = await query(`SELECT * FROM hire_vehicles WHERE id = ? LIMIT 1`, [vehicleId]);
    return res.json({ vehicle: shapeHireVehicle(row) });
  } catch (err) {
    console.error('PATCH /api/admin/hire/vehicles/:id/review', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/requests', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();

    const where = ['1=1'];
    const params = [];

    if (['open', 'quoted', 'booked', 'cancelled', 'expired'].includes(status)) {
      where.push('hr.status = ?');
      params.push(status);
    }
    if (search) {
      const like = `%${search}%`;
      where.push(`(
        hr.public_id LIKE ?
        OR hr.title LIKE ?
        OR hr.pickup_label LIKE ?
        OR hr.dropoff_label LIKE ?
        OR hr.notes LIKE ?
        OR TRIM(CONCAT(COALESCE(pu.first_name, ''), ' ', COALESCE(pu.last_name, ''))) LIKE ?
        OR pu.phone_number LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like);
    }
    if (dateFrom) {
      where.push('DATE(hr.created_at) >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push('DATE(hr.created_at) <= ?');
      params.push(dateTo);
    }

    const whereSql = where.join(' AND ');

    const [countRow] = await query(
      `SELECT COUNT(*) AS total
       FROM hire_requests hr
       LEFT JOIN users pu ON BINARY pu.clerk_user_id = BINARY hr.passenger_user_id
       WHERE ${whereSql}`,
      params
    );
    const total = Number(countRow?.total || 0);

    const [summaryRow] = await query(
      `SELECT
         SUM(CASE WHEN hr.status IN ('open', 'quoted') THEN 1 ELSE 0 END) AS open_jobs,
         SUM(CASE WHEN hr.status = 'booked' THEN 1 ELSE 0 END) AS booked,
         SUM(CASE WHEN hr.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(CASE WHEN hr.status = 'expired' THEN 1 ELSE 0 END) AS expired,
         SUM(CASE WHEN hr.passenger_offer_amount IS NOT NULL THEN 1 ELSE 0 END) AS with_offer,
         (SELECT COUNT(*) FROM hire_quotes) AS total_quotes,
         (SELECT COUNT(*) FROM hire_bookings) AS total_bookings
       FROM hire_requests hr
       LEFT JOIN users pu ON BINARY pu.clerk_user_id = BINARY hr.passenger_user_id
       WHERE ${whereSql}`,
      params
    );

    const rows = await query(
      `SELECT hr.*,
              TRIM(CONCAT(COALESCE(pu.first_name, ''), ' ', COALESCE(pu.last_name, ''))) AS passenger_name,
              pu.phone_number AS passenger_phone,
              (SELECT COUNT(*) FROM hire_quotes hq WHERE hq.hire_request_id = hr.id) AS quote_count,
              hb.id AS booking_id,
              hb.public_id AS booking_public_id,
              hb.amount AS booking_amount,
              hb.currency AS booking_currency,
              hb.status AS booking_status,
              hb.driver_user_id AS booking_driver_user_id,
              TRIM(CONCAT(COALESCE(du.first_name, ''), ' ', COALESCE(du.last_name, ''))) AS booking_driver_name
       FROM hire_requests hr
       LEFT JOIN users pu ON BINARY pu.clerk_user_id = BINARY hr.passenger_user_id
       LEFT JOIN hire_bookings hb ON hb.hire_request_id = hr.id
       LEFT JOIN users du ON BINARY du.clerk_user_id = BINARY hb.driver_user_id
       WHERE ${whereSql}
       ORDER BY hr.created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return res.json({
      summary: {
        openJobs: Number(summaryRow?.open_jobs || 0),
        booked: Number(summaryRow?.booked || 0),
        cancelled: Number(summaryRow?.cancelled || 0),
        expired: Number(summaryRow?.expired || 0),
        withOffer: Number(summaryRow?.with_offer || 0),
        totalQuotes: Number(summaryRow?.total_quotes || 0),
        totalBookings: Number(summaryRow?.total_bookings || 0),
      },
      requests: rows.map((row) => {
        const request = shapeHireRequest(row);
        return {
          ...request,
          passengerName: row.passenger_name ? String(row.passenger_name).trim() || null : null,
          passengerPhone: row.passenger_phone || null,
          quoteCount: Number(row.quote_count || 0),
          booking: row.booking_id
            ? {
                id: Number(row.booking_id),
                publicId: row.booking_public_id,
                amount: row.booking_amount == null ? null : Number(row.booking_amount),
                currency: row.booking_currency || 'USD',
                status: row.booking_status,
                driverUserId: row.booking_driver_user_id || null,
                driverName: row.booking_driver_name ? String(row.booking_driver_name).trim() || null : null,
                amountLabel: moneyLabel(row.booking_amount, row.booking_currency),
              }
            : null,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    console.error('GET /api/admin/hire/requests', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/requests/:id', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request id' });

    const [row] = await query(
      `SELECT hr.*,
              TRIM(CONCAT(COALESCE(pu.first_name, ''), ' ', COALESCE(pu.last_name, ''))) AS passenger_name,
              pu.phone_number AS passenger_phone
       FROM hire_requests hr
       LEFT JOIN users pu ON BINARY pu.clerk_user_id = BINARY hr.passenger_user_id
       WHERE hr.id = ?
       LIMIT 1`,
      [requestId]
    );
    if (!row) return res.status(404).json({ error: 'Hire request not found' });

    const quotes = await query(
      `SELECT hq.*,
              hv.title AS vehicle_title,
              hv.category AS vehicle_category,
              hv.make AS vehicle_make,
              hv.model AS vehicle_model,
              hv.photo_urls AS vehicle_photo_urls,
              hv.number_plate AS vehicle_number_plate,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name,
              u.phone_number AS driver_phone
       FROM hire_quotes hq
       INNER JOIN hire_vehicles hv ON hv.id = hq.hire_vehicle_id
       LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY hq.driver_user_id
       WHERE hq.hire_request_id = ?
       ORDER BY hq.created_at ASC`,
      [requestId]
    );

    const [bookingRow] = await query(
      `SELECT hb.*,
              hr.public_id AS request_public_id,
              hr.pickup_label,
              hr.dropoff_label,
              hr.start_at,
              hv.title AS vehicle_title,
              hv.category AS vehicle_category,
              hv.photo_urls AS vehicle_photo_urls,
              TRIM(CONCAT(COALESCE(du.first_name, ''), ' ', COALESCE(du.last_name, ''))) AS driver_name,
              du.phone_number AS driver_phone,
              TRIM(CONCAT(COALESCE(pu.first_name, ''), ' ', COALESCE(pu.last_name, ''))) AS passenger_name,
              pu.phone_number AS passenger_phone
       FROM hire_bookings hb
       INNER JOIN hire_requests hr ON hr.id = hb.hire_request_id
       INNER JOIN hire_vehicles hv ON hv.id = hb.hire_vehicle_id
       LEFT JOIN users du ON BINARY du.clerk_user_id = BINARY hb.driver_user_id
       LEFT JOIN users pu ON BINARY pu.clerk_user_id = BINARY hb.passenger_user_id
       WHERE hb.hire_request_id = ?
       LIMIT 1`,
      [requestId]
    );

    let preferredVehicle = null;
    if (row.preferred_hire_vehicle_id) {
      const [vehicleRow] = await query(
        `SELECT hv.*,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name,
                u.phone_number AS driver_phone
         FROM hire_vehicles hv
         LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY hv.driver_user_id
         WHERE hv.id = ?
         LIMIT 1`,
        [row.preferred_hire_vehicle_id]
      );
      if (vehicleRow) {
        preferredVehicle = {
          ...shapeHireVehicle(vehicleRow),
          driverName: vehicleRow.driver_name || null,
          driverPhone: vehicleRow.driver_phone || null,
        };
      }
    }

    const request = {
      ...shapeHireRequest(row),
      passengerName: row.passenger_name ? String(row.passenger_name).trim() || null : null,
      passengerPhone: row.passenger_phone || null,
    };

    const timeline = [];
    timeline.push({
      type: 'request_created',
      at: request.createdAt,
      label: 'Job posted',
      detail: request.title || request.publicId,
    });
    if (request.passengerOfferAmount != null) {
      timeline.push({
        type: 'passenger_offer',
        at: request.createdAt,
        label: 'Passenger offer',
        detail: moneyLabel(request.passengerOfferAmount, request.fareCurrency),
      });
    }
    quotes.forEach((quoteRow) => {
      const quote = shapeHireQuote(quoteRow);
      timeline.push({
        type: 'driver_quote',
        at: quote.createdAt,
        label: `Driver quote (${quote.status})`,
        detail: `${quote.driverName || 'Driver'} · ${moneyLabel(quote.amount, quote.currency)}${quote.message ? ` · ${quote.message}` : ''}`,
        quoteId: quote.id,
      });
    });
    if (bookingRow) {
      const booking = shapeHireBooking(bookingRow);
      timeline.push({
        type: 'booking',
        at: booking.createdAt,
        label: `Booking ${booking.status}`,
        detail: `${moneyLabel(booking.amount, booking.currency)} · ${bookingRow.driver_name || 'Driver'}`,
      });
      if (booking.startedAt) {
        timeline.push({ type: 'booking_started', at: booking.startedAt, label: 'Booking started', detail: null });
      }
      if (booking.completedAt) {
        timeline.push({ type: 'booking_completed', at: booking.completedAt, label: 'Booking completed', detail: null });
      }
      if (booking.cancelledAt) {
        timeline.push({ type: 'booking_cancelled', at: booking.cancelledAt, label: 'Booking cancelled', detail: null });
      }
    }
    timeline.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());

    return res.json({
      request,
      preferredVehicle,
      quotes: quotes.map((quoteRow) => ({
        ...shapeHireQuote(quoteRow),
        driverPhone: quoteRow.driver_phone || null,
        vehicleNumberPlate: quoteRow.vehicle_number_plate || null,
      })),
      booking: bookingRow
        ? {
            ...shapeHireBooking(bookingRow),
            driverName: bookingRow.driver_name || null,
            driverPhone: bookingRow.driver_phone || null,
            passengerName: bookingRow.passenger_name || null,
            passengerPhone: bookingRow.passenger_phone || null,
          }
        : null,
      timeline,
      transactions: [
        ...(request.passengerOfferAmount != null
          ? [{
              kind: 'passenger_offer',
              label: 'Passenger offer',
              amount: request.passengerOfferAmount,
              currency: request.fareCurrency || 'USD',
              status: request.status,
              party: request.passengerName || 'Passenger',
              at: request.createdAt,
            }]
          : []),
        ...quotes.map((quoteRow) => {
          const quote = shapeHireQuote(quoteRow);
          return {
            kind: 'driver_quote',
            label: 'Driver quote',
            amount: quote.amount,
            currency: quote.currency || 'USD',
            status: quote.status,
            party: quote.driverName || 'Driver',
            message: quote.message || null,
            at: quote.createdAt,
            quoteId: quote.id,
          };
        }),
        ...(bookingRow
          ? [{
              kind: 'booking',
              label: 'Booking',
              amount: Number(bookingRow.amount),
              currency: bookingRow.currency || 'USD',
              status: bookingRow.status,
              party: bookingRow.driver_name || 'Driver',
              at: bookingRow.created_at ? new Date(bookingRow.created_at).toISOString() : null,
              bookingId: bookingRow.id,
            }]
          : []),
      ],
    });
  } catch (err) {
    console.error('GET /api/admin/hire/requests/:id', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/bookings', requireAdminAuth, requirePermission('ride_ops.read'), async (req, res) => {
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
       ORDER BY hb.created_at DESC
       LIMIT 200`
    );
    return res.json({ bookings: rows.map(shapeHireBooking) });
  } catch (err) {
    console.error('GET /api/admin/hire/bookings', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
