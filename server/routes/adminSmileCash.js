import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { query } from '../db/connection.js';
import {
  createSmileCashPayoutPublicId,
  executeSmileCashExternalCashout,
  normalizeZimMobile,
} from '../lib/smile-cash.js';
import { processMondayOnlinePayouts } from '../lib/monday-online-payouts.js';

const router = Router();

function shapePayout(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicId: row.public_id,
    driverUserId: row.driver_user_id,
    amount: Number(row.amount),
    currency: row.currency,
    receiverMobile: row.receiver_mobile,
    narration: row.narration,
    purpose: row.purpose,
    status: row.status,
    authTransactionId: row.auth_transaction_id,
    paymentTransactionId: row.payment_transaction_id,
    errorMessage: row.error_message,
    createdByAdminId: row.created_by_admin_id,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    driverName: row.driver_name || null,
    driverEmail: row.driver_email || null,
    driverPhone: row.driver_phone || null,
  };
}

function shapePayoutDriver(row) {
  if (!row) return null;
  return {
    driverUserId: row.clerk_user_id,
    email: row.email ? String(row.email).trim().toLowerCase() : null,
    name: row.driver_name || null,
    phone: row.phone_number || null,
    smileCashMobile: row.smile_cash_mobile || null,
    smileCashStatus: row.smile_cash_status || null,
    nationalIdNumber: row.national_id_number || null,
  };
}

async function findPayoutDriverByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) return null;
  const [row] = await query(
    `SELECT u.clerk_user_id,
            u.email,
            u.phone_number,
            TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name,
            di.smile_cash_mobile,
            di.smile_cash_status,
            di.national_id_number
     FROM users u
     LEFT JOIN driver_identity di ON BINARY di.driver_user_id = BINARY u.clerk_user_id
     WHERE LOWER(u.email) = ? AND u.role = 'driver'
     LIMIT 1`,
    [normalizedEmail]
  );
  return row || null;
}

router.get('/drivers/lookup', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const email = String(req.query?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid driver email is required' });
    }
    const driver = await findPayoutDriverByEmail(email);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found for that email' });
    }
    return res.json({ driver: shapePayoutDriver(driver) });
  } catch (err) {
    console.error('GET /api/admin/smile-cash/drivers/lookup', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/payouts', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT sp.*,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name,
              u.email AS driver_email,
              u.phone_number AS driver_phone
       FROM smile_cash_payouts sp
       LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY sp.driver_user_id
       ORDER BY sp.created_at DESC
       LIMIT 200`
    );
    return res.json({ payouts: rows.map(shapePayout) });
  } catch (err) {
    console.error('GET /api/admin/smile-cash/payouts', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/payouts', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const driverEmail = String(req.body?.driverEmail || '').trim().toLowerCase();
    let driverUserId = String(req.body?.driverUserId || '').trim();
    const amount = Number(req.body?.amount);
    const currency = String(req.body?.currency || 'USD').trim().toUpperCase() || 'USD';
    const narration = String(req.body?.narration || 'Trust Express payout').trim();
    const purpose = String(req.body?.purpose || 'manual').trim() || 'manual';

    if (!driverEmail && !driverUserId) {
      return res.status(400).json({ error: 'driverEmail is required' });
    }
    if (!(amount > 0)) return res.status(400).json({ error: 'amount must be greater than zero' });

    let driverRow = null;
    if (driverEmail) {
      driverRow = await findPayoutDriverByEmail(driverEmail);
      if (!driverRow) {
        return res.status(404).json({ error: 'Driver not found for that email' });
      }
      if (driverUserId && driverUserId !== driverRow.clerk_user_id) {
        return res.status(400).json({ error: 'Driver email does not match the supplied driver user id' });
      }
      driverUserId = driverRow.clerk_user_id;
    }

    const [identity] = await query(
      `SELECT smile_cash_mobile, smile_cash_status, national_id_number
       FROM driver_identity
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );
    const receiverMobile = normalizeZimMobile(
      req.body?.receiverMobile || identity?.smile_cash_mobile || ''
    );
    if (!receiverMobile) {
      return res.status(400).json({ error: 'Driver has no Smile Cash mobile on file' });
    }
    if (identity?.smile_cash_status && identity.smile_cash_status !== 'active') {
      return res.status(400).json({
        error: `Driver Smile Cash status is ${identity.smile_cash_status}`,
      });
    }

    const publicId = createSmileCashPayoutPublicId();
    const insert = await query(
      `INSERT INTO smile_cash_payouts (
         public_id, driver_user_id, amount, currency, receiver_mobile,
         narration, purpose, status, created_by_admin_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        publicId,
        driverUserId,
        amount,
        currency,
        receiverMobile,
        narration,
        purpose,
        req.admin?.id || null,
      ]
    );

    try {
      const result = await executeSmileCashExternalCashout({
        receiverMobile,
        amount,
        currency,
        narration,
      });

      await query(
        `UPDATE smile_cash_payouts
         SET status = 'success',
             auth_transaction_id = ?,
             payment_transaction_id = ?,
             provider_payload = ?,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          result.authTransactionId,
          result.paymentTransactionId,
          JSON.stringify({
            auth: result.authPayload,
            payment: result.paymentPayload,
          }),
          insert.insertId,
        ]
      );
    } catch (err) {
      await query(
        `UPDATE smile_cash_payouts
         SET status = 'failed',
             error_message = ?,
             provider_payload = ?
         WHERE id = ?`,
        [
          err.message || 'Payout failed',
          JSON.stringify(err.providerPayload || {}),
          insert.insertId,
        ]
      );
      return res.status(502).json({
        error: err.message || 'Smile Cash payout failed',
        publicId,
      });
    }

    const [row] = await query(
      `SELECT sp.*,
              TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS driver_name,
              u.email AS driver_email,
              u.phone_number AS driver_phone
       FROM smile_cash_payouts sp
       LEFT JOIN users u ON BINARY u.clerk_user_id = BINARY sp.driver_user_id
       WHERE sp.id = ?
       LIMIT 1`,
      [insert.insertId]
    );
    return res.status(201).json({ payout: shapePayout(row) });
  } catch (err) {
    console.error('POST /api/admin/smile-cash/payouts', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.get('/online-payouts/preview', requireAdminAuth, requirePermission('payouts.read'), async (req, res) => {
  try {
    const result = await processMondayOnlinePayouts({ apply: false, requireMonday: false });
    return res.json(result);
  } catch (err) {
    console.error('GET /api/admin/smile-cash/online-payouts/preview', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

router.post('/online-payouts/authorize', requireAdminAuth, requirePermission('payouts.manage'), async (req, res) => {
  try {
    const confirmation = String(req.body?.confirmation || '').trim().toUpperCase();
    if (confirmation !== 'AUTHORIZE') {
      return res.status(400).json({ error: 'Type AUTHORIZE to approve Monday online payouts' });
    }
    const force = req.body?.force === true;
    const result = await processMondayOnlinePayouts({
      apply: true,
      requireMonday: !force,
      narration: `Trust Express Monday auto payout approved by admin ${req.admin?.id || ''}`.trim(),
    });
    return res.status(result.ok ? 200 : 207).json(result);
  } catch (err) {
    console.error('POST /api/admin/smile-cash/online-payouts/authorize', err);
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

export default router;
