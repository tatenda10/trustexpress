import 'dotenv/config';
import { query } from '../db/connection.js';

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function safeJsonArrayCount(value) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

function countIdentityDocs(row) {
  return [
    row?.national_id_front_url,
    row?.national_id_back_url,
    row?.driver_licence_url,
    row?.selfie_url,
    row?.selfie_with_id_card_url,
  ].filter(hasValue).length;
}

function countVehicleDocs(row) {
  const carPhotoArrayCount = safeJsonArrayCount(row?.car_photo_urls);
  const legacyCarPhotos = [row?.car_photo_front_url, row?.car_photo_rear_url].filter(hasValue).length;
  const bestCarPhotoCount = Math.max(carPhotoArrayCount, legacyCarPhotos);

  return (
    [
      row?.vehicle_registration_url,
      row?.vehicle_registration_book_url,
      row?.insurance_url,
      row?.zinara_url,
    ].filter(hasValue).length + bestCarPhotoCount
  );
}

async function run() {
  const userIdFilter = arg('user-id', '').trim();
  const submittedOnly = arg('submitted-only', 'true').trim().toLowerCase() !== 'false';
  const limit = Math.max(Number(arg('limit', '0')) || 0, 0);

  const identityWhere = userIdFilter ? 'WHERE driver_user_id = ?' : '';
  const vehicleWhere = userIdFilter ? 'WHERE driver_user_id = ?' : '';
  const params = userIdFilter ? [userIdFilter] : [];

  const [identityRows, vehicleRows] = await Promise.all([
    query(`SELECT * FROM driver_identity ${identityWhere} ORDER BY updated_at DESC`, params),
    query(`SELECT * FROM driver_vehicle ${vehicleWhere} ORDER BY updated_at DESC`, params),
  ]);

  const byUser = new Map();

  for (const row of identityRows) {
    const current = byUser.get(row.driver_user_id) || { driverUserId: row.driver_user_id };
    current.identity = row;
    byUser.set(row.driver_user_id, current);
  }

  for (const row of vehicleRows) {
    const current = byUser.get(row.driver_user_id) || { driverUserId: row.driver_user_id };
    current.vehicle = row;
    byUser.set(row.driver_user_id, current);
  }

  let rows = Array.from(byUser.values()).map((item) => {
    const identityDocCount = countIdentityDocs(item.identity);
    const vehicleDocCount = countVehicleDocs(item.vehicle);

    return {
      driverUserId: item.driverUserId,
      profileStatus: item.identity?.profile_status || null,
      vehicleStatus: item.vehicle?.vehicle_status || null,
      identitySubmittedAt: item.identity?.profile_submitted_at || null,
      vehicleSubmittedAt: item.vehicle?.vehicle_submitted_at || null,
      identityDocCount,
      vehicleDocCount,
      hasIdentityDocs: identityDocCount > 0,
      hasVehicleDocs: vehicleDocCount > 0,
      identityDocs: {
        nationalIdFrontUrl: item.identity?.national_id_front_url || null,
        nationalIdBackUrl: item.identity?.national_id_back_url || null,
        driverLicenceUrl: item.identity?.driver_licence_url || null,
        selfieUrl: item.identity?.selfie_url || null,
        selfieWithIdCardUrl: item.identity?.selfie_with_id_card_url || null,
      },
      vehicleDocs: {
        carPhotoFrontUrl: item.vehicle?.car_photo_front_url || null,
        carPhotoRearUrl: item.vehicle?.car_photo_rear_url || null,
        carPhotoUrls: item.vehicle?.car_photo_urls || null,
        vehicleRegistrationUrl: item.vehicle?.vehicle_registration_url || null,
        vehicleRegistrationBookUrl: item.vehicle?.vehicle_registration_book_url || null,
        insuranceUrl: item.vehicle?.insurance_url || null,
        zinaraUrl: item.vehicle?.zinara_url || null,
      },
    };
  });

  if (submittedOnly) {
    rows = rows.filter((row) => row.hasIdentityDocs || row.hasVehicleDocs);
  }

  rows.sort((a, b) => {
    const left = new Date(b.identitySubmittedAt || b.vehicleSubmittedAt || 0).getTime();
    const right = new Date(a.identitySubmittedAt || a.vehicleSubmittedAt || 0).getTime();
    return left - right;
  });

  if (limit > 0) {
    rows = rows.slice(0, limit);
  }

  console.log(
    JSON.stringify(
      {
        count: rows.length,
        rows,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
