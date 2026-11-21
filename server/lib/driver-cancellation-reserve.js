import { query, withTransaction } from '../db/connection.js';
import { getDriverWalletSettings } from './driver-wallet-settings.js';

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function mapReserve(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    rideRequestId: Number(row.ride_request_id),
    ridePublicId: row.ride_public_id || null,
    driverUserId: row.driver_user_id,
    passengerUserId: row.passenger_user_id || null,
    fareAmount: normalizeMoney(row.fare_amount),
    commissionRatePercent: Number(row.commission_rate_percent || 0),
    reservedAmount: normalizeMoney(row.reserved_amount),
    cashReservedAmount: normalizeMoney(row.cash_reserved_amount),
    promotionalReservedAmount: normalizeMoney(row.promotional_reserved_amount),
    currency: row.currency || 'USD',
    cancellationReason: row.cancellation_reason || null,
    rideStatusBeforeCancel: row.ride_status_before_cancel || null,
    status: row.status,
    reviewedByAdminId: row.reviewed_by_admin_id === null ? null : Number(row.reviewed_by_admin_id),
    reviewedByAdminName: row.reviewed_by_admin_name || null,
    reviewNote: row.review_note || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at || null,
  };
}

async function lockDriverWallet(connection, driverUserId) {
  await connection.execute(
    `INSERT INTO driver_wallets (driver_user_id, available_balance)
     VALUES (?, 0.00)
     ON DUPLICATE KEY UPDATE driver_user_id = VALUES(driver_user_id)`,
    [driverUserId]
  );
  const [rows] = await connection.execute(
    `SELECT driver_user_id, available_balance, promotional_balance
     FROM driver_wallets
     WHERE driver_user_id = ?
     FOR UPDATE`,
    [driverUserId]
  );
  return rows[0];
}

export async function holdDriverCancellationCommission(connection, {
  rideRequestId,
  ridePublicId = null,
  driverUserId,
  passengerUserId = null,
  passengerName = null,
  fareAmount,
  currency = 'USD',
  cancellationReason = null,
  previousStatus = null,
}) {
  const [existingRows] = await connection.execute(
    `SELECT * FROM driver_cancellation_commission_reserves
     WHERE ride_request_id = ? LIMIT 1`,
    [rideRequestId]
  );
  if (existingRows[0]) return mapReserve(existingRows[0]);

  const settings = await getDriverWalletSettings();
  const commissionRatePercent = Number(settings.commissionRatePercent || 9.5);
  const normalizedFare = normalizeMoney(fareAmount);
  const reservedAmount = normalizeMoney(normalizedFare * (commissionRatePercent / 100));
  if (!(reservedAmount > 0)) return null;

  const wallet = await lockDriverWallet(connection, driverUserId);
  const cashBefore = normalizeMoney(wallet?.available_balance);
  const promoBefore = normalizeMoney(wallet?.promotional_balance);
  const promotionalReservedAmount = normalizeMoney(Math.min(promoBefore, reservedAmount));
  const cashReservedAmount = normalizeMoney(reservedAmount - promotionalReservedAmount);
  const cashAfter = normalizeMoney(cashBefore - cashReservedAmount);
  const promoAfter = normalizeMoney(promoBefore - promotionalReservedAmount);

  await connection.execute(
    `UPDATE driver_wallets
     SET available_balance = ?, promotional_balance = ?, updated_at = CURRENT_TIMESTAMP
     WHERE driver_user_id = ?`,
    [cashAfter, promoAfter, driverUserId]
  );

  let cashHoldTransactionId = null;
  let promotionalHoldTransactionId = null;
  if (promotionalReservedAmount > 0) {
    const [result] = await connection.execute(
      `INSERT INTO driver_wallet_transactions (
         driver_user_id, transaction_type, amount, currency, source_type, source_id,
         trip_id, passenger_user_id, passenger_name, trip_fare_amount,
         commission_rate_percent, balance_before, balance_after, description
       ) VALUES (?, 'promo_cancellation_reserve_hold', ?, ?, 'driver_cancellation_reserve', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        driverUserId, -promotionalReservedAmount, currency, `${rideRequestId}:hold:promo`,
        rideRequestId, passengerUserId, passengerName, normalizedFare, commissionRatePercent,
        promoBefore, promoAfter,
        `Commission held for admin review after driver cancellation of trip #${rideRequestId}`,
      ]
    );
    promotionalHoldTransactionId = result.insertId;
  }

  if (cashReservedAmount > 0) {
    const [result] = await connection.execute(
      `INSERT INTO driver_wallet_transactions (
         driver_user_id, transaction_type, amount, currency, source_type, source_id,
         trip_id, passenger_user_id, passenger_name, trip_fare_amount,
         commission_rate_percent, balance_before, balance_after, description
       ) VALUES (?, 'cancellation_reserve_hold', ?, ?, 'driver_cancellation_reserve', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        driverUserId, -cashReservedAmount, currency, `${rideRequestId}:hold:cash`,
        rideRequestId, passengerUserId, passengerName, normalizedFare, commissionRatePercent,
        cashBefore, cashAfter,
        `Commission held for admin review after driver cancellation of trip #${rideRequestId}`,
      ]
    );
    cashHoldTransactionId = result.insertId;
  }

  const [insertResult] = await connection.execute(
    `INSERT INTO driver_cancellation_commission_reserves (
       ride_request_id, ride_public_id, driver_user_id, passenger_user_id,
       fare_amount, commission_rate_percent, reserved_amount, cash_reserved_amount,
       promotional_reserved_amount, currency, cancellation_reason,
       ride_status_before_cancel, cash_hold_transaction_id, promotional_hold_transaction_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rideRequestId, ridePublicId, driverUserId, passengerUserId, normalizedFare,
      commissionRatePercent, reservedAmount, cashReservedAmount, promotionalReservedAmount,
      currency, cancellationReason, previousStatus, cashHoldTransactionId,
      promotionalHoldTransactionId,
    ]
  );
  const [createdRows] = await connection.execute(
    'SELECT * FROM driver_cancellation_commission_reserves WHERE id = ? LIMIT 1',
    [insertResult.insertId]
  );
  return mapReserve(createdRows[0]);
}

export async function getDriverCancellationReserveByRide(rideRequestId) {
  const rows = await query(
    `SELECT * FROM driver_cancellation_commission_reserves
     WHERE ride_request_id = ? LIMIT 1`,
    [rideRequestId]
  );
  return mapReserve(rows[0]);
}

export async function reviewDriverCancellationReserve({
  rideRequestId,
  action,
  adminId,
  adminName,
  note = null,
}) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!['refund', 'capture'].includes(normalizedAction)) {
    const error = new Error('Action must be refund or capture.');
    error.status = 400;
    throw error;
  }

  return withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT * FROM driver_cancellation_commission_reserves
       WHERE ride_request_id = ? FOR UPDATE`,
      [rideRequestId]
    );
    const reserve = rows[0];
    if (!reserve) {
      const error = new Error('No cancellation commission reserve exists for this ride.');
      error.status = 404;
      throw error;
    }
    if (reserve.status !== 'pending') {
      const error = new Error(`This reserve was already ${reserve.status}.`);
      error.status = 409;
      throw error;
    }

    let cashRefundTransactionId = null;
    let promotionalRefundTransactionId = null;
    if (normalizedAction === 'refund') {
      const wallet = await lockDriverWallet(connection, reserve.driver_user_id);
      const cashBefore = normalizeMoney(wallet?.available_balance);
      const promoBefore = normalizeMoney(wallet?.promotional_balance);
      const cashRefund = normalizeMoney(reserve.cash_reserved_amount);
      const promoRefund = normalizeMoney(reserve.promotional_reserved_amount);
      const cashAfter = normalizeMoney(cashBefore + cashRefund);
      const promoAfter = normalizeMoney(promoBefore + promoRefund);

      await connection.execute(
        `UPDATE driver_wallets SET available_balance = ?, promotional_balance = ?,
           updated_at = CURRENT_TIMESTAMP WHERE driver_user_id = ?`,
        [cashAfter, promoAfter, reserve.driver_user_id]
      );

      if (cashRefund > 0) {
        const [result] = await connection.execute(
          `INSERT INTO driver_wallet_transactions (
             driver_user_id, transaction_type, amount, currency, source_type, source_id,
             trip_id, passenger_user_id, trip_fare_amount, commission_rate_percent,
             balance_before, balance_after, description
           ) VALUES (?, 'cancellation_reserve_refund', ?, ?, 'driver_cancellation_reserve_refund', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reserve.driver_user_id, cashRefund, reserve.currency, `${rideRequestId}:refund:cash`,
            rideRequestId, reserve.passenger_user_id, reserve.fare_amount,
            reserve.commission_rate_percent, cashBefore, cashAfter,
            `Commission reserve refunded after admin approved cancellation for trip #${rideRequestId}`,
          ]
        );
        cashRefundTransactionId = result.insertId;
      }
      if (promoRefund > 0) {
        const [result] = await connection.execute(
          `INSERT INTO driver_wallet_transactions (
             driver_user_id, transaction_type, amount, currency, source_type, source_id,
             trip_id, passenger_user_id, trip_fare_amount, commission_rate_percent,
             balance_before, balance_after, description
           ) VALUES (?, 'promo_cancellation_reserve_refund', ?, ?, 'driver_cancellation_reserve_refund', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reserve.driver_user_id, promoRefund, reserve.currency, `${rideRequestId}:refund:promo`,
            rideRequestId, reserve.passenger_user_id, reserve.fare_amount,
            reserve.commission_rate_percent, promoBefore, promoAfter,
            `Promotional commission reserve refunded after admin approved cancellation for trip #${rideRequestId}`,
          ]
        );
        promotionalRefundTransactionId = result.insertId;
      }
    } else {
      if (reserve.cash_hold_transaction_id) {
        await connection.execute(
          `UPDATE driver_wallet_transactions
           SET transaction_type = 'commission_debit', source_type = 'driver_cancellation_commission',
               description = ? WHERE id = ?`,
          [`Commission captured after admin rejected driver cancellation for trip #${rideRequestId}`, reserve.cash_hold_transaction_id]
        );
      }
      if (reserve.promotional_hold_transaction_id) {
        await connection.execute(
          `UPDATE driver_wallet_transactions
           SET transaction_type = 'promo_commission_debit', source_type = 'driver_cancellation_commission',
               description = ? WHERE id = ?`,
          [`Promotional commission captured after admin rejected driver cancellation for trip #${rideRequestId}`, reserve.promotional_hold_transaction_id]
        );
      }
    }

    const nextStatus = normalizedAction === 'refund' ? 'refunded' : 'captured';
    await connection.execute(
      `UPDATE driver_cancellation_commission_reserves
       SET status = ?, cash_refund_transaction_id = ?, promotional_refund_transaction_id = ?,
           reviewed_by_admin_id = ?, reviewed_by_admin_name = ?, review_note = ?,
           reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        nextStatus, cashRefundTransactionId, promotionalRefundTransactionId,
        adminId, adminName, String(note || '').trim() || null, reserve.id,
      ]
    );
    const [updatedRows] = await connection.execute(
      'SELECT * FROM driver_cancellation_commission_reserves WHERE id = ? LIMIT 1',
      [reserve.id]
    );
    return mapReserve(updatedRows[0]);
  });
}
