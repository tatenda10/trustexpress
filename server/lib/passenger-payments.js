import { query, withTransaction } from '../db/connection.js';
import { toAppUser } from './clerk-user.js';
import { getPaymentProvider } from './payment-providers/index.js';
import { createSmileCashSubscriber, normalizeDateOfBirth, normalizeGender, normalizeZimMobile } from './smile-cash.js';

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
    dateOfBirth: row?.date_of_birth ? String(row.date_of_birth).slice(0, 10) : null,
    gender: row?.gender || null,
    nationalIdNumber: row?.national_id_number || null,
  };
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
  const idNumber = String(payload.idNumber || identity?.national_id_number || '').trim().toUpperCase();
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

  const idNumber = String(payload.idNumber || identity?.national_id_number || '').trim().toUpperCase();
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

  await query(
    `INSERT INTO passenger_ride_payments (
       reference, ride_request_id, passenger_user_id, driver_user_id,
       amount, currency, provider, status, receiver_mobile, raw_initialize_payload
     ) VALUES (?, ?, ?, ?, ?, 'USD', 'smilepay', 'pending', ?, ?)`,
    [
      reference,
      ride.id,
      passengerUserId,
      ride.driver_user_id,
      amount,
      receiverMobile,
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

async function creditDriverWalletForPassengerPayment(connection, payment) {
  const amount = normalizeMoney(payment.amount);
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
       balance_before,
       balance_after,
       provider_reference,
       external_transaction_id,
       description
     ) VALUES (?, 'manual_credit', ?, ?, ?, 'passenger_ride_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payment.driver_user_id,
      amount,
      currency,
      payment.payment_method || 'smilepay',
      sourceId,
      payment.ride_request_id,
      payment.passenger_user_id,
      amount,
      balanceBefore,
      balanceAfter,
      payment.reference,
      payment.provider_transaction_id || null,
      'Passenger Smile&Pay ride payment (full fare credited; commission charged on trip complete)',
    ]
  );

  return insertResult?.insertId || null;
}

export async function verifyPassengerRidePayment({ passengerUserId = null, rideRequestId = null, reference, webhookPayload = null }) {
  const safeReference = String(reference || '').trim();
  if (!safeReference) throw buildPaymentError('reference is required');

  const [payment] = await query(
    `SELECT prp.*, rr.public_id, rr.passenger_user_id, rr.driver_name
     FROM passenger_ride_payments prp
     INNER JOIN ride_requests rr ON rr.id = prp.ride_request_id
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
  if (!payment) throw buildPaymentError('Payment not found', 404);

  if (payment.status === 'success') {
    return { payment, alreadyVerified: true };
  }

  const provider = getPaymentProvider('smilepay');
  const verification = webhookPayload
    ? provider.parseWebhook(webhookPayload)
    : await provider.verifyTopup({
        reference: safeReference,
        expectedAmount: payment.amount,
        expectedCurrency: payment.currency,
      });

  const amountMatched = normalizeMoney(verification.verifiedAmount) === normalizeMoney(payment.amount);
  const currencyMatched = String(verification.verifiedCurrency || '').toUpperCase() === String(payment.currency || 'USD').toUpperCase();
  const wasSuccessful = verification.wasSuccessful && amountMatched && currencyMatched;
  const nextStatus = wasSuccessful ? 'success' : verification.nextStatus || 'failed';

  return withTransaction(async (connection) => {
    const [lockedRows] = await connection.execute(
      `SELECT *
       FROM passenger_ride_payments
       WHERE reference = ?
       LIMIT 1
       FOR UPDATE`,
      [safeReference]
    );
    const locked = lockedRows[0];
    if (!locked) throw buildPaymentError('Payment not found', 404);
    if (locked.status === 'success') {
      return { payment: locked, alreadyVerified: true };
    }

    await connection.execute(
      `UPDATE passenger_ride_payments
       SET status = ?,
           payment_method = ?,
           provider_transaction_id = ?,
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
      return { payment: { ...locked, status: nextStatus }, alreadyVerified: false };
    }

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

    const walletCreditTransactionId = await creditDriverWalletForPassengerPayment(connection, {
      ...locked,
      payment_method: verification.paymentMethod || 'online',
      provider_transaction_id: verification.externalTransactionId || null,
    });

    await connection.execute(
      `UPDATE passenger_ride_payments
       SET payout_status = 'wallet_credited',
           wallet_credit_transaction_id = ?
       WHERE id = ?`,
      [walletCreditTransactionId, locked.id]
    );

    const [updatedRows] = await connection.execute(
      `SELECT *
       FROM passenger_ride_payments
       WHERE id = ?
       LIMIT 1`,
      [locked.id]
    );
    return { payment: updatedRows[0] || locked, alreadyVerified: false };
  });
}

export async function handlePassengerSmilePayWebhook(body = {}) {
  const provider = getPaymentProvider('smilepay');
  const parsed = provider.parseWebhook(body);
  const reference = String(parsed.reference || '').trim();
  if (!reference) throw buildPaymentError('orderReference is required', 400);
  return verifyPassengerRidePayment({ reference, webhookPayload: body });
}
