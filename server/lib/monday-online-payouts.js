import { query } from '../db/connection.js';
import { cashOutDriverWallet } from './driver-wallet.js';

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export async function loadMondayOnlinePayoutCandidates() {
  return query(
    `SELECT
       w.driver_user_id,
       w.available_balance,
       LEAST(
         w.available_balance,
         COALESCE(SUM(CASE
           WHEN t.transaction_type = 'manual_credit'
            AND t.source_type IN ('passenger_ride_payment', 'driver_wallet_cashout_refund')
           THEN t.amount
           WHEN t.transaction_type = 'manual_debit'
            AND t.source_type = 'driver_wallet_cashout'
           THEN -t.amount
           ELSE 0
         END), 0)
       ) AS withdrawable_balance
     FROM driver_wallets w
     LEFT JOIN driver_wallet_transactions t ON t.driver_user_id = w.driver_user_id
     INNER JOIN driver_identity di ON di.driver_user_id = w.driver_user_id
      AND di.smile_cash_status = 'active'
      AND di.smile_cash_mobile IS NOT NULL
     GROUP BY w.driver_user_id, w.available_balance
     HAVING withdrawable_balance > 0
     ORDER BY withdrawable_balance DESC`
  );
}

export async function processMondayOnlinePayouts({
  apply = false,
  requireMonday = true,
  narration = 'Trust Express Monday auto payout',
} = {}) {
  const today = new Date();
  const isMonday = today.getDay() === 1;
  if (requireMonday && !isMonday) {
    return {
      ok: true,
      applied: false,
      skipped: true,
      reason: 'not_monday',
      candidates: [],
      results: [],
      summary: { totalDrivers: 0, totalAmount: 0, success: 0, failed: 0 },
    };
  }

  const candidates = await loadMondayOnlinePayoutCandidates();
  const shapedCandidates = candidates.map((row) => ({
    driverUserId: row.driver_user_id,
    availableBalance: normalizeMoney(row.available_balance),
    withdrawableBalance: normalizeMoney(row.withdrawable_balance),
  }));
  const totalAmount = normalizeMoney(
    shapedCandidates.reduce((sum, row) => sum + row.withdrawableBalance, 0)
  );

  if (!apply) {
    return {
      ok: true,
      applied: false,
      skipped: false,
      candidates: shapedCandidates,
      results: [],
      summary: {
        totalDrivers: shapedCandidates.length,
        totalAmount,
        success: 0,
        failed: 0,
      },
    };
  }

  const results = [];
  for (const row of shapedCandidates) {
    try {
      const result = await cashOutDriverWallet({
        driverUserId: row.driverUserId,
        amount: row.withdrawableBalance,
        narration,
      });
      results.push({
        driverUserId: row.driverUserId,
        amount: row.withdrawableBalance,
        status: 'success',
        publicId: result.publicId,
      });
    } catch (error) {
      results.push({
        driverUserId: row.driverUserId,
        amount: row.withdrawableBalance,
        status: 'failed',
        error: error.message || 'Payout failed',
      });
    }
  }

  return {
    ok: results.every((row) => row.status === 'success'),
    applied: true,
    skipped: false,
    candidates: shapedCandidates,
    results,
    summary: {
      totalDrivers: shapedCandidates.length,
      totalAmount,
      success: results.filter((row) => row.status === 'success').length,
      failed: results.filter((row) => row.status === 'failed').length,
    },
  };
}
