import { query } from '../db/connection.js';

export const DEFAULT_MINIMUM_BALANCE_USD = 1;
export const DEFAULT_COMMISSION_RATE_PERCENT = 9.5;
export const DEFAULT_TOPUP_MIN_AMOUNT = 1;
export const DEFAULT_TOPUP_MAX_AMOUNT = 500;
export const DEFAULT_WALLET_CURRENCY = 'USD';

const SETTINGS_CACHE_TTL_MS = 15_000;

let settingsCache = null;
let settingsCacheLoadedAt = 0;

function normalizeMoney(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round(amount * 100) / 100;
}

function clampCommissionRate(value, fallback = DEFAULT_COMMISSION_RATE_PERCENT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(normalizeMoney(parsed), 0), 100);
}

function coerceBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeCurrency(value, fallback = DEFAULT_WALLET_CURRENCY) {
  const currency = String(value || fallback).trim().toUpperCase();
  return currency || fallback;
}

function getDefaultSettingsFromEnv() {
  return {
    // Keep legacy ride flow until admin explicitly turns payments on.
    walletEnabled: false,
    paymentsEnabled: coerceBoolean(process.env.DRIVER_WALLET_PAYMENTS_ENABLED, false),
    minimumBalanceUsd: normalizeMoney(
      process.env.DRIVER_WALLET_MINIMUM_BALANCE_USD,
      DEFAULT_MINIMUM_BALANCE_USD
    ) || DEFAULT_MINIMUM_BALANCE_USD,
    commissionRatePercent: clampCommissionRate(
      process.env.DRIVER_WALLET_COMMISSION_RATE_PERCENT,
      DEFAULT_COMMISSION_RATE_PERCENT
    ),
    topupMinAmount: normalizeMoney(
      process.env.DRIVER_WALLET_TOPUP_MIN_AMOUNT,
      DEFAULT_TOPUP_MIN_AMOUNT
    ) || DEFAULT_TOPUP_MIN_AMOUNT,
    topupMaxAmount: normalizeMoney(
      process.env.DRIVER_WALLET_TOPUP_MAX_AMOUNT,
      DEFAULT_TOPUP_MAX_AMOUNT
    ) || DEFAULT_TOPUP_MAX_AMOUNT,
    currency: normalizeCurrency(process.env.DRIVER_WALLET_CURRENCY, DEFAULT_WALLET_CURRENCY),
    updatedByAdminId: null,
    createdAt: null,
    updatedAt: null,
  };
}

function shapeDriverWalletSettings(row) {
  const defaults = getDefaultSettingsFromEnv();
  const topupMinAmount = normalizeMoney(row?.topup_min_amount, defaults.topupMinAmount);
  const topupMaxAmount = normalizeMoney(row?.topup_max_amount, defaults.topupMaxAmount);
  return {
    walletEnabled: coerceBoolean(row?.wallet_enabled, defaults.walletEnabled),
    paymentsEnabled: coerceBoolean(row?.payments_enabled, defaults.paymentsEnabled),
    minimumBalanceUsd: normalizeMoney(row?.minimum_balance_usd, defaults.minimumBalanceUsd),
    commissionRatePercent: clampCommissionRate(row?.commission_rate_percent, defaults.commissionRatePercent),
    topupMinAmount: topupMinAmount > 0 ? topupMinAmount : defaults.topupMinAmount,
    topupMaxAmount: topupMaxAmount >= topupMinAmount ? topupMaxAmount : defaults.topupMaxAmount,
    currency: normalizeCurrency(row?.currency, defaults.currency),
    updatedByAdminId: row?.updated_by_admin_id || null,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function ensureDriverWalletSettingsRow() {
  const defaults = getDefaultSettingsFromEnv();
  await query(
    `INSERT INTO driver_wallet_settings (
       id,
       wallet_enabled,
       payments_enabled,
       minimum_balance_usd,
       commission_rate_percent,
       topup_min_amount,
       topup_max_amount,
       currency
     )
     SELECT 1, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM driver_wallet_settings WHERE id = 1
     )`,
    [
      defaults.walletEnabled ? 1 : 0,
      defaults.paymentsEnabled ? 1 : 0,
      defaults.minimumBalanceUsd,
      defaults.commissionRatePercent,
      defaults.topupMinAmount,
      defaults.topupMaxAmount,
      defaults.currency,
    ]
  );
}

function setSettingsCache(settings) {
  settingsCache = settings;
  settingsCacheLoadedAt = Date.now();
  return settings;
}

export function getCachedDriverWalletSettings() {
  if (settingsCache && (Date.now() - settingsCacheLoadedAt) < SETTINGS_CACHE_TTL_MS) {
    return settingsCache;
  }
  return settingsCache || getDefaultSettingsFromEnv();
}

export async function getDriverWalletSettings({ force = false } = {}) {
  if (
    !force &&
    settingsCache &&
    (Date.now() - settingsCacheLoadedAt) < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache;
  }

  try {
    await ensureDriverWalletSettingsRow();
    const [row] = await query(
      `SELECT *
       FROM driver_wallet_settings
       WHERE id = 1
       LIMIT 1`
    );
    return setSettingsCache(shapeDriverWalletSettings(row || null));
  } catch (error) {
    console.warn('[driver-wallet-settings] Falling back to env defaults', {
      message: error?.message || String(error),
    });
    return setSettingsCache(getDefaultSettingsFromEnv());
  }
}

export async function updateDriverWalletSettings({
  walletEnabled,
  paymentsEnabled,
  minimumBalanceUsd,
  commissionRatePercent,
  topupMinAmount,
  topupMaxAmount,
  currency,
  adminUserId = null,
} = {}) {
  await ensureDriverWalletSettingsRow();
  const current = await getDriverWalletSettings({ force: true });

  const nextWalletEnabled = walletEnabled === undefined
    ? current.walletEnabled
    : coerceBoolean(walletEnabled, current.walletEnabled);
  const nextPaymentsEnabled = paymentsEnabled === undefined
    ? current.paymentsEnabled
    : coerceBoolean(paymentsEnabled, current.paymentsEnabled);
  const nextMinimumBalance = minimumBalanceUsd === undefined
    ? current.minimumBalanceUsd
    : normalizeMoney(minimumBalanceUsd, NaN);
  const nextCommissionRate = commissionRatePercent === undefined
    ? current.commissionRatePercent
    : clampCommissionRate(commissionRatePercent, NaN);
  const nextTopupMin = topupMinAmount === undefined
    ? current.topupMinAmount
    : normalizeMoney(topupMinAmount, NaN);
  const nextTopupMax = topupMaxAmount === undefined
    ? current.topupMaxAmount
    : normalizeMoney(topupMaxAmount, NaN);
  const nextCurrency = currency === undefined
    ? current.currency
    : normalizeCurrency(currency, NaN);

  if (!Number.isFinite(nextMinimumBalance) || nextMinimumBalance < 0) {
    const error = new Error('Minimum wallet balance must be zero or greater');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(nextCommissionRate)) {
    const error = new Error('Commission rate must be between 0 and 100');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(nextTopupMin) || nextTopupMin <= 0) {
    const error = new Error('Minimum top-up amount must be greater than zero');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(nextTopupMax) || nextTopupMax < nextTopupMin) {
    const error = new Error('Maximum top-up amount must be greater than or equal to the minimum');
    error.status = 400;
    throw error;
  }
  if (!nextCurrency) {
    const error = new Error('Currency is required');
    error.status = 400;
    throw error;
  }

  await query(
    `UPDATE driver_wallet_settings
     SET wallet_enabled = ?,
         payments_enabled = ?,
         minimum_balance_usd = ?,
         commission_rate_percent = ?,
         topup_min_amount = ?,
         topup_max_amount = ?,
         currency = ?,
         updated_by_admin_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      nextWalletEnabled ? 1 : 0,
      nextPaymentsEnabled ? 1 : 0,
      nextMinimumBalance,
      nextCommissionRate,
      nextTopupMin,
      nextTopupMax,
      nextCurrency,
      adminUserId,
    ]
  );

  return getDriverWalletSettings({ force: true });
}
