import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { query } from '../db/connection.js';
import { shapeHireVehicle, shapeHireBooking } from '../lib/hire.js';

const router = Router();

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
       LEFT JOIN users u ON u.clerk_user_id = hv.driver_user_id
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
