import fs from 'fs/promises';
import path from 'path';
import { getClerkClient } from './clerk-client.js';
import { query, withTransaction } from '../db/connection.js';

const uploadsDir = path.resolve(process.cwd(), 'uploads');

function normalizeMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function buildDeletionError(message, status = 400, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

/**
 * Drivers with remaining wallet funds must not be deleted.
 */
export async function assertDriverHasNoWalletFunds(userId) {
  const rows = await query(
    `SELECT available_balance
     FROM driver_wallets
     WHERE driver_user_id = ?
     LIMIT 1`,
    [userId]
  );
  const balance = normalizeMoney(rows?.[0]?.available_balance || 0);
  if (balance > 0) {
    throw buildDeletionError(
      `This driver still has a wallet balance of ${balance.toFixed(2)}. Clear or withdraw the funds before deleting the account.`,
      409,
      {
        code: 'DRIVER_WALLET_HAS_FUNDS',
        availableBalance: balance,
      }
    );
  }
  return balance;
}

function collectUploadPaths(...values) {
  const results = [];

  for (const value of values) {
    if (!value) continue;

    if (Array.isArray(value)) {
      results.push(...collectUploadPaths(...value));
      continue;
    }

    const raw = String(value).trim().replace(/\\/g, '/');
    if (!raw) continue;

    let pathname = raw;
    try {
      pathname = new URL(raw).pathname;
    } catch {
      pathname = raw;
    }

    if (!pathname.startsWith('/uploads/') && !pathname.startsWith('uploads/')) continue;
    const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    results.push(normalized);
  }

  return Array.from(new Set(results));
}

async function deleteUploadedFiles(pathsToDelete) {
  await Promise.all(
    pathsToDelete.map(async (uploadPath) => {
      const relativePath = uploadPath
        .replace(/^\/?uploads\/?/i, '')
        .split('/')
        .filter(Boolean)
        .filter((segment) => segment !== '.' && segment !== '..')
        .join(path.sep);
      if (!relativePath) return;

      const fullPath = path.join(uploadsDir, relativePath);
      try {
        await fs.unlink(fullPath);
      } catch {
        // Ignore missing files or cleanup failures after account deletion.
      }
    })
  );
}

async function cleanupPassengerData(connection, userId) {
  const [identityRows] = await connection.execute(
    `SELECT national_id_front_url, national_id_back_url, selfie_url
     FROM passenger_identity
     WHERE passenger_user_id = ?`,
    [userId]
  );
  const identityRow = identityRows[0] || null;

  await connection.execute(
    `DELETE FROM ride_requests
     WHERE passenger_user_id = ?`,
    [userId]
  );
  // Without this the identity row survives the account and keeps inflating the
  // pending-verification count with a user that can never be reviewed.
  await connection.execute(
    `DELETE FROM passenger_identity
     WHERE passenger_user_id = ?`,
    [userId]
  );

  return collectUploadPaths(
    identityRow?.national_id_front_url,
    identityRow?.national_id_back_url,
    identityRow?.selfie_url
  );
}

async function cleanupDriverData(connection, userId) {
  const [identityRows] = await connection.execute(
    `SELECT national_id_front_url, national_id_back_url, driver_licence_url, selfie_url
     FROM driver_identity
     WHERE driver_user_id = ?`,
    [userId]
  );
  const [vehicleRows] = await connection.execute(
    `SELECT car_photo_front_url, car_photo_rear_url, car_photo_urls, vehicle_registration_url,
            vehicle_registration_book_url, insurance_url, zinara_url
     FROM driver_vehicle
     WHERE driver_user_id = ?`,
    [userId]
  );

  const identityRow = identityRows[0] || null;
  const vehicleRow = vehicleRows[0] || null;
  let parsedCarPhotoUrls = [];
  try {
    parsedCarPhotoUrls = vehicleRow?.car_photo_urls ? JSON.parse(vehicleRow.car_photo_urls) : [];
  } catch {
    parsedCarPhotoUrls = [];
  }

  await connection.execute(
    `DELETE FROM ride_request_driver_responses
     WHERE driver_user_id = ?`,
    [userId]
  );
  await connection.execute(
    `DELETE FROM ride_requests
     WHERE driver_user_id = ?`,
    [userId]
  );
  await connection.execute(
    `DELETE FROM driver_availability
     WHERE driver_user_id = ?`,
    [userId]
  );
  // Keep driver_wallets + driver_wallet_transactions (+ topups) for admin audit after deletion.
  await connection.execute(
    `DELETE FROM driver_identity
     WHERE driver_user_id = ?`,
    [userId]
  );
  await connection.execute(
    `DELETE FROM driver_vehicle
     WHERE driver_user_id = ?`,
    [userId]
  );

  return collectUploadPaths(
    identityRow?.national_id_front_url,
    identityRow?.national_id_back_url,
    identityRow?.driver_licence_url,
    identityRow?.selfie_url,
    vehicleRow?.car_photo_front_url,
    vehicleRow?.car_photo_rear_url,
    parsedCarPhotoUrls,
    vehicleRow?.vehicle_registration_url,
    vehicleRow?.vehicle_registration_book_url,
    vehicleRow?.insurance_url,
    vehicleRow?.zinara_url
  );
}

export async function deleteEndUserAccount(userId, role, { email = null, fullName = null } = {}) {
  const normalizedRole = role === 'driver' ? 'driver' : 'passenger';
  let uploadPaths = [];
  const snapshotEmail = email ? String(email).trim().toLowerCase() : null;
  const snapshotName = fullName ? String(fullName).trim() : null;

  if (normalizedRole === 'driver') {
    await assertDriverHasNoWalletFunds(userId);
  }

  await withTransaction(async (connection) => {
    if (normalizedRole === 'driver') {
      // Re-check inside the transaction so a concurrent credit cannot race past the gate.
      const [walletRows] = await connection.execute(
        `SELECT available_balance, account_deleted_at
         FROM driver_wallets
         WHERE driver_user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [userId]
      );
      const balance = normalizeMoney(walletRows?.[0]?.available_balance || 0);
      if (balance > 0) {
        throw buildDeletionError(
          `This driver still has a wallet balance of ${balance.toFixed(2)}. Clear or withdraw the funds before deleting the account.`,
          409,
          {
            code: 'DRIVER_WALLET_HAS_FUNDS',
            availableBalance: balance,
          }
        );
      }

      // Preserve ledger forever; mark wallet closed and keep email for admin lookups.
      if (walletRows?.[0]) {
        await connection.execute(
          `UPDATE driver_wallets
           SET account_deleted_at = COALESCE(account_deleted_at, CURRENT_TIMESTAMP),
               owner_email = COALESCE(?, owner_email),
               owner_full_name = COALESCE(?, owner_full_name),
               updated_at = CURRENT_TIMESTAMP
           WHERE driver_user_id = ?`,
          [snapshotEmail, snapshotName, userId]
        );
      } else if (snapshotEmail) {
        await connection.execute(
          `INSERT INTO driver_wallets (
             driver_user_id, available_balance, owner_email, owner_full_name, account_deleted_at
           ) VALUES (?, 0.00, ?, ?, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE
             account_deleted_at = COALESCE(account_deleted_at, CURRENT_TIMESTAMP),
             owner_email = COALESCE(VALUES(owner_email), owner_email),
             owner_full_name = COALESCE(VALUES(owner_full_name), owner_full_name)`,
          [userId, snapshotEmail, snapshotName]
        );
      }

      uploadPaths = await cleanupDriverData(connection, userId);
      return;
    }

    uploadPaths = await cleanupPassengerData(connection, userId);
  });

  const clerkClient = getClerkClient();
  await clerkClient.users.deleteUser(userId);
  if (uploadPaths.length > 0) {
    await deleteUploadedFiles(uploadPaths);
  }

  return { ok: true, role: normalizedRole };
}
