import { reconcilePendingDriverWalletTopups } from './driver-wallet.js';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 1000;
const MAX_INTERVAL_MS = 30 * 60 * 1000;

let reconcilerTimer = null;
let reconcilerRunning = false;

function getIntervalMs() {
  const configured = Number(process.env.DRIVER_WALLET_TOPUP_RECONCILE_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(configured, MAX_INTERVAL_MS));
}

function getBatchLimit() {
  const configured = Number(process.env.DRIVER_WALLET_TOPUP_RECONCILE_LIMIT || 25);
  if (!Number.isFinite(configured) || configured <= 0) return 25;
  return Math.min(Math.max(configured, 1), 100);
}

export function startDriverWalletTopupReconciler() {
  if (reconcilerTimer) return;
  const intervalMs = getIntervalMs();
  const limit = getBatchLimit();

  const run = async (source = 'interval') => {
    if (reconcilerRunning) {
      console.log('[driver.wallet.topup.reconcile] skipped: already running', { source });
      return;
    }
    reconcilerRunning = true;
    const startedAt = Date.now();
    try {
      console.log('[driver.wallet.topup.reconcile] run start', { source, limit });
      const summary = await reconcilePendingDriverWalletTopups({ limit });
      console.log('[driver.wallet.topup.reconcile] run complete', {
        source,
        durationMs: Date.now() - startedAt,
        ...summary,
      });
    } catch (error) {
      console.error('[driver.wallet.topup.reconcile] run failed', {
        source,
        durationMs: Date.now() - startedAt,
        message: error?.message || String(error),
      });
    } finally {
      reconcilerRunning = false;
    }
  };

  reconcilerTimer = setInterval(() => {
    run('interval').catch(() => {});
  }, intervalMs);

  if (typeof reconcilerTimer.unref === 'function') {
    reconcilerTimer.unref();
  }

  console.log('[driver.wallet.topup.reconcile] scheduler started', { intervalMs, limit });
  setTimeout(() => run('startup').catch(() => {}), 15 * 1000).unref?.();
}

