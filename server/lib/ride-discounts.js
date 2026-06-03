import { query } from '../db/connection.js';

export const MAX_DISCOUNT_CODE_LENGTH = 64;

function startOfUtcDay(dateValue) {
  const date = new Date(dateValue);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(dateValue, days) {
  const date = startOfUtcDay(dateValue);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function normalizeDiscountCode(code) {
  return String(code || '').trim().toUpperCase().slice(0, MAX_DISCOUNT_CODE_LENGTH);
}

export function calculateDiscountAmount({
  discountType,
  discountValue,
  originalFareAmount,
  maxDiscountAmount = null,
}) {
  const fare = Number(originalFareAmount || 0);
  const value = Number(discountValue || 0);
  if (!(fare > 0) || !(value > 0)) return 0;

  let amount = 0;
  if (String(discountType) === 'percent') {
    amount = (fare * value) / 100;
  } else {
    amount = value;
  }

  if (Number(maxDiscountAmount || 0) > 0) {
    amount = Math.min(amount, Number(maxDiscountAmount));
  }

  amount = Math.min(amount, fare);
  return Number(amount.toFixed(2));
}

export async function validateDiscountForRide({
  passengerUserId,
  discountCode,
  originalFareAmount,
}) {
  const normalizedCode = normalizeDiscountCode(discountCode);
  if (!normalizedCode) return null;

  const [row] = await query(
    `SELECT *
     FROM discount_codes
     WHERE code = ?
     LIMIT 1`,
    [normalizedCode]
  );

  if (!row) {
    const error = new Error('Discount code not found');
    error.status = 404;
    throw error;
  }

  const now = Date.now();
  if (!row.is_active) {
    const error = new Error('This discount code is inactive');
    error.status = 409;
    throw error;
  }
  if (row.starts_at && new Date(row.starts_at).getTime() > now) {
    const error = new Error('This discount code is not active yet');
    error.status = 409;
    throw error;
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < now) {
    const error = new Error('This discount code has expired');
    error.status = 409;
    throw error;
  }

  const fare = Number(originalFareAmount || 0);
  if (Number(row.min_ride_amount || 0) > 0 && fare < Number(row.min_ride_amount)) {
    const error = new Error(`This code requires a minimum fare of $${Number(row.min_ride_amount).toFixed(2)}`);
    error.status = 409;
    throw error;
  }

  const [usageRow] = await query(
    `SELECT
       COUNT(*) AS total_usage,
       SUM(CASE WHEN passenger_user_id = ? THEN 1 ELSE 0 END) AS passenger_usage
     FROM discount_code_redemptions
     WHERE discount_code_id = ?
       AND status <> 'cancelled'`,
    [passengerUserId, row.id]
  );

  const totalUsage = Number(usageRow?.total_usage || 0);
  const passengerUsage = Number(usageRow?.passenger_usage || 0);

  if (Number(row.usage_limit_total || 0) > 0 && totalUsage >= Number(row.usage_limit_total)) {
    const error = new Error('This discount code has reached its usage limit');
    error.status = 409;
    throw error;
  }

  if (!row.allow_multiple_use && passengerUsage > 0) {
    const error = new Error('You have already used this discount code');
    error.status = 409;
    throw error;
  }

  if (Number(row.usage_limit_per_passenger || 0) > 0 && passengerUsage >= Number(row.usage_limit_per_passenger)) {
    const error = new Error('You have reached the usage limit for this discount code');
    error.status = 409;
    throw error;
  }

  const discountAmount = calculateDiscountAmount({
    discountType: row.discount_type,
    discountValue: row.discount_value,
    originalFareAmount: fare,
    maxDiscountAmount: row.max_discount_amount,
  });

  const finalFareAmount = Number(Math.max(0, fare - discountAmount).toFixed(2));

  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    maxDiscountAmount: row.max_discount_amount === null ? null : Number(row.max_discount_amount),
    minRideAmount: row.min_ride_amount === null ? null : Number(row.min_ride_amount),
    allowMultipleUse: !!row.allow_multiple_use,
    usageLimitTotal: row.usage_limit_total === null ? null : Number(row.usage_limit_total),
    usageLimitPerPassenger: row.usage_limit_per_passenger === null ? null : Number(row.usage_limit_per_passenger),
    originalFareAmount: fare,
    discountAmount,
    finalFareAmount,
    driverReimbursementAmount: discountAmount,
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  };
}

export async function syncDiscountRedemptionForRide({
  rideRequestId,
  discount,
  passengerUserId,
  driverUserId = null,
}) {
  if (!discount?.id || !rideRequestId || !passengerUserId) return;
  await query(
    `INSERT INTO discount_code_redemptions (
       discount_code_id,
       ride_request_id,
       passenger_user_id,
       driver_user_id,
       code_snapshot,
       discount_type_snapshot,
       discount_value_snapshot,
       original_fare_amount,
       discount_amount,
       final_fare_amount,
       driver_reimbursement_amount,
       status,
       applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       driver_user_id = VALUES(driver_user_id),
       code_snapshot = VALUES(code_snapshot),
       discount_type_snapshot = VALUES(discount_type_snapshot),
       discount_value_snapshot = VALUES(discount_value_snapshot),
       original_fare_amount = VALUES(original_fare_amount),
       discount_amount = VALUES(discount_amount),
       final_fare_amount = VALUES(final_fare_amount),
       driver_reimbursement_amount = VALUES(driver_reimbursement_amount),
       status = CASE
         WHEN status = 'reimbursed' THEN status
         ELSE 'applied'
       END,
       reimbursed_at = CASE
         WHEN status = 'reimbursed' THEN reimbursed_at
         ELSE NULL
       END`,
    [
      discount.id,
      rideRequestId,
      passengerUserId,
      driverUserId,
      discount.code,
      discount.discountType,
      Number(discount.discountValue || 0),
      Number(discount.originalFareAmount || 0),
      Number(discount.discountAmount || 0),
      Number(discount.finalFareAmount || 0),
      Number(discount.driverReimbursementAmount || 0),
    ]
  );
}

export async function generateDriverDiscountReimbursementBatches({ adminId = null }) {
  const redemptionRows = await query(
    `SELECT
       r.id,
       r.driver_user_id,
       COALESCE(rr.completed_at, r.applied_at) AS effective_at,
       r.driver_reimbursement_amount
     FROM discount_code_redemptions r
     INNER JOIN ride_requests rr ON rr.id = r.ride_request_id
     LEFT JOIN driver_discount_reimbursement_items di ON di.redemption_id = r.id
     WHERE r.status = 'applied'
       AND r.driver_user_id IS NOT NULL
       AND r.driver_reimbursement_amount > 0
       AND di.id IS NULL
     ORDER BY r.driver_user_id ASC, COALESCE(rr.completed_at, r.applied_at) ASC, r.id ASC`
  );

  const grouped = new Map();
  for (const row of redemptionRows) {
    const effectiveAt = row.effective_at ? new Date(row.effective_at) : new Date();
    const periodStart = startOfUtcDay(effectiveAt);
    const day = periodStart.getUTCDay();
    const mondayOffset = day === 0 ? -6 : (1 - day);
    periodStart.setUTCDate(periodStart.getUTCDate() + mondayOffset);
    const periodEnd = addUtcDays(periodStart, 6);
    const key = `${row.driver_user_id}__${periodStart.toISOString().slice(0, 10)}__${periodEnd.toISOString().slice(0, 10)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        driverUserId: row.driver_user_id,
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        totalAmount: 0,
        rideCount: 0,
        redemptionIds: [],
      });
    }
    const group = grouped.get(key);
    group.totalAmount += Number(row.driver_reimbursement_amount || 0);
    group.rideCount += 1;
    group.redemptionIds.push(row.id);
  }

  const createdBatchIds = [];
  for (const group of grouped.values()) {
    const result = await query(
      `INSERT INTO driver_discount_reimbursements (
         driver_user_id,
         period_start,
         period_end,
         total_discount_reimbursement,
         ride_count,
         status,
         created_by_admin_id
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
       ON DUPLICATE KEY UPDATE
         total_discount_reimbursement = VALUES(total_discount_reimbursement),
         ride_count = VALUES(ride_count)`,
      [
        group.driverUserId,
        group.periodStart,
        group.periodEnd,
        Number(group.totalAmount.toFixed(2)),
        group.rideCount,
        adminId,
      ]
    );

    const reimbursementId = Number(result.insertId || 0);
    let effectiveReimbursementId = reimbursementId;
    if (!effectiveReimbursementId) {
      const [existing] = await query(
        `SELECT id
         FROM driver_discount_reimbursements
         WHERE driver_user_id = ? AND period_start = ? AND period_end = ?
         LIMIT 1`,
        [group.driverUserId, group.periodStart, group.periodEnd]
      );
      effectiveReimbursementId = Number(existing?.id || 0);
    }
    if (!effectiveReimbursementId) continue;
    createdBatchIds.push(effectiveReimbursementId);

    for (const redemptionId of group.redemptionIds) {
      await query(
        `INSERT IGNORE INTO driver_discount_reimbursement_items (
           reimbursement_id,
           redemption_id
         ) VALUES (?, ?)`,
        [effectiveReimbursementId, redemptionId]
      );
    }
  }

  return createdBatchIds;
}
