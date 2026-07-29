import { query, withTransaction } from '../db/connection.js';
import { getDriverWalletSettings } from './driver-wallet-settings.js';
import { getPaymentProvider, normalizePaymentProvider } from './payment-providers/index.js';

/** @deprecated Use getDriverWalletSettings().commissionRatePercent */
export const DRIVER_WALLET_COMMISSION_RATE = 0.095;
/** @deprecated Use getDriverWalletSettings().currency */
export const DRIVER_WALLET_CURRENCY = 'ZAR';
const LOW_BALANCE_MESSAGE = 'Your Trust Express Wallet balance is too low. Please top up your wallet to continue receiving ride requests.';
const PAYMENTS_UNAVAILABLE_MESSAGE = 'Wallet top-ups are not available yet. Please check back soon.';

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function buildWalletError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function makeReference(driverUserId) {
  const rawId = String(driverUserId || 'driver').replace(/[^a-zA-Z0-9]/g, '').slice(-12) || 'driver';
  return `dw_${rawId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDriverWallet(driverUserId, connection = null) {
  const conn = connection || null;
  const sql = `INSERT INTO driver_wallets (driver_user_id, available_balance)
               VALUES (?, 0.00)
               ON DUPLICATE KEY UPDATE driver_user_id = VALUES(driver_user_id)`;
  if (conn) {
    await conn.execute(sql, [driverUserId]);
    const [rows] = await conn.execute(
      `SELECT driver_user_id, available_balance, created_at, updated_at
       FROM driver_wallets
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );
    return rows[0] || null;
  }
  await query(sql, [driverUserId]);
  const [row] = await query(
    `SELECT driver_user_id, available_balance, created_at, updated_at
     FROM driver_wallets
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  return row || null;
}

function mapWalletStatus(walletRow, settings) {
  const availableBalance = normalizeMoney(walletRow?.available_balance || 0);
  const minimumRequiredBalance = normalizeMoney(settings?.minimumBalanceUsd || 0);
  const paymentsEnabled = settings?.paymentsEnabled === true;
  // Balance gating only applies when the payments system is live.
  const walletEnabled = paymentsEnabled && settings?.walletEnabled !== false;
  const sufficientBalance = !walletEnabled || availableBalance >= minimumRequiredBalance;
  return {
    availableBalance,
    currency: settings?.currency || DRIVER_WALLET_CURRENCY,
    minimumRequiredBalance,
    topupMinAmount: normalizeMoney(settings?.topupMinAmount || 1),
    topupMaxAmount: normalizeMoney(settings?.topupMaxAmount || 500),
    commissionRatePercent: Number(settings?.commissionRatePercent || 9.5),
    walletEnabled,
    paymentsEnabled,
    paymentProvider: normalizePaymentProvider(settings?.paymentProvider, 'paystack'),
    paymentsUnavailableMessage: paymentsEnabled ? '' : PAYMENTS_UNAVAILABLE_MESSAGE,
    sufficientBalance,
    lowBalanceMessage: sufficientBalance ? '' : LOW_BALANCE_MESSAGE,
    createdAt: walletRow?.created_at ? new Date(walletRow.created_at).toISOString() : null,
    updatedAt: walletRow?.updated_at ? new Date(walletRow.updated_at).toISOString() : null,
  };
}

export async function getDriverWalletStatus(driverUserId) {
  const [wallet, settings] = await Promise.all([
    ensureDriverWallet(driverUserId),
    getDriverWalletSettings(),
  ]);
  return mapWalletStatus(wallet, settings);
}

export async function assertDriverWalletSufficient(driverUserId) {
  const status = await getDriverWalletStatus(driverUserId);
  // Legacy mode (payments off): drivers operate as before with no wallet checks.
  if (!status.paymentsEnabled) {
    return status;
  }
  if (!status.sufficientBalance) {
    const error = buildWalletError(status.lowBalanceMessage, 403);
    error.code = 'DRIVER_WALLET_LOW';
    error.walletStatus = status;
    throw error;
  }
  return status;
}

function mapTransactionRow(row, settings = null) {
  const currency = row.currency || settings?.currency || DRIVER_WALLET_CURRENCY;
  return {
    id: row.id,
    transactionType: row.transaction_type,
    amount: normalizeMoney(row.amount),
    currency,
    paymentMethod: row.payment_method || null,
    sourceType: row.source_type,
    sourceId: row.source_id || null,
    tripId: row.trip_id == null ? null : Number(row.trip_id),
    passengerUserId: row.passenger_user_id || null,
    passengerName: row.passenger_name || null,
    tripFareAmount: row.trip_fare_amount == null ? null : normalizeMoney(row.trip_fare_amount),
    commissionRatePercent: row.commission_rate_percent == null ? null : Number(row.commission_rate_percent),
    balanceBefore: normalizeMoney(row.balance_before),
    balanceAfter: normalizeMoney(row.balance_after),
    providerReference: row.provider_reference || null,
    externalTransactionId: row.external_transaction_id || null,
    description: row.description || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function mapTopupRow(row, settings = null) {
  const currency = row.currency || settings?.currency || DRIVER_WALLET_CURRENCY;
  return {
    id: row.id,
    reference: row.reference,
    provider: row.provider,
    requestedAmount: normalizeMoney(row.requested_amount),
    creditedAmount: row.credited_amount == null ? null : normalizeMoney(row.credited_amount),
    currency,
    status: row.status,
    authorizationUrl: row.authorization_url || null,
    accessCode: row.access_code || null,
    providerTransactionId: row.provider_transaction_id || null,
    paymentMethod: row.payment_method || null,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function getDriverWalletDashboard(driverUserId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const [wallet, settings] = await Promise.all([
    ensureDriverWallet(driverUserId),
    getDriverWalletSettings(),
  ]);
  const [summaryRow] = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN transaction_type = 'top_up_credit' THEN amount ELSE 0 END), 0) AS total_topups,
       COALESCE(SUM(CASE WHEN transaction_type = 'commission_debit' THEN ABS(amount) ELSE 0 END), 0) AS total_commission_paid
     FROM driver_wallet_transactions
     WHERE driver_user_id = ?`,
    [driverUserId]
  );
  const transactions = await query(
    `SELECT *
     FROM driver_wallet_transactions
     WHERE driver_user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}`,
    [driverUserId]
  );
  const pendingTopups = await query(
    `SELECT *
     FROM driver_wallet_topups
     WHERE driver_user_id = ?
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 10`,
    [driverUserId]
  );

  return {
    wallet: mapWalletStatus(wallet, settings),
    settings: {
      commissionRatePercent: Number(settings.commissionRatePercent || 9.5),
      topupMinAmount: normalizeMoney(settings.topupMinAmount || 1),
      topupMaxAmount: normalizeMoney(settings.topupMaxAmount || 500),
      walletEnabled: settings.walletEnabled !== false,
      paymentsEnabled: settings.paymentsEnabled === true,
      paymentProvider: normalizePaymentProvider(settings.paymentProvider, 'paystack'),
      paymentsUnavailableMessage: settings.paymentsEnabled === true ? '' : PAYMENTS_UNAVAILABLE_MESSAGE,
    },
    summary: {
      totalTopups: normalizeMoney(summaryRow?.total_topups || 0),
      totalCommissionPaid: normalizeMoney(summaryRow?.total_commission_paid || 0),
    },
    transactions: transactions.map((row) => mapTransactionRow(row, settings)),
    pendingTopups: pendingTopups.map((row) => mapTopupRow(row, settings)),
  };
}

export async function initializeDriverWalletTopup({
  driverUserId,
  driverEmail,
  amount,
  callbackUrl = null,
  firstName = '',
  lastName = '',
  mobilePhoneNumber = '',
}) {
  const settings = await getDriverWalletSettings();
  if (settings.paymentsEnabled !== true) {
    const error = buildWalletError(PAYMENTS_UNAVAILABLE_MESSAGE, 403);
    error.code = 'DRIVER_WALLET_PAYMENTS_DISABLED';
    throw error;
  }
  const currency = settings.currency || DRIVER_WALLET_CURRENCY;
  const providerId = normalizePaymentProvider(settings.paymentProvider, 'paystack');
  const provider = getPaymentProvider(providerId);
  const topupMinAmount = normalizeMoney(settings.topupMinAmount || 1);
  const topupMaxAmount = normalizeMoney(settings.topupMaxAmount || 500);
  const normalizedAmount = normalizeMoney(amount);
  if (!(normalizedAmount > 0)) {
    throw buildWalletError('Enter a valid top-up amount');
  }
  if (normalizedAmount < topupMinAmount) {
    throw buildWalletError(`Minimum top-up amount is ${currency} ${topupMinAmount.toFixed(2)}`);
  }
  if (normalizedAmount > topupMaxAmount) {
    throw buildWalletError(`Maximum top-up amount is ${currency} ${topupMaxAmount.toFixed(2)}`);
  }
  const email = String(driverEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw buildWalletError('A valid driver email is required to start payment');
  }

  const reference = makeReference(driverUserId);
  const nextCallbackUrl = String(callbackUrl || '').trim() || undefined;

  const initializeResult = await provider.initializeTopup({
    reference,
    amount: normalizedAmount,
    currency,
    email,
    callbackUrl: nextCallbackUrl,
    driverUserId,
    firstName,
    lastName,
    mobilePhoneNumber,
  });

  await ensureDriverWallet(driverUserId);
  await query(
    `INSERT INTO driver_wallet_topups (
       driver_user_id,
       provider,
       reference,
       requested_amount,
       credited_amount,
       currency,
       status,
       authorization_url,
       access_code,
       provider_transaction_id,
       raw_initialize_payload
     ) VALUES (?, ?, ?, ?, NULL, ?, 'pending', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider = VALUES(provider),
       requested_amount = VALUES(requested_amount),
       authorization_url = VALUES(authorization_url),
       access_code = VALUES(access_code),
       provider_transaction_id = VALUES(provider_transaction_id),
       raw_initialize_payload = VALUES(raw_initialize_payload),
       updated_at = CURRENT_TIMESTAMP`,
    [
      driverUserId,
      providerId,
      reference,
      normalizedAmount,
      currency,
      initializeResult.authorizationUrl || null,
      initializeResult.accessCode || null,
      initializeResult.externalTransactionId || null,
      JSON.stringify(initializeResult.rawInitializePayload || {}),
    ]
  );

  return {
    reference,
    provider: providerId,
    authorizationUrl: initializeResult.authorizationUrl || null,
    accessCode: initializeResult.accessCode || null,
    amount: normalizedAmount,
    currency,
  };
}

async function applyVerifiedTopupCredit({
  driverUserId,
  reference,
  verification,
  settings,
}) {
  const currency = settings.currency || DRIVER_WALLET_CURRENCY;
  const safeReference = String(reference || '').trim();

  return withTransaction(async (connection) => {
    const [topupRows] = await connection.execute(
      `SELECT *
       FROM driver_wallet_topups
       WHERE reference = ?
         AND driver_user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [safeReference, driverUserId]
    );
    const topup = topupRows[0] || null;
    if (!topup) {
      throw buildWalletError('Top-up not found', 404);
    }

    const wallet = await ensureDriverWallet(driverUserId, connection);
    const currentBalance = normalizeMoney(wallet?.available_balance || 0);

    if (topup.status === 'success') {
      return {
        topup: mapTopupRow(topup, settings),
        wallet: mapWalletStatus(wallet, settings),
        alreadyVerified: true,
      };
    }

    const expectedAmount = normalizeMoney(topup.requested_amount || 0);
    const nextStatus = verification.nextStatus || 'failed';
    let nextBalance = currentBalance;

    if (verification.wasSuccessful) {
      const creditedAmount = expectedAmount;
      nextBalance = normalizeMoney(currentBalance + creditedAmount);

      await connection.execute(
        `UPDATE driver_wallets
         SET available_balance = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE driver_user_id = ?`,
        [nextBalance, driverUserId]
      );

      await connection.execute(
        `INSERT INTO driver_wallet_transactions (
           driver_user_id,
           transaction_type,
           amount,
           currency,
           payment_method,
           source_type,
           source_id,
           balance_before,
           balance_after,
           provider_reference,
           external_transaction_id,
           description
         ) VALUES (?, 'top_up_credit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          driverUserId,
          creditedAmount,
          currency,
          verification.paymentMethod || null,
          verification.sourceType || `${String(topup.provider || 'wallet')}_topup`,
          safeReference,
          currentBalance,
          nextBalance,
          safeReference,
          verification.externalTransactionId || null,
          verification.description || 'Wallet top-up',
        ]
      );
    }

    await connection.execute(
      `UPDATE driver_wallet_topups
       SET status = ?,
           credited_amount = ?,
           provider_transaction_id = ?,
           payment_method = ?,
           paid_at = CASE WHEN ? = 'success' THEN CURRENT_TIMESTAMP ELSE paid_at END,
           verified_at = CURRENT_TIMESTAMP,
           raw_verify_payload = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE reference = ?
         AND driver_user_id = ?`,
      [
        nextStatus,
        verification.wasSuccessful ? expectedAmount : null,
        verification.externalTransactionId || null,
        verification.paymentMethod || null,
        nextStatus,
        JSON.stringify(verification.rawVerifyPayload || {}),
        safeReference,
        driverUserId,
      ]
    );

    const [updatedTopupRows] = await connection.execute(
      `SELECT *
       FROM driver_wallet_topups
       WHERE reference = ?
         AND driver_user_id = ?
       LIMIT 1`,
      [safeReference, driverUserId]
    );
    const [walletRows] = await connection.execute(
      `SELECT *
       FROM driver_wallets
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );

    return {
      topup: mapTopupRow(updatedTopupRows[0] || topup, settings),
      wallet: mapWalletStatus(walletRows[0] || wallet, settings),
      alreadyVerified: false,
    };
  });
}

export async function verifyDriverWalletTopup(driverUserId, reference) {
  const settings = await getDriverWalletSettings();
  const currency = settings.currency || DRIVER_WALLET_CURRENCY;
  const safeReference = String(reference || '').trim();
  if (!safeReference) {
    throw buildWalletError('reference is required');
  }

  const [existingTopup] = await query(
    `SELECT *
     FROM driver_wallet_topups
     WHERE reference = ?
       AND driver_user_id = ?
     LIMIT 1`,
    [safeReference, driverUserId]
  );
  if (!existingTopup) {
    throw buildWalletError('Top-up not found', 404);
  }

  const providerId = normalizePaymentProvider(existingTopup.provider || settings.paymentProvider, 'paystack');
  const provider = getPaymentProvider(providerId);
  const verification = await provider.verifyTopup({
    reference: safeReference,
    expectedAmount: existingTopup.requested_amount,
    expectedCurrency: existingTopup.currency || currency,
  });

  return applyVerifiedTopupCredit({
    driverUserId,
    reference: safeReference,
    verification,
    settings,
  });
}

export async function handleSmilePayWalletWebhook(body = {}) {
  const settings = await getDriverWalletSettings();
  const provider = getPaymentProvider('smilepay');
  const parsed = provider.parseWebhook(body);
  const safeReference = String(parsed.reference || '').trim();
  if (!safeReference) {
    throw buildWalletError('orderReference is required', 400);
  }

  const [existingTopup] = await query(
    `SELECT *
     FROM driver_wallet_topups
     WHERE reference = ?
     LIMIT 1`,
    [safeReference]
  );
  if (!existingTopup) {
    throw buildWalletError('Top-up not found', 404);
  }

  const expectedAmount = normalizeMoney(existingTopup.requested_amount || 0);
  const expectedCurrency = String(existingTopup.currency || settings.currency || 'USD').toUpperCase();
  const amountMatched = normalizeMoney(parsed.verifiedAmount) === expectedAmount;
  const currencyMatched = String(parsed.verifiedCurrency || '').toUpperCase() === expectedCurrency;
  const verification = {
    ...parsed,
    wasSuccessful: parsed.wasSuccessful && amountMatched && currencyMatched,
    nextStatus: parsed.wasSuccessful && amountMatched && currencyMatched
      ? 'success'
      : parsed.nextStatus || 'failed',
  };

  return applyVerifiedTopupCredit({
    driverUserId: existingTopup.driver_user_id,
    reference: safeReference,
    verification,
    settings,
  });
}

export async function deductCommissionForCompletedRide({
  driverUserId,
  rideRequestId,
  tripFareAmount,
  passengerUserId = null,
  passengerName = null,
}) {
  const settings = await getDriverWalletSettings();
  const currency = settings.currency || DRIVER_WALLET_CURRENCY;
  const commissionRatePercent = Number(settings.commissionRatePercent || 9.5);
  const commissionRate = commissionRatePercent / 100;
  const fareAmount = normalizeMoney(tripFareAmount);

  // Payments system off: skip commission — behave like the pre-wallet default.
  if (settings.paymentsEnabled !== true) {
    return {
      charged: false,
      skipped: true,
      reason: 'payments_disabled',
      commissionAmount: 0,
      commissionRatePercent,
    };
  }

  if (!(fareAmount > 0)) {
    return {
      charged: false,
      commissionAmount: 0,
      commissionRatePercent,
    };
  }

  return withTransaction(async (connection) => {
    const wallet = await ensureDriverWallet(driverUserId, connection);
    const [existingRows] = await connection.execute(
      `SELECT id, amount, balance_after
       FROM driver_wallet_transactions
       WHERE driver_user_id = ?
         AND source_type = 'trip_commission'
         AND source_id = ?
       LIMIT 1`,
      [driverUserId, String(rideRequestId)]
    );
    if (existingRows[0]) {
      return {
        charged: false,
        alreadyCharged: true,
        commissionAmount: Math.abs(normalizeMoney(existingRows[0].amount)),
        commissionRatePercent,
        balanceAfter: normalizeMoney(existingRows[0].balance_after),
      };
    }

    const balanceBefore = normalizeMoney(wallet?.available_balance || 0);
    const commissionAmount = normalizeMoney(fareAmount * commissionRate);
    const balanceAfter = normalizeMoney(balanceBefore - commissionAmount);

    await connection.execute(
      `UPDATE driver_wallets
       SET available_balance = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE driver_user_id = ?`,
      [balanceAfter, driverUserId]
    );

    await connection.execute(
      `INSERT INTO driver_wallet_transactions (
         driver_user_id,
         transaction_type,
         amount,
         currency,
         payment_method,
         source_type,
         source_id,
         trip_id,
         passenger_user_id,
         passenger_name,
         trip_fare_amount,
         commission_rate_percent,
         balance_before,
         balance_after,
         description
       ) VALUES (?, 'commission_debit', ?, ?, NULL, 'trip_commission', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        driverUserId,
        normalizeMoney(-commissionAmount),
        currency,
        String(rideRequestId),
        Number(rideRequestId),
        passengerUserId,
        passengerName,
        fareAmount,
        commissionRatePercent,
        balanceBefore,
        balanceAfter,
        `Trust Express commission for trip #${rideRequestId}`,
      ]
    );

    return {
      charged: true,
      alreadyCharged: false,
      commissionAmount,
      commissionRatePercent,
      balanceBefore,
      balanceAfter,
    };
  });
}
