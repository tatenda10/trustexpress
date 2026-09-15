import { query, withTransaction } from '../db/connection.js';
import { toAppUser } from './clerk-user.js';
import { getPaymentProvider } from './payment-providers/index.js';
import { getDriverWalletSettings } from './driver-wallet-settings.js';
import {
  createSmileCashSubscriber,
  executeSmileCashExternalCashout,
  normalizeDateOfBirth,
  normalizeGender,
  normalizeZimMobile,
  toIsoDateOnly,
} from './smile-cash.js';

const PAYABLE_RIDE_STATUSES = new Set([
  'driver_assigned',
  'driver_arrived',
  'in_progress',
  'completed',
]);

function buildPaymentError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function getRideGrossFare(ride) {
  return normalizeMoney(
    Number(ride?.final_estimated_amount || ride?.estimated_amount || 0)
    + Number(ride?.tip_amount || 0)
  );
}

function makePaymentReference(rideRequestId) {
  return `pr_${String(rideRequestId || 'ride').replace(/\D/g, '').slice(-10) || 'ride'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shapePassengerSmileCash(row) {
  return {
    mobile: row?.smile_cash_mobile || null,
    status: row?.smile_cash_status || null,
    openedAt: row?.smile_cash_opened_at ? new Date(row.smile_cash_opened_at).toISOString() : null,
    lastError: row?.smile_cash_last_error || null,
    dateOfBirth: toIsoDateOnly(row?.date_of_birth),
    gender: row?.gender || null,
    nationalIdNumber: row?.national_id_number || null,
  };
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rideNeedsDriverCancelBeforeStartRefund(rideLike = {}) {
  const status = String(rideLike?.ride_status || rideLike?.status || '').trim().toLowerCase();
  const cancelledBy = String(rideLike?.cancelled_by || '').trim().toLowerCase();
  return status === 'cancelled' && cancelledBy === 'driver' && !rideLike?.started_at;
}

function assertRidePayable(ride) {
  if (!ride) throw buildPaymentError('Ride request not found', 404);
  if (!PAYABLE_RIDE_STATUSES.has(String(ride.status || '').toLowerCase())) {
    throw buildPaymentError('Payment opens once a driver is assigned to your ride', 409);
  }
  if (!ride.driver_user_id) throw buildPaymentError('Ride has no assigned driver', 409);
  const paymentStatus = String(ride.payment_status || '').toLowerCase();
  if (paymentStatus === 'paid' || ride.paid_at) {
    throw buildPaymentError('This ride is already paid', 409);
  }
  if (String(ride.payment_method || '').toLowerCase() === 'cash') {
    throw buildPaymentError('This ride is set to pay with cash', 409);
  }
}

export async function openPassengerSmileCash({ passengerUserId, clerkUser, payload = {} }) {
  const appUser = toAppUser(clerkUser);
  const [identity] = await query(
    `SELECT *
     FROM passenger_identity
     WHERE passenger_user_id = ?
     LIMIT 1`,
    [passengerUserId]
  );

  const firstName = String(appUser.first_name || clerkUser?.firstName || '').trim();
  const lastName = String(appUser.last_name || clerkUser?.lastName || '').trim();
  const idNumber = String(payload.idNumber || '').trim().toUpperCase();
  const dateOfBirth = normalizeDateOfBirth(payload.dateOfBirth || identity?.date_of_birth || '');
  const gender = normalizeGender(payload.gender || identity?.gender || '');
  const mobile = normalizeZimMobile(
    payload.mobile
    || identity?.smile_cash_mobile
    || appUser.phone_number
    || clerkUser?.primaryPhoneNumber?.phoneNumber
    || ''
  );

  if (!firstName || !lastName) throw buildPaymentError('First and last name are required');
  if (!idNumber) throw buildPaymentError('National ID number is required');
  if (!dateOfBirth || !gender) throw buildPaymentError('Date of birth and gender are required');
  if (!mobile) throw buildPaymentError('A valid mobile number is required');

  await query(
    `INSERT INTO passenger_identity (
       passenger_user_id,
       date_of_birth,
       gender,
       national_id_number,
       smile_cash_mobile,
       smile_cash_status,
       smile_cash_last_error
     ) VALUES (?, ?, ?, ?, ?, 'pending', NULL)
     ON DUPLICATE KEY UPDATE
       date_of_birth = VALUES(date_of_birth),
       gender = VALUES(gender),
       national_id_number = VALUES(national_id_number),
       smile_cash_mobile = VALUES(smile_cash_mobile),
       smile_cash_status = 'pending',
       smile_cash_last_error = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [passengerUserId, dateOfBirth, gender, idNumber, mobile]
  );

  try {
    const result = await createSmileCashSubscriber({
      firstName,
      lastName,
      mobile,
      dateOfBirth,
      idNumber,
      gender,
      source: 'TRUST_EXPRESS_PASSENGER',
    });

    await query(
      `UPDATE passenger_identity
       SET smile_cash_mobile = ?,
           smile_cash_status = 'active',
           smile_cash_opened_at = CURRENT_TIMESTAMP,
           smile_cash_last_error = NULL
       WHERE passenger_user_id = ?`,
      [result.mobile, passengerUserId]
    );
  } catch (err) {
    await query(
      `UPDATE passenger_identity
       SET smile_cash_status = 'failed',
           smile_cash_last_error = ?
       WHERE passenger_user_id = ?`,
      [String(err.message || 'Smile Cash registration failed').slice(0, 1000), passengerUserId]
    );
    throw err;
  }

  const [updated] = await query(
    `SELECT *
     FROM passenger_identity
     WHERE passenger_user_id = ?
     LIMIT 1`,
    [passengerUserId]
  );
  return shapePassengerSmileCash(updated);
}

export async function linkPassengerSmileCash({ passengerUserId, clerkUser, payload = {} }) {
  const appUser = toAppUser(clerkUser);
  const [identity] = await query(
    `SELECT *
     FROM passenger_identity
     WHERE passenger_user_id = ?
     LIMIT 1`,
    [passengerUserId]
  );

  const idNumber = String(payload.idNumber || '').trim().toUpperCase();
  const dateOfBirth = normalizeDateOfBirth(payload.dateOfBirth || identity?.date_of_birth || '');
  const gender = normalizeGender(payload.gender || identity?.gender || '');
  const mobile = normalizeZimMobile(
    payload.mobile
    || identity?.smile_cash_mobile
    || appUser.phone_number
    || clerkUser?.primaryPhoneNumber?.phoneNumber
    || ''
  );

  if (!idNumber) throw buildPaymentError('National ID number is required');
  if (!dateOfBirth || !gender) throw buildPaymentError('Date of birth and gender are required');
  if (!mobile) throw buildPaymentError('A valid mobile number is required');

  await query(
    `INSERT INTO passenger_identity (
       passenger_user_id,
       date_of_birth,
       gender,
       national_id_number,
       smile_cash_mobile,
       smile_cash_status,
       smile_cash_opened_at,
       smile_cash_last_error
     ) VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
     ON DUPLICATE KEY UPDATE
       date_of_birth = VALUES(date_of_birth),
       gender = VALUES(gender),
       national_id_number = VALUES(national_id_number),
       smile_cash_mobile = VALUES(smile_cash_mobile),
       smile_cash_status = 'active',
       smile_cash_opened_at = COALESCE(passenger_identity.smile_cash_opened_at, CURRENT_TIMESTAMP),
       smile_cash_last_error = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [passengerUserId, dateOfBirth, gender, idNumber, mobile]
  );

  const [updated] = await query(
    `SELECT *
     FROM passenger_identity
     WHERE passenger_user_id = ?
     LIMIT 1`,
    [passengerUserId]
  );
  return shapePassengerSmileCash(updated);
}

export async function choosePassengerRideCashPayment({ passengerUserId, rideRequestId }) {
  const [ride] = await query(
    `SELECT *
     FROM ride_requests
     WHERE id = ?
       AND passenger_user_id = ?
     LIMIT 1`,
    [rideRequestId, passengerUserId]
  );
  assertRidePayable(ride);

  await query(
    `UPDATE ride_requests
     SET payment_method = 'cash',
         payment_provider = NULL,
         payment_reference = NULL,
         payment_status = 'unpaid'
     WHERE id = ?`,
    [ride.id]
  );

  return {
    paymentStatus: 'unpaid',
    paymentMethod: 'cash',
    canPayCash: false,
    canPayWithSmilePay: false,
    canChoosePaymentMethod: false,
  };
}

export async function initializePassengerRidePayment({
  passengerUserId,
  passenger,
  rideRequestId,
  callbackUrl = null,
}) {
  const [ride] = await query(
    `SELECT rr.*,
            di.smile_cash_mobile AS driver_smile_cash_mobile,
            di.smile_cash_status AS driver_smile_cash_status
     FROM ride_requests rr
     LEFT JOIN driver_identity di ON di.driver_user_id = rr.driver_user_id
     WHERE rr.id = ?
       AND rr.passenger_user_id = ?
     LIMIT 1`,
    [rideRequestId, passengerUserId]
  );
  assertRidePayable(ride);

  const amount = getRideGrossFare(ride);
  if (!(amount > 0)) throw buildPaymentError('Ride amount must be greater than zero');

  const receiverMobile = normalizeZimMobile(ride.driver_smile_cash_mobile || '') || null;

  const [existingPending] = await query(
    `SELECT *
     FROM passenger_ride_payments
     WHERE ride_request_id = ?
       AND passenger_user_id = ?
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1`,
    [rideRequestId, passengerUserId]
  );
  if (existingPending?.reference && existingPending?.raw_initialize_payload) {
    let raw = {};
    try {
      raw = typeof existingPending.raw_initialize_payload === 'string'
        ? JSON.parse(existingPending.raw_initialize_payload || '{}')
        : existingPending.raw_initialize_payload || {};
    } catch {
      raw = {};
    }
    console.log('[smilepay] initialize.reuse_pending', {
      rideRequestId,
      reference: existingPending.reference,
      status: existingPending.status,
      amount: Number(existingPending.amount || amount),
      authorizationUrl: raw.authorizationUrl || raw.paymentUrl || raw.checkoutUrl || null,
    });
    return {
      reference: existingPending.reference,
      authorizationUrl: raw.authorizationUrl || raw.paymentUrl || raw.checkoutUrl || null,
      amount: Number(existingPending.amount || amount),
      currency: existingPending.currency || 'USD',
      status: existingPending.status,
    };
  }

  const provider = getPaymentProvider('smilepay');
  const reference = makePaymentReference(rideRequestId);
  const resultUrl = String(process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL || process.env.SERVER_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!resultUrl) {
    throw buildPaymentError('PUBLIC_API_BASE_URL is required for passenger Smile&Pay webhooks', 500);
  }
  const callback = String(callbackUrl || '').trim();
  const topup = await provider.initializeTopup({
    reference,
    amount,
    currency: 'USD',
    email: passenger?.email || undefined,
    callbackUrl: callback || undefined,
    resultUrl: `${resultUrl}/api/passengers/payments/webhooks/smilepay`,
    driverUserId: ride.driver_user_id,
    firstName: passenger?.first_name || passenger?.firstName || '',
    lastName: passenger?.last_name || passenger?.lastName || '',
    mobilePhoneNumber: passenger?.phone_number || passenger?.phoneNumber || '',
    itemName: `Trust Express Ride ${ride.public_id || ride.id}`,
    itemDescription: `Passenger ride payment held by Trust Express for ${ride.driver_name || 'driver'}`,
  });

  console.log('[smilepay] initialize.created', {
    rideRequestId: ride.id,
    reference,
    amount,
    callback: callback || null,
    resultUrl: `${resultUrl}/api/passengers/payments/webhooks/smilepay`,
    authorizationUrl: topup.authorizationUrl,
    externalTransactionId: topup.externalTransactionId || null,
  });

  await query(
    `INSERT INTO passenger_ride_payments (
       reference, ride_request_id, passenger_user_id, driver_user_id,
       amount, currency, provider, status, receiver_mobile, provider_transaction_id, raw_initialize_payload
     ) VALUES (?, ?, ?, ?, ?, 'USD', 'smilepay', 'pending', ?, ?, ?)`,
    [
      reference,
      ride.id,
      passengerUserId,
      ride.driver_user_id,
      amount,
      receiverMobile,
      topup.externalTransactionId || null,
      JSON.stringify({
        ...topup.rawInitializePayload,
        authorizationUrl: topup.authorizationUrl,
      }),
    ]
  );

  await query(
    `UPDATE ride_requests
     SET payment_status = 'pending',
         payment_provider = 'smilepay',
         payment_reference = ?,
         payment_method = NULL
     WHERE id = ?`,
    [reference, ride.id]
  );

  return {
    reference,
    authorizationUrl: topup.authorizationUrl,
    amount,
    currency: 'USD',
    status: 'pending',
  };
}

async function creditDriverWalletForPassengerPayment(connection, payment, extras = {}) {
  const settings = await getDriverWalletSettings();
  const fareAmount = normalizeMoney(extras.fareAmount ?? payment.amount);
  const tipAmount = normalizeMoney(extras.tipAmount);
  const commissionRatePercent = Number(settings.commissionRatePercent || 9.5);
  const commissionAmount = normalizeMoney(fareAmount * (commissionRatePercent / 100));
  const amount = normalizeMoney(Math.max(0, fareAmount - commissionAmount + tipAmount));
  const currency = String(payment.currency || 'USD').toUpperCase();
  const sourceId = String(payment.reference || payment.id);

  const [existingRows] = await connection.execute(
    `SELECT id
     FROM driver_wallet_transactions
     WHERE driver_user_id = ?
       AND transaction_type = 'manual_credit'
       AND source_type = 'passenger_ride_payment'
       AND source_id = ?
     LIMIT 1`,
    [payment.driver_user_id, sourceId]
  );
  if (existingRows[0]) return existingRows[0].id;

  await connection.execute(
    `INSERT INTO driver_wallets (driver_user_id, available_balance)
     VALUES (?, 0.00)
     ON DUPLICATE KEY UPDATE driver_user_id = VALUES(driver_user_id)`,
    [payment.driver_user_id]
  );

  const [walletRows] = await connection.execute(
    `SELECT available_balance
     FROM driver_wallets
     WHERE driver_user_id = ?
     LIMIT 1
     FOR UPDATE`,
    [payment.driver_user_id]
  );
  const balanceBefore = normalizeMoney(walletRows[0]?.available_balance || 0);
  const balanceAfter = normalizeMoney(balanceBefore + amount);

  await connection.execute(
    `UPDATE driver_wallets
     SET available_balance = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE driver_user_id = ?`,
    [balanceAfter, payment.driver_user_id]
  );

  const [insertResult] = await connection.execute(
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
       trip_fare_amount,
       commission_rate_percent,
       balance_before,
       balance_after,
       provider_reference,
       external_transaction_id,
       description
     ) VALUES (?, 'manual_credit', ?, ?, ?, 'passenger_ride_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payment.driver_user_id,
      amount,
      currency,
      payment.payment_method || 'smilepay',
      sourceId,
      payment.ride_request_id,
      payment.passenger_user_id,
      fareAmount,
      commissionRatePercent,
      balanceBefore,
      balanceAfter,
      payment.reference,
      payment.provider_transaction_id || null,
      `Passenger online payment. Service fee ${commissionRatePercent.toFixed(1)}% withheld. Net credited to Trust Express wallet.`,
    ]
  );

  return insertResult?.insertId || null;
}

async function reverseDriverWalletForPassengerPayment(connection, payment) {
  if (!payment?.driver_user_id) {
    return { reversed: false, alreadyReversed: false, transactionId: null };
  }
  const sourceId = String(payment.reference || payment.id);
  const [creditRows] = await connection.execute(
    `SELECT id, driver_user_id, amount, currency
     FROM driver_wallet_transactions
     WHERE driver_user_id = ?
       AND transaction_type = 'manual_credit'
       AND source_type = 'passenger_ride_payment'
       AND source_id = ?
     LIMIT 1`,
    [payment.driver_user_id, sourceId]
  );
  const credit = creditRows[0];
  if (!credit) return { reversed: false, alreadyReversed: false, transactionId: null };

  const [existingReversal] = await connection.execute(
    `SELECT id
     FROM driver_wallet_transactions
     WHERE driver_user_id = ?
       AND transaction_type = 'manual_debit'
       AND source_type = 'passenger_ride_payment_reversal'
       AND source_id = ?
     LIMIT 1`,
    [payment.driver_user_id, sourceId]
  );
  if (existingReversal[0]) {
    return { reversed: false, alreadyReversed: true, transactionId: existingReversal[0].id };
  }

  await connection.execute(
    `INSERT INTO driver_wallets (driver_user_id, available_balance)
     VALUES (?, 0.00)
     ON DUPLICATE KEY UPDATE driver_user_id = VALUES(driver_user_id)`,
    [payment.driver_user_id]
  );

  const [walletRows] = await connection.execute(
    `SELECT available_balance
     FROM driver_wallets
     WHERE driver_user_id = ?
     LIMIT 1
     FOR UPDATE`,
    [payment.driver_user_id]
  );
  const debitAmount = normalizeMoney(credit.amount);
  const balanceBefore = normalizeMoney(walletRows[0]?.available_balance || 0);
  const balanceAfter = normalizeMoney(balanceBefore - debitAmount);

  await connection.execute(
    `UPDATE driver_wallets
     SET available_balance = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE driver_user_id = ?`,
    [balanceAfter, payment.driver_user_id]
  );

  const [insertResult] = await connection.execute(
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
       trip_fare_amount,
       commission_rate_percent,
       balance_before,
       balance_after,
       provider_reference,
       external_transaction_id,
       description
     ) VALUES (?, 'manual_debit', ?, ?, ?, 'passenger_ride_payment_reversal', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      payment.driver_user_id,
      debitAmount,
      credit.currency || payment.currency || 'USD',
      payment.payment_method || 'smilepay',
      sourceId,
      payment.ride_request_id,
      payment.passenger_user_id,
      payment.amount,
      balanceBefore,
      balanceAfter,
      payment.reference,
      payment.provider_transaction_id || null,
      'Reversal of passenger online payment after Captain cancelled before trip start',
    ]
  );

  return {
    reversed: true,
    alreadyReversed: false,
    transactionId: insertResult?.insertId || null,
    amount: debitAmount,
  };
}

function pickPassengerRefundMobile(payment, extras = {}) {
  const initializePayload = parseJsonObject(payment.raw_initialize_payload);
  const candidates = [
    extras.smileCashMobile,
    extras.passengerPhone,
    extras.userPhone,
    initializePayload.mobilePhoneNumber,
    initializePayload.mobile,
    initializePayload.ecocashMobile,
  ];
  for (const candidate of candidates) {
    const mobile = normalizeZimMobile(candidate || '');
    if (mobile) return mobile;
  }
  return '';
}

async function persistPassengerPaymentRefund(connection, payment, patch = {}) {
  const values = [
    patch.status,
    patch.payoutStatus,
    patch.refundStatus,
    patch.refundMethod || null,
    patch.status,
    patch.walletReversalTransactionId || null,
    patch.payoutAuthTransactionId || null,
    patch.payoutPaymentTransactionId || null,
    patch.errorMessage || null,
    JSON.stringify(patch.rawRefundPayload || {}),
    payment.id,
  ];
  try {
    await connection.execute(
      `UPDATE passenger_ride_payments
       SET status = ?,
           payout_status = ?,
           refund_status = ?,
           refund_method = ?,
           refunded_at = CASE WHEN ? IN ('refunded', 'cancelled') THEN CURRENT_TIMESTAMP ELSE refunded_at END,
           wallet_reversal_transaction_id = COALESCE(?, wallet_reversal_transaction_id),
           payout_auth_transaction_id = COALESCE(?, payout_auth_transaction_id),
           payout_payment_transaction_id = COALESCE(?, payout_payment_transaction_id),
           error_message = ?,
           raw_refund_payload = ?
       WHERE id = ?`,
      values
    );
  } catch (error) {
    if (!String(error?.message || '').includes('Unknown column')) throw error;
    await connection.execute(
      `UPDATE passenger_ride_payments
       SET status = ?,
           payout_status = ?,
           payout_auth_transaction_id = COALESCE(?, payout_auth_transaction_id),
           payout_payment_transaction_id = COALESCE(?, payout_payment_transaction_id),
           error_message = ?,
           raw_payout_payload = ?
       WHERE id = ?`,
      [
        patch.status,
        patch.payoutStatus,
        patch.payoutAuthTransactionId || null,
        patch.payoutPaymentTransactionId || null,
        patch.errorMessage || null,
        JSON.stringify(patch.rawRefundPayload || {}),
        payment.id,
      ]
    );
  }
}

async function refundCapturedPassengerPayment(payment, ride, extras = {}) {
  const currentStatus = String(payment.status || '').toLowerCase();
  if (currentStatus === 'refunded' || currentStatus === 'cancelled') {
    return {
      paymentId: payment.id,
      reference: payment.reference,
      status: currentStatus,
      refunded: true,
      refundMethod: payment.refund_method || null,
      walletReversed: true,
    };
  }

  const provider = getPaymentProvider('smilepay');
  const walletReversal = await withTransaction(async (connection) => (
    reverseDriverWalletForPassengerPayment(connection, payment)
  ));

  if (payment.payout_payment_transaction_id) {
    await withTransaction(async (connection) => {
      await persistPassengerPaymentRefund(connection, payment, {
        status: 'refunded',
        payoutStatus: walletReversal.reversed || walletReversal.alreadyReversed ? 'wallet_reversed' : payment.payout_status,
        refundStatus: 'refunded',
        refundMethod: payment.refund_method || 'smile_cash',
        walletReversalTransactionId: walletReversal.transactionId,
        payoutAuthTransactionId: payment.payout_auth_transaction_id,
        payoutPaymentTransactionId: payment.payout_payment_transaction_id,
        errorMessage: null,
        rawRefundPayload: parseJsonObject(payment.raw_refund_payload),
      });
    });
    return {
      paymentId: payment.id,
      reference: payment.reference,
      status: 'refunded',
      refunded: true,
      refundMethod: payment.refund_method || 'smile_cash',
      walletReversed: Boolean(walletReversal.reversed || walletReversal.alreadyReversed),
    };
  }

  let refundMethod = null;
  let refundOk = false;
  let rawRefundPayload = { walletReversal };
  let payoutAuthTransactionId = null;
  let payoutPaymentTransactionId = null;
  let errorMessage = null;

  try {
    const smilePayRefund = await provider.refundTransaction({
      reference: payment.reference,
      amount: payment.amount,
      reason: 'Captain cancelled before trip start',
    });
    rawRefundPayload.smilePayRefund = smilePayRefund;
    if (smilePayRefund?.ok) {
      refundOk = true;
      refundMethod = 'smilepay_refund';
    }
  } catch (error) {
    rawRefundPayload.smilePayRefund = {
      ok: false,
      message: error?.message || String(error),
      payload: error?.providerPayload || null,
    };
  }

  if (!refundOk) {
    const mobile = pickPassengerRefundMobile(payment, extras);
    if (!mobile) {
      errorMessage = 'No passenger mobile number available for automatic refund';
    } else {
      try {
        const smileCashRefund = await executeSmileCashExternalCashout({
          receiverMobile: mobile,
          amount: payment.amount,
          currency: payment.currency || 'USD',
          narration: `Trust Express refund ${ride?.public_id || payment.ride_request_id}`,
        });
        rawRefundPayload.smileCashRefund = {
          receiverMobile: smileCashRefund.receiverMobile,
          amount: smileCashRefund.amount,
          authTransactionId: smileCashRefund.authTransactionId,
          paymentTransactionId: smileCashRefund.paymentTransactionId,
        };
        payoutAuthTransactionId = smileCashRefund.authTransactionId || null;
        payoutPaymentTransactionId = smileCashRefund.paymentTransactionId || null;
        refundOk = true;
        refundMethod = 'smile_cash';
      } catch (error) {
        errorMessage = error?.message || String(error);
        rawRefundPayload.smileCashRefund = {
          ok: false,
          message: errorMessage,
          payload: error?.providerPayload || null,
        };
      }
    }
  }

  const nextStatus = refundOk ? 'refunded' : 'refund_pending';
  await withTransaction(async (connection) => {
    await persistPassengerPaymentRefund(connection, payment, {
      status: nextStatus,
      payoutStatus: walletReversal.reversed || walletReversal.alreadyReversed ? 'wallet_reversed' : 'pending',
      refundStatus: nextStatus,
      refundMethod,
      walletReversalTransactionId: walletReversal.transactionId,
      payoutAuthTransactionId,
      payoutPaymentTransactionId,
      errorMessage,
      rawRefundPayload,
    });
  });

  console.log('[smilepay] refund.captured', {
    rideRequestId: payment.ride_request_id,
    reference: payment.reference,
    refundOk,
    refundMethod,
    walletReversed: walletReversal.reversed || walletReversal.alreadyReversed,
    errorMessage,
  });

  return {
    paymentId: payment.id,
    reference: payment.reference,
    status: nextStatus,
    refunded: refundOk,
    refundMethod,
    walletReversed: Boolean(walletReversal.reversed || walletReversal.alreadyReversed),
    errorMessage,
  };
}

async function cancelPendingPassengerPayment(payment) {
  const provider = getPaymentProvider('smilepay');
  let cancelPayload = null;
  let cancelOk = false;
  try {
    cancelPayload = await provider.cancelTransaction({ reference: payment.reference });
    cancelOk = true;
  } catch (error) {
    cancelPayload = {
      ok: false,
      message: error?.message || String(error),
      payload: error?.providerPayload || null,
    };
  }

  if (cancelOk) {
    await withTransaction(async (connection) => {
      await persistPassengerPaymentRefund(connection, payment, {
        status: 'cancelled',
        payoutStatus: 'cancelled',
        refundStatus: 'cancelled',
        refundMethod: 'smilepay_cancel',
        errorMessage: null,
        rawRefundPayload: { smilePayCancel: cancelPayload },
      });
    });
    return {
      paymentId: payment.id,
      reference: payment.reference,
      status: 'cancelled',
      refunded: true,
      refundMethod: 'smilepay_cancel',
      walletReversed: false,
    };
  }

  let verification = null;
  try {
    verification = await provider.verifyTopup({
      reference: payment.reference,
      expectedAmount: payment.amount,
      expectedCurrency: payment.currency,
      alternateReference: payment.provider_transaction_id,
    });
  } catch (error) {
    verification = {
      wasSuccessful: false,
      nextStatus: 'pending',
      rawVerifyPayload: error?.providerPayload || { error: error?.message || String(error) },
    };
  }

  if (verification?.wasSuccessful) {
    return null;
  }

  await withTransaction(async (connection) => {
    await persistPassengerPaymentRefund(connection, payment, {
      status: 'cancelled',
      payoutStatus: 'cancelled',
      refundStatus: 'cancelled',
      refundMethod: 'smilepay_cancel',
      errorMessage: cancelPayload?.message || null,
      rawRefundPayload: { smilePayCancel: cancelPayload, verify: verification?.rawVerifyPayload || verification },
    });
  });

  return {
    paymentId: payment.id,
    reference: payment.reference,
    status: 'cancelled',
    refunded: true,
    refundMethod: 'abandoned_pending',
    walletReversed: false,
  };
}

export async function refundOnlinePaymentsForDriverCancelBeforeStart({ rideRequestId }) {
  const [ride] = await query(
    `SELECT
       rr.id,
       rr.public_id,
       rr.status,
       rr.cancelled_by,
       rr.started_at,
       rr.payment_status,
       rr.passenger_user_id,
       rr.passenger_phone,
       pi.smile_cash_mobile,
       u.phone_number
     FROM ride_requests rr
     LEFT JOIN passenger_identity pi ON pi.passenger_user_id = rr.passenger_user_id
     LEFT JOIN users u ON u.clerk_user_id = rr.passenger_user_id
     WHERE rr.id = ?
     LIMIT 1`,
    [rideRequestId]
  );

  if (!rideNeedsDriverCancelBeforeStartRefund(ride)) {
    return { attempted: false, reason: 'not_driver_cancel_before_start', passengerRefunded: false, walletReversed: false };
  }

  const payments = await query(
    `SELECT *
     FROM passenger_ride_payments
     WHERE ride_request_id = ?
       AND status IN ('pending', 'success', 'refund_pending')
     ORDER BY id DESC`,
    [rideRequestId]
  );

  if (!payments.length) {
    return { attempted: false, reason: 'no_online_payment', passengerRefunded: false, walletReversed: false };
  }

  await query(
    `UPDATE ride_requests
     SET payment_status = 'refund_pending'
     WHERE id = ?
       AND payment_status IN ('paid', 'pending')`,
    [rideRequestId]
  );

  const extras = {
    smileCashMobile: ride.smile_cash_mobile,
    passengerPhone: ride.passenger_phone,
    userPhone: ride.phone_number,
  };
  const results = [];

  for (const payment of payments) {
    const status = String(payment.status || '').toLowerCase();
    if (status === 'pending') {
      const cancelledPending = await cancelPendingPassengerPayment(payment);
      if (cancelledPending) {
        results.push(cancelledPending);
        continue;
      }
      const captured = await query(
        `SELECT * FROM passenger_ride_payments WHERE id = ? LIMIT 1`,
        [payment.id]
      );
      results.push(await refundCapturedPassengerPayment(captured[0] || payment, ride, extras));
      continue;
    }
    results.push(await refundCapturedPassengerPayment(payment, ride, extras));
  }

  const passengerRefunded = results.some((row) => row.refunded && ['refunded', 'cancelled'].includes(row.status));
  const walletReversed = results.some((row) => row.walletReversed);
  const hasPendingRefund = results.some((row) => row.status === 'refund_pending');
  const nextRidePaymentStatus = hasPendingRefund
    ? 'refund_pending'
    : (passengerRefunded ? (results.some((row) => row.status === 'refunded') ? 'refunded' : 'cancelled') : ride.payment_status);

  await query(
    `UPDATE ride_requests
     SET payment_status = ?
     WHERE id = ?`,
    [nextRidePaymentStatus, rideRequestId]
  );

  console.log('[smilepay] refund.driver_cancel_before_start', {
    rideRequestId,
    passengerRefunded,
    walletReversed,
    paymentStatus: nextRidePaymentStatus,
    results,
  });

  return {
    attempted: true,
    passengerRefunded,
    walletReversed,
    paymentStatus: nextRidePaymentStatus,
    results,
  };
}

export async function verifyPassengerRidePayment({ passengerUserId = null, rideRequestId = null, reference, webhookPayload = null }) {
  const safeReference = String(reference || '').trim();
  if (!safeReference) throw buildPaymentError('reference is required');

  console.log('[smilepay] verify.start', {
    passengerUserId,
    rideRequestId,
    reference: safeReference,
    fromWebhook: Boolean(webhookPayload),
    webhookKeys: webhookPayload ? Object.keys(webhookPayload) : [],
  });

  const paymentSelectSql = `SELECT prp.*,
            rr.public_id,
            rr.passenger_user_id,
            rr.driver_name,
            rr.status AS ride_status,
            rr.cancelled_by,
            rr.started_at
     FROM passenger_ride_payments prp
     INNER JOIN ride_requests rr ON rr.id = prp.ride_request_id`;
  let [payment] = await query(
    `${paymentSelectSql}
     WHERE prp.reference = ?
       ${passengerUserId ? 'AND prp.passenger_user_id = ?' : ''}
       ${rideRequestId ? 'AND prp.ride_request_id = ?' : ''}
     LIMIT 1`,
    [
      safeReference,
      ...(passengerUserId ? [passengerUserId] : []),
      ...(rideRequestId ? [rideRequestId] : []),
    ]
  );
  if (!payment) {
    [payment] = await query(
      `${paymentSelectSql}
       WHERE prp.provider_transaction_id = ?
         ${passengerUserId ? 'AND prp.passenger_user_id = ?' : ''}
         ${rideRequestId ? 'AND prp.ride_request_id = ?' : ''}
       LIMIT 1`,
      [
        safeReference,
        ...(passengerUserId ? [passengerUserId] : []),
        ...(rideRequestId ? [rideRequestId] : []),
      ]
    );
  }
  if (!payment) throw buildPaymentError('Payment not found', 404);

  if (String(payment.status || '').toLowerCase() === 'refunded') {
    return { payment, alreadyVerified: true };
  }

  if (payment.status === 'success') {
    console.log('[smilepay] verify.already_success', {
      reference: payment.reference,
      rideRequestId: payment.ride_request_id,
    });
    if (rideNeedsDriverCancelBeforeStartRefund(payment)) {
      const refund = await refundOnlinePaymentsForDriverCancelBeforeStart({
        rideRequestId: payment.ride_request_id,
      });
      return { payment, alreadyVerified: true, refund };
    }
    return { payment, alreadyVerified: true };
  }

  const provider = getPaymentProvider('smilepay');
  let verification;
  try {
    verification = webhookPayload
      ? provider.parseWebhook(webhookPayload)
      : await provider.verifyTopup({
          reference: payment.reference,
          expectedAmount: payment.amount,
          expectedCurrency: payment.currency,
          alternateReference: payment.provider_transaction_id,
        });
  } catch (error) {
    console.error('[smilepay] verify.provider_error', {
      reference: payment.reference,
      providerTransactionId: payment.provider_transaction_id,
      message: error?.message || String(error),
      providerPayload: error?.providerPayload || null,
    });
    verification = {
      wasSuccessful: false,
      nextStatus: 'pending',
      verifiedAmount: payment.amount,
      verifiedCurrency: payment.currency,
      paymentMethod: null,
      externalTransactionId: payment.provider_transaction_id,
      rawVerifyPayload: error?.providerPayload || { error: error?.message || String(error) },
    };
  }

  const amountMatched = normalizeMoney(verification.verifiedAmount) === normalizeMoney(payment.amount)
    || !(Number(verification.verifiedAmount) > 0);
  const currencyMatched = String(verification.verifiedCurrency || '').toUpperCase() === String(payment.currency || 'USD').toUpperCase();
  const wasSuccessful = verification.wasSuccessful && amountMatched && currencyMatched;
  const nextStatus = wasSuccessful
    ? 'success'
    : (verification.nextStatus === 'success' ? 'pending' : (verification.nextStatus || 'pending'));

  console.log('[smilepay] verify.evaluated', {
    reference: payment.reference,
    providerTransactionId: payment.provider_transaction_id || verification.externalTransactionId || null,
    currentStatus: payment.status,
    nextStatus,
    wasSuccessful,
    amountMatched,
    currencyMatched,
    expectedAmount: payment.amount,
    verifiedAmount: verification.verifiedAmount,
    expectedCurrency: payment.currency,
    verifiedCurrency: verification.verifiedCurrency,
  });

  const verified = await withTransaction(async (connection) => {
    const [lockedRows] = await connection.execute(
      `SELECT *
       FROM passenger_ride_payments
       WHERE reference = ?
       LIMIT 1
       FOR UPDATE`,
      [payment.reference]
    );
    const locked = lockedRows[0];
    if (!locked) throw buildPaymentError('Payment not found', 404);
    if (String(locked.status || '').toLowerCase() === 'refunded') {
      return { payment: locked, alreadyVerified: true };
    }
    if (locked.status === 'success') {
      return {
        payment: locked,
        alreadyVerified: true,
        shouldRefundAfter: rideNeedsDriverCancelBeforeStartRefund(payment),
      };
    }

    await connection.execute(
      `UPDATE passenger_ride_payments
       SET status = ?,
           payment_method = ?,
           provider_transaction_id = COALESCE(?, provider_transaction_id),
           raw_verify_payload = ?,
           paid_at = CASE WHEN ? = 'success' THEN CURRENT_TIMESTAMP ELSE paid_at END,
           error_message = CASE WHEN ? = 'success' THEN NULL ELSE error_message END
       WHERE id = ?`,
      [
        nextStatus,
        verification.paymentMethod || null,
        verification.externalTransactionId || null,
        JSON.stringify(verification.rawVerifyPayload || webhookPayload || {}),
        nextStatus,
        nextStatus,
        locked.id,
      ]
    );

    if (!wasSuccessful) {
      await connection.execute(
        `UPDATE ride_requests
         SET payment_status = ?
         WHERE id = ?`,
        [nextStatus, locked.ride_request_id]
      );
      console.log('[smilepay] verify.not_success', {
        reference: locked.reference,
        rideRequestId: locked.ride_request_id,
        nextStatus,
      });
      return { payment: { ...locked, status: nextStatus }, alreadyVerified: false };
    }

    const [rideRow] = await connection.execute(
      `SELECT status, cancelled_by, started_at, final_estimated_amount, estimated_amount, tip_amount
       FROM ride_requests
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [locked.ride_request_id]
    );
    const shouldRefundAfter = rideNeedsDriverCancelBeforeStartRefund(rideRow?.[0] || payment);

    await connection.execute(
      `UPDATE ride_requests
       SET payment_status = 'paid',
           payment_provider = 'smilepay',
           payment_reference = ?,
           payment_method = ?,
           paid_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [safeReference, verification.paymentMethod || 'online', locked.ride_request_id]
    );

    let walletCreditTransactionId = null;
    if (!shouldRefundAfter) {
      walletCreditTransactionId = await creditDriverWalletForPassengerPayment(connection, {
        ...locked,
        payment_method: verification.paymentMethod || 'online',
        provider_transaction_id: verification.externalTransactionId || null,
      }, {
        fareAmount: rideRow?.[0]?.final_estimated_amount || rideRow?.[0]?.estimated_amount || locked.amount,
        tipAmount: rideRow?.[0]?.tip_amount || 0,
      });
    }

    if (!shouldRefundAfter) {
      await connection.execute(
        `UPDATE passenger_ride_payments
         SET payout_status = 'wallet_credited',
             wallet_credit_transaction_id = ?
         WHERE id = ?`,
        [walletCreditTransactionId, locked.id]
      );
    }

    const [updatedRows] = await connection.execute(
      `SELECT *
       FROM passenger_ride_payments
       WHERE id = ?
       LIMIT 1`,
      [locked.id]
    );
    console.log('[smilepay] verify.success', {
      reference: locked.reference,
      rideRequestId: locked.ride_request_id,
      walletCreditTransactionId,
      shouldRefundAfter,
      amount: locked.amount,
    });
    return { payment: updatedRows[0] || locked, alreadyVerified: false, shouldRefundAfter };
  });

  if (verified.shouldRefundAfter) {
    const refund = await refundOnlinePaymentsForDriverCancelBeforeStart({
      rideRequestId: verified.payment.ride_request_id,
    });
    return { ...verified, refund };
  }
  return verified;
}

export async function handlePassengerSmilePayWebhook(body = {}) {
  console.log('[smilepay] webhook.received', body);
  const provider = getPaymentProvider('smilepay');
  const parsed = provider.parseWebhook(body);
  const reference = String(parsed.reference || parsed.externalTransactionId || '').trim();
  if (!reference) throw buildPaymentError('orderReference is required', 400);
  return verifyPassengerRidePayment({ reference, webhookPayload: body });
}
