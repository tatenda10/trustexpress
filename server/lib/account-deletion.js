import fs from 'fs/promises';
import path from 'path';
import { getClerkClient } from './clerk-client.js';
import { withTransaction } from '../db/connection.js';

const uploadsDir = path.resolve(process.cwd(), 'uploads');

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
  await connection.execute(
    `DELETE FROM ride_requests
     WHERE passenger_user_id = ?`,
    [userId]
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

export async function deleteEndUserAccount(userId, role) {
  const normalizedRole = role === 'driver' ? 'driver' : 'passenger';
  let uploadPaths = [];

  await withTransaction(async (connection) => {
    if (normalizedRole === 'driver') {
      uploadPaths = await cleanupDriverData(connection, userId);
      return;
    }

    await cleanupPassengerData(connection, userId);
  });

  const clerkClient = getClerkClient();
  await clerkClient.users.deleteUser(userId);
  if (uploadPaths.length > 0) {
    await deleteUploadedFiles(uploadPaths);
  }

  return { ok: true, role: normalizedRole };
}
