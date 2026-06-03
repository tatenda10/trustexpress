import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { MAX_DISCOUNT_CODE_LENGTH, normalizeDiscountCode } from '../lib/ride-discounts.js';

const router = Router();

function mapDiscountCode(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    maxDiscountAmount: row.max_discount_amount === null ? null : Number(row.max_discount_amount),
    minRideAmount: row.min_ride_amount === null ? null : Number(row.min_ride_amount),
    usageLimitTotal: row.usage_limit_total === null ? null : Number(row.usage_limit_total),
    usageLimitPerPassenger: row.usage_limit_per_passenger === null ? null : Number(row.usage_limit_per_passenger),
    allowMultipleUse: !!row.allow_multiple_use,
    isActive: !!row.is_active,
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null,
    usageCount: Number(row.usage_count || 0),
    totalDiscountIssued: Number(row.total_discount_issued || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : NaN;
}

router.get('/', requireAdminAuth, requirePermission('pricing.read'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT
         dc.*,
         COALESCE(COUNT(r.id), 0) AS usage_count,
         COALESCE(SUM(r.discount_amount), 0) AS total_discount_issued
       FROM discount_codes dc
       LEFT JOIN discount_code_redemptions r
         ON r.discount_code_id = dc.id
        AND r.status <> 'cancelled'
       GROUP BY dc.id
       ORDER BY dc.created_at DESC, dc.id DESC`
    );

    return res.json({ discountCodes: rows.map(mapDiscountCode) });
  } catch (err) {
    console.error('GET /api/admin/discount-codes', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const code = normalizeDiscountCode(req.body?.code);
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const discountType = String(req.body?.discountType || 'fixed').trim().toLowerCase();
    const discountValue = Number(req.body?.discountValue || 0);
    const maxDiscountAmount = normalizeNullableNumber(req.body?.maxDiscountAmount);
    const minRideAmount = normalizeNullableNumber(req.body?.minRideAmount);
    const usageLimitTotal = normalizeNullableNumber(req.body?.usageLimitTotal);
    const usageLimitPerPassenger = normalizeNullableNumber(req.body?.usageLimitPerPassenger);
    const allowMultipleUse = req.body?.allowMultipleUse !== false;
    const isActive = req.body?.isActive !== false;
    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : null;
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;

    if (!code || code.length > MAX_DISCOUNT_CODE_LENGTH) {
      return res.status(400).json({ error: 'A valid discount code is required' });
    }
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (discountType !== 'fixed' && discountType !== 'percent') {
      return res.status(400).json({ error: 'Discount type must be fixed or percent' });
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return res.status(400).json({ error: 'Discount value must be greater than zero' });
    }
    if (discountType === 'percent' && discountValue > 100) {
      return res.status(400).json({ error: 'Percent discount must be 100 or less' });
    }
    if (Number.isNaN(maxDiscountAmount) || Number.isNaN(minRideAmount) || Number.isNaN(usageLimitTotal) || Number.isNaN(usageLimitPerPassenger)) {
      return res.status(400).json({ error: 'One or more numeric discount fields are invalid' });
    }

    const result = await query(
      `INSERT INTO discount_codes (
         code,
         title,
         description,
         discount_type,
         discount_value,
         max_discount_amount,
         min_ride_amount,
         usage_limit_total,
         usage_limit_per_passenger,
         allow_multiple_use,
         starts_at,
         expires_at,
         is_active,
         created_by_admin_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        title,
        description || null,
        discountType,
        Number(discountValue.toFixed(2)),
        maxDiscountAmount === null ? null : Number(maxDiscountAmount.toFixed(2)),
        minRideAmount === null ? null : Number(minRideAmount.toFixed(2)),
        usageLimitTotal === null ? null : Math.max(1, Math.floor(usageLimitTotal)),
        usageLimitPerPassenger === null ? null : Math.max(1, Math.floor(usageLimitPerPassenger)),
        allowMultipleUse ? 1 : 0,
        startsAt && Number.isFinite(startsAt.getTime()) ? startsAt : null,
        expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
        isActive ? 1 : 0,
        req.admin?.id || null,
      ]
    );

    const [row] = await query(
      `SELECT dc.*, 0 AS usage_count, 0 AS total_discount_issued
       FROM discount_codes dc
       WHERE dc.id = ?
       LIMIT 1`,
      [result.insertId]
    );
    return res.status(201).json({ discountCode: mapDiscountCode(row) });
  } catch (err) {
    if (String(err?.code || '') === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This discount code already exists' });
    }
    console.error('POST /api/admin/discount-codes', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:discountCodeId', requireAdminAuth, requirePermission('pricing.manage'), async (req, res) => {
  try {
    const discountCodeId = Number(req.params.discountCodeId);
    if (!Number.isInteger(discountCodeId) || discountCodeId <= 0) {
      return res.status(400).json({ error: 'Invalid discount code id' });
    }

    const updates = [];
    const params = [];
    const pushUpdate = (column, value) => {
      updates.push(`${column} = ?`);
      params.push(value);
    };

    if (req.body?.code !== undefined) pushUpdate('code', normalizeDiscountCode(req.body.code));
    if (req.body?.title !== undefined) pushUpdate('title', String(req.body.title || '').trim());
    if (req.body?.description !== undefined) pushUpdate('description', String(req.body.description || '').trim() || null);
    if (req.body?.discountType !== undefined) pushUpdate('discount_type', String(req.body.discountType || '').trim().toLowerCase());
    if (req.body?.discountValue !== undefined) pushUpdate('discount_value', Number(Number(req.body.discountValue || 0).toFixed(2)));
    if (req.body?.maxDiscountAmount !== undefined) {
      const value = normalizeNullableNumber(req.body.maxDiscountAmount);
      if (Number.isNaN(value)) return res.status(400).json({ error: 'Invalid max discount amount' });
      pushUpdate('max_discount_amount', value === null ? null : Number(value.toFixed(2)));
    }
    if (req.body?.minRideAmount !== undefined) {
      const value = normalizeNullableNumber(req.body.minRideAmount);
      if (Number.isNaN(value)) return res.status(400).json({ error: 'Invalid minimum ride amount' });
      pushUpdate('min_ride_amount', value === null ? null : Number(value.toFixed(2)));
    }
    if (req.body?.usageLimitTotal !== undefined) {
      const value = normalizeNullableNumber(req.body.usageLimitTotal);
      if (Number.isNaN(value)) return res.status(400).json({ error: 'Invalid total usage limit' });
      pushUpdate('usage_limit_total', value === null ? null : Math.max(1, Math.floor(value)));
    }
    if (req.body?.usageLimitPerPassenger !== undefined) {
      const value = normalizeNullableNumber(req.body.usageLimitPerPassenger);
      if (Number.isNaN(value)) return res.status(400).json({ error: 'Invalid passenger usage limit' });
      pushUpdate('usage_limit_per_passenger', value === null ? null : Math.max(1, Math.floor(value)));
    }
    if (req.body?.allowMultipleUse !== undefined) pushUpdate('allow_multiple_use', req.body.allowMultipleUse ? 1 : 0);
    if (req.body?.isActive !== undefined) pushUpdate('is_active', req.body.isActive ? 1 : 0);
    if (req.body?.startsAt !== undefined) pushUpdate('starts_at', req.body.startsAt ? new Date(req.body.startsAt) : null);
    if (req.body?.expiresAt !== undefined) pushUpdate('expires_at', req.body.expiresAt ? new Date(req.body.expiresAt) : null);

    if (!updates.length) {
      return res.status(400).json({ error: 'No updates were provided' });
    }

    params.push(discountCodeId);
    await query(
      `UPDATE discount_codes
       SET ${updates.join(', ')}
       WHERE id = ?`,
      params
    );

    const [row] = await query(
      `SELECT
         dc.*,
         COALESCE(COUNT(r.id), 0) AS usage_count,
         COALESCE(SUM(r.discount_amount), 0) AS total_discount_issued
       FROM discount_codes dc
       LEFT JOIN discount_code_redemptions r
         ON r.discount_code_id = dc.id
        AND r.status <> 'cancelled'
       WHERE dc.id = ?
       GROUP BY dc.id
       LIMIT 1`,
      [discountCodeId]
    );
    if (!row) {
      return res.status(404).json({ error: 'Discount code not found' });
    }

    return res.json({ discountCode: mapDiscountCode(row) });
  } catch (err) {
    console.error('PATCH /api/admin/discount-codes/:discountCodeId', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
