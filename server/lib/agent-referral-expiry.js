import { query } from '../db/connection.js';
import { clearRecruitmentPrivateMetadata } from './users.js';

export const AGENT_DRIVER_LINK_DAYS = 40;

const RECONCILE_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.AGENT_REFERRAL_RECONCILE_INTERVAL_MS || 15 * 60_000)
);

let reconcileTimer = null;
let reconcileRunning = false;

export async function expireAgentDriverLinks({ limit = 500 } = {}) {
  const expiredRows = await query(
    `SELECT id, driver_user_id, agent_user_id, expires_at, is_active, metadata_cleared_at
     FROM agent_driver_referrals
     WHERE expires_at IS NOT NULL
       AND expires_at <= CURRENT_TIMESTAMP
       AND (is_active = 1 OR metadata_cleared_at IS NULL)
     ORDER BY expires_at ASC, id ASC
     LIMIT ?`,
    [Math.max(1, Math.min(2000, Number(limit) || 500))]
  );

  if (!expiredRows.length) {
    return { expired: 0, metadataCleared: 0, metadataErrors: 0 };
  }

  const referralIds = expiredRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const placeholders = referralIds.map(() => '?').join(', ');
  const result = await query(
    `UPDATE agent_driver_referrals
     SET is_active = 0,
         unlinked_at = COALESCE(unlinked_at, expires_at, CURRENT_TIMESTAMP),
         unlink_reason = COALESCE(unlink_reason, '40_day_expired')
     WHERE id IN (${placeholders})
       AND is_active = 1`,
    referralIds
  );

  let metadataCleared = 0;
  let metadataErrors = 0;
  await Promise.all(expiredRows.map(async (row) => {
    try {
      await clearRecruitmentPrivateMetadata(row.driver_user_id);
      await query(
        `UPDATE agent_driver_referrals
         SET metadata_cleared_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [Number(row.id)]
      );
      metadataCleared += 1;
    } catch (error) {
      metadataErrors += 1;
      console.error('[agent.referrals.expiry] Clerk metadata clear failed', {
        referralId: Number(row.id),
        driverUserId: row.driver_user_id,
        message: error?.message || String(error),
      });
    }
  }));

  const summary = {
    expired: Number(result?.affectedRows || 0),
    metadataCleared,
    metadataErrors,
  };
  console.log('[agent.referrals.expiry] links processed', summary);
  return summary;
}

async function runExpiryReconciliation(source) {
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    const summary = await expireAgentDriverLinks();
    if (summary.expired > 0 || summary.metadataCleared > 0) {
      console.log('[agent.referrals.expiry] reconciliation complete', { source, ...summary });
    }
  } catch (error) {
    console.error('[agent.referrals.expiry] reconciliation failed', {
      source,
      message: error?.message || String(error),
    });
  } finally {
    reconcileRunning = false;
  }
}

export function startAgentReferralExpiryReconciler() {
  if (reconcileTimer) return;
  void runExpiryReconciliation('startup');
  reconcileTimer = setInterval(() => {
    void runExpiryReconciliation('interval');
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();
}
