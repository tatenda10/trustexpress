import { query } from '../db/connection.js';
import { deductCommissionForCompletedRide } from './driver-wallet.js';

const INTERVAL_MS = 2 * 60 * 1000;
/** Only recent rides, so turning payments back on never back-charges old trips. */
const LOOKBACK_HOURS = 72;
/** Leave the live completion request time to charge first. */
const SETTLE_SECONDS = 60;
const BATCH_LIMIT = 50;

let reconcilerTimer = null;
let reconcilerRunning = false;

export async function chargeMissingRideCommissions({ limit = BATCH_LIMIT } = {}) {
  const rides = await query(
    `SELECT
       r.id,
       r.driver_user_id,
       r.passenger_user_id,
       r.passenger_name,
       COALESCE(r.final_estimated_amount, r.original_estimated_amount, r.estimated_amount, 0) AS fare
     FROM ride_requests r
     WHERE r.status = 'completed'
       AND r.driver_user_id IS NOT NULL
       AND r.completed_at >= (CURRENT_TIMESTAMP - INTERVAL ${LOOKBACK_HOURS} HOUR)
       AND r.completed_at <= (CURRENT_TIMESTAMP - INTERVAL ${SETTLE_SECONDS} SECOND)
       AND COALESCE(r.final_estimated_amount, r.original_estimated_amount, r.estimated_amount, 0) > 0
       AND NOT (
         LOWER(COALESCE(r.payment_status, '')) = 'paid'
         AND LOWER(COALESCE(r.payment_method, '')) NOT IN ('', 'cash')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM driver_wallet_transactions t
         WHERE t.trip_id = r.id
           AND t.source_type = 'trip_commission'
       )
     ORDER BY r.completed_at ASC
     LIMIT ${Math.max(1, Math.min(Number(limit) || BATCH_LIMIT, 200))}`
  );

  const summary = { found: rides.length, charged: 0, skipped: 0, failed: 0 };
  for (const ride of rides) {
    try {
      const result = await deductCommissionForCompletedRide({
        driverUserId: ride.driver_user_id,
        rideRequestId: Number(ride.id),
        tripFareAmount: Number(ride.fare || 0),
        passengerUserId: ride.passenger_user_id || null,
        passengerName: ride.passenger_name || null,
      });
      if (result?.charged) {
        summary.charged += 1;
        console.log('[ride.commission.reconcile] charged missed commission', {
          rideRequestId: ride.id,
          driverUserId: ride.driver_user_id,
          commissionAmount: result.commissionAmount,
          balanceAfter: result.balanceAfter,
        });
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error('[ride.commission.reconcile] charge failed', {
        rideRequestId: ride.id,
        driverUserId: ride.driver_user_id,
        message: error?.message || String(error),
      });
    }
  }
  return summary;
}

export function startRideCommissionReconciler() {
  if (reconcilerTimer) return;

  const run = async (source) => {
    if (reconcilerRunning) return;
    reconcilerRunning = true;
    try {
      const summary = await chargeMissingRideCommissions();
      if (summary.found > 0) {
        console.log('[ride.commission.reconcile] run complete', { source, ...summary });
      }
    } catch (error) {
      console.error('[ride.commission.reconcile] run failed', {
        source,
        message: error?.message || String(error),
      });
    } finally {
      reconcilerRunning = false;
    }
  };

  reconcilerTimer = setInterval(() => {
    run('interval');
  }, INTERVAL_MS);
  reconcilerTimer.unref?.();
  setTimeout(() => run('startup'), 20 * 1000).unref?.();
}
