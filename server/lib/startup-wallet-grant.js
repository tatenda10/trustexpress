import { query } from '../db/connection.js';
import { getClerkClient } from './clerk-client.js';
import { toAppUser } from './clerk-user.js';
import { getDriverWalletSettings } from './driver-wallet-settings.js';
import { creditDriverWalletManual } from './driver-wallet.js';

export const DEFAULT_STARTUP_GRANT_ID = 'startup_grant_v1';
export const DEFAULT_STARTUP_GRANT_AMOUNT = 5;

function buildWalletError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function loadAllClerkDrivers() {
  const clerk = getClerkClient();
  const limit = 100;
  let offset = 0;
  const drivers = [];

  while (true) {
    const page = await clerk.users.getUserList({
      limit,
      offset,
      orderBy: '-created_at',
    });
    const users = page.data || [];
    if (!users.length) break;

    for (const user of users) {
      const appUser = toAppUser(user);
      if (appUser.role !== 'driver') continue;
      drivers.push({
        id: appUser.clerk_user_id,
        email: appUser.email || null,
        fullName: [appUser.first_name, appUser.last_name].filter(Boolean).join(' ').trim() || null,
      });
    }

    offset += users.length;
    if (users.length < limit) break;
  }

  return drivers;
}

export async function loadAlreadyGrantedDriverIds(grantId) {
  const safeGrantId = String(grantId || '').trim();
  if (!safeGrantId) return new Set();

  const rows = await query(
    `SELECT DISTINCT driver_user_id
     FROM driver_wallet_transactions
     WHERE transaction_type = 'manual_credit'
       AND source_type = 'startup_grant'
       AND source_id = ?`,
    [safeGrantId]
  );
  return new Set(rows.map((row) => row.driver_user_id));
}

/**
 * Preview or apply the startup wallet grant for all drivers who have not
 * received this grantId yet. Idempotent on the same grant id.
 */
export async function runStartupWalletGrant({
  amount = DEFAULT_STARTUP_GRANT_AMOUNT,
  grantId = DEFAULT_STARTUP_GRANT_ID,
  currency = null,
  apply = false,
} = {}) {
  const creditAmount = Number(amount);
  if (!(creditAmount > 0)) {
    throw buildWalletError('Amount must be greater than zero');
  }

  const safeGrantId = String(grantId || DEFAULT_STARTUP_GRANT_ID).trim() || DEFAULT_STARTUP_GRANT_ID;
  if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(safeGrantId)) {
    throw buildWalletError('Grant id may only use letters, numbers, and _ . : - (max 64 chars)');
  }

  const settings = await getDriverWalletSettings();
  const creditCurrency = String(currency || settings.currency || 'USD').toUpperCase();

  const [drivers, alreadyGranted] = await Promise.all([
    loadAllClerkDrivers(),
    loadAlreadyGrantedDriverIds(safeGrantId),
  ]);

  const pending = drivers.filter((driver) => !alreadyGranted.has(driver.id));
  const summary = {
    amount: creditAmount,
    currency: creditCurrency,
    grantId: safeGrantId,
    apply: !!apply,
    totalDrivers: drivers.length,
    alreadyGranted: drivers.length - pending.length,
    pending: pending.length,
    totalToCredit: Number((pending.length * creditAmount).toFixed(2)),
    credited: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    samplePending: pending.slice(0, 25).map((driver) => ({
      id: driver.id,
      email: driver.email,
      fullName: driver.fullName,
    })),
  };

  if (pending.length === 0) {
    return summary;
  }

  for (const driver of pending) {
    const label = driver.fullName || driver.email || driver.id;
    try {
      if (!apply) {
        summary.credited += 1;
        continue;
      }

      const result = await creditDriverWalletManual({
        driverUserId: driver.id,
        amount: creditAmount,
        currency: creditCurrency,
        description: `Startup wallet grant (${safeGrantId})`,
        sourceType: 'startup_grant',
        sourceId: safeGrantId,
        paymentMethod: 'admin_grant',
      });

      if (result.alreadyCredited) {
        summary.skipped += 1;
        continue;
      }

      summary.credited += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        driverUserId: driver.id,
        label,
        error: error?.message || 'Credit failed',
      });
    }
  }

  return summary;
}

/**
 * Manual one-off credit for a single driver (admin UI).
 */
export async function creditSingleDriverWallet({
  driverUserId,
  amount,
  currency = null,
  description = 'Admin wallet top-up',
  sourceType = 'admin_manual_credit',
  sourceId = null,
} = {}) {
  const safeDriverUserId = String(driverUserId || '').trim();
  if (!safeDriverUserId) {
    throw buildWalletError('Driver user id is required');
  }

  return creditDriverWalletManual({
    driverUserId: safeDriverUserId,
    amount,
    currency,
    description,
    sourceType,
    sourceId: sourceId || `admin_${Date.now()}_${safeDriverUserId.slice(-8)}`,
    paymentMethod: 'admin_manual',
  });
}
