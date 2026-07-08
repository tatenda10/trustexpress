import 'dotenv/config';
import { query } from '../db/connection.js';

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function print(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

async function main() {
  const email = String(getArg('email') || process.argv[2] || '').trim().toLowerCase();
  const force = getArg('force') === 'true';

  if (!email) {
    throw new Error(
      'Usage: node scripts/approve-driver-docs-by-email.js --email=someone@example.com [--force=true]'
    );
  }

  const users = await query(
    `SELECT id, clerk_user_id, email, role, phone_number, phone_verified_at
     FROM users
     WHERE LOWER(email) = ?
     LIMIT 5`,
    [email]
  );

  if (!users.length) {
    throw new Error(`No user found for email: ${email}`);
  }

  const driver = users.find((row) => String(row.role || '').toLowerCase() === 'driver') || users[0];
  if (String(driver.role || '').toLowerCase() !== 'driver') {
    throw new Error(`User ${email} exists but role is "${driver.role}", not driver`);
  }

  const driverUserId = driver.clerk_user_id;
  print('Driver', {
    email: driver.email,
    clerkUserId: driverUserId,
    phoneNumber: driver.phone_number || null,
    phoneVerifiedAt: driver.phone_verified_at || null,
  });

  const [identity] = await query(
    `SELECT *
     FROM driver_identity
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );

  const [vehicle] = await query(
    `SELECT *
     FROM driver_vehicle
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );

  const result = {
    email,
    driverUserId,
    identityApproved: false,
    vehicleApproved: false,
    warnings: [],
  };

  if (!identity) {
    result.warnings.push('No driver_identity row found — nothing to approve for identity docs.');
  } else {
    const missingIdentity = [
      !hasValue(identity.national_id_front_url) ? 'national_id_front_url' : null,
      !hasValue(identity.national_id_back_url) ? 'national_id_back_url' : null,
      !hasValue(identity.driver_licence_url) ? 'driver_licence_url' : null,
      !hasValue(identity.selfie_url) ? 'selfie_url' : null,
      !hasValue(identity.selfie_with_id_card_url) ? 'selfie_with_id_card_url' : null,
    ].filter(Boolean);

    print('Identity before', {
      profileStatus: identity.profile_status,
      submittedAt: identity.profile_submitted_at,
      missingDocs: missingIdentity,
    });

    if (missingIdentity.length && !force) {
      result.warnings.push(
        `Identity docs incomplete (${missingIdentity.join(', ')}). Pass --force=true to approve anyway.`
      );
    } else {
      await query(
        `UPDATE driver_identity
         SET profile_status = 'approved',
             profile_reviewed_at = CURRENT_TIMESTAMP,
             profile_rejection_reason = NULL,
             profile_can_resubmit = 1,
             phone_verified_at = COALESCE(phone_verified_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE driver_user_id = ?`,
        [driverUserId]
      );
      result.identityApproved = true;
    }
  }

  if (!vehicle) {
    result.warnings.push(
      'No driver_vehicle row found — vehicle docs cannot be approved until the driver submits a vehicle.'
    );
  } else {
    let carPhotoCount = 0;
    try {
      const parsed = vehicle.car_photo_urls ? JSON.parse(vehicle.car_photo_urls) : [];
      carPhotoCount = Array.isArray(parsed) ? parsed.filter(Boolean).length : 0;
    } catch {
      carPhotoCount = 0;
    }
    const hasEnoughPhotos =
      carPhotoCount >= 3 || (!!vehicle.car_photo_front_url && !!vehicle.car_photo_rear_url);

    const missingVehicle = [
      !(vehicle.vehicle_registration_book_url || vehicle.vehicle_registration_url)
        ? 'vehicle_registration_book_url'
        : null,
      !hasValue(vehicle.insurance_url) ? 'insurance_url' : null,
      !hasValue(vehicle.zinara_url) ? 'zinara_url' : null,
      !hasEnoughPhotos ? 'car_photos' : null,
    ].filter(Boolean);

    print('Vehicle before', {
      vehicleStatus: vehicle.vehicle_status,
      submittedAt: vehicle.vehicle_submitted_at,
      numberPlate: vehicle.number_plate,
      make: vehicle.make,
      model: vehicle.model,
      missingDocs: missingVehicle,
    });

    if (missingVehicle.length && !force) {
      result.warnings.push(
        `Vehicle docs incomplete (${missingVehicle.join(', ')}). Pass --force=true to approve anyway.`
      );
    } else {
      await query(
        `UPDATE driver_vehicle
         SET vehicle_status = 'approved',
             vehicle_reviewed_at = CURRENT_TIMESTAMP,
             vehicle_rejection_reason = NULL,
             vehicle_can_resubmit = 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE driver_user_id = ?`,
        [driverUserId]
      );
      result.vehicleApproved = true;
    }
  }

  const [identityAfter] = await query(
    `SELECT driver_user_id, profile_status, profile_reviewed_at, phone_verified_at
     FROM driver_identity
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );
  const [vehicleAfter] = await query(
    `SELECT driver_user_id, vehicle_status, vehicle_reviewed_at, number_plate, make, model
     FROM driver_vehicle
     WHERE driver_user_id = ?
     LIMIT 1`,
    [driverUserId]
  );

  print('Result', result);
  print('Identity after', identityAfter || 'No row');
  print('Vehicle after', vehicleAfter || 'No row');
  print(
    'Next step for app',
    result.identityApproved && !vehicleAfter
      ? 'Identity is approved. Driver must still register a vehicle, then that vehicle must be approved before they can go online.'
      : result.identityApproved && result.vehicleApproved
        ? 'Both identity and vehicle approved. Driver can open the app and reach DriverTabs (after phone verify if needed).'
        : 'Review warnings above.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\napprove-driver-docs-by-email failed:', error?.message || error);
    process.exit(1);
  });
