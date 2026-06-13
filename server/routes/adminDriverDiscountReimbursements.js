import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { generateDriverDiscountReimbursementBatches } from '../lib/ride-discounts.js';

const router = Router();

router.get('/', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT
         dr.id,
         dr.driver_user_id,
         dr.period_start,
         dr.period_end,
         dr.total_discount_reimbursement,
         dr.ride_count,
         dr.status,
         dr.admin_note,
         dr.created_by_admin_id,
         dr.approved_by_admin_id,
         dr.approved_at,
         dr.paid_at,
         dr.created_at,
         dr.updated_at,
         MAX(da.driver_name) AS driver_name,
         MAX(da.phone_number) AS driver_phone_number,
         MAX(da.number_plate) AS driver_number_plate,
         MAX(dv.make) AS driver_vehicle_make,
         MAX(dv.model) AS driver_vehicle_model,
         COALESCE(SUM(red.discount_amount), 0) AS linked_discount_amount
       FROM driver_discount_reimbursements dr
       LEFT JOIN driver_availability da
         ON da.driver_user_id = dr.driver_user_id
       LEFT JOIN driver_vehicle dv
         ON dv.driver_user_id = dr.driver_user_id
       LEFT JOIN driver_discount_reimbursement_items dri
         ON dri.reimbursement_id = dr.id
       LEFT JOIN discount_code_redemptions red
         ON red.id = dri.redemption_id
       GROUP BY dr.id
       ORDER BY dr.period_start DESC, dr.id DESC`
    );

    const [summaryRow] = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('pending', 'approved') THEN total_discount_reimbursement ELSE 0 END), 0) AS outstanding_total,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN total_discount_reimbursement ELSE 0 END), 0) AS paid_total,
         COUNT(*) AS total_batches
       FROM driver_discount_reimbursements`
    );

    return res.json({
      summary: {
        outstandingTotal: Number(summaryRow?.outstanding_total || 0),
        paidTotal: Number(summaryRow?.paid_total || 0),
        totalBatches: Number(summaryRow?.total_batches || 0),
      },
      reimbursements: rows.map((row) => ({
        id: row.id,
        driverUserId: row.driver_user_id,
        driverName: row.driver_name || null,
        driverPhoneNumber: row.driver_phone_number || null,
        driverNumberPlate: row.driver_number_plate || null,
        driverVehicleLabel: [row.driver_vehicle_make, row.driver_vehicle_model].filter(Boolean).join(' ').trim() || null,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        totalDiscountReimbursement: Number(row.total_discount_reimbursement || 0),
        rideCount: Number(row.ride_count || 0),
        status: row.status,
        adminNote: row.admin_note || '',
        createdByAdminId: row.created_by_admin_id || null,
        approvedByAdminId: row.approved_by_admin_id || null,
        approvedAt: row.approved_at || null,
        paidAt: row.paid_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/driver-discount-reimbursements', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/generate', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const batchIds = await generateDriverDiscountReimbursementBatches({ adminId: req.admin?.id || null });
    return res.status(201).json({
      ok: true,
      createdBatchCount: batchIds.length,
      batchIds,
    });
  } catch (err) {
    console.error('POST /api/admin/driver-discount-reimbursements/generate', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:reimbursementId', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const reimbursementId = Number(req.params.reimbursementId);
    const status = String(req.body?.status || '').trim().toLowerCase();
    const adminNote = String(req.body?.adminNote || '').trim();

    if (!Number.isInteger(reimbursementId) || reimbursementId <= 0) {
      return res.status(400).json({ error: 'Invalid reimbursement id' });
    }
    if (!['pending', 'approved', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, approved, or paid' });
    }

    const [existing] = await query(
      `SELECT *
       FROM driver_discount_reimbursements
       WHERE id = ?
       LIMIT 1`,
      [reimbursementId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Reimbursement batch not found' });
    }

    await query(
      `UPDATE driver_discount_reimbursements
       SET status = ?,
           admin_note = ?,
           approved_by_admin_id = CASE WHEN ? = 'approved' THEN ? ELSE approved_by_admin_id END,
           approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,
           paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
      [status, adminNote || null, status, req.admin?.id || null, status, status, reimbursementId]
    );

    if (status === 'approved') {
      await query(
        `UPDATE discount_code_redemptions r
         INNER JOIN driver_discount_reimbursement_items dri
           ON dri.redemption_id = r.id
         SET r.status = 'approved'
         WHERE dri.reimbursement_id = ?
           AND r.status = 'applied'`,
        [reimbursementId]
      );
    }

    if (status === 'paid') {
      await query(
        `UPDATE discount_code_redemptions r
         INNER JOIN driver_discount_reimbursement_items dri
           ON dri.redemption_id = r.id
         SET r.status = 'reimbursed',
             r.reimbursed_at = CURRENT_TIMESTAMP
         WHERE dri.reimbursement_id = ?`,
        [reimbursementId]
      );
    }

    const [row] = await query(
      `SELECT *
       FROM driver_discount_reimbursements
       WHERE id = ?
       LIMIT 1`,
      [reimbursementId]
    );

    return res.json({
      reimbursement: {
        id: row.id,
        driverUserId: row.driver_user_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        totalDiscountReimbursement: Number(row.total_discount_reimbursement || 0),
        rideCount: Number(row.ride_count || 0),
        status: row.status,
        adminNote: row.admin_note || '',
        approvedAt: row.approved_at || null,
        paidAt: row.paid_at || null,
      },
    });
  } catch (err) {
    console.error('PATCH /api/admin/driver-discount-reimbursements/:reimbursementId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
