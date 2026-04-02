import 'dotenv/config';
import mysql from 'mysql2/promise';
import { getClerkClient } from '../lib/clerk-client.js';
import { toAppUser } from '../lib/clerk-user.js';

const DRIVER_USER_ID_MAX_LEN = 255;

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function ensureUsersTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clerk_user_id VARCHAR(${DRIVER_USER_ID_MAX_LEN}) NOT NULL UNIQUE,
      email VARCHAR(255) DEFAULT NULL,
      first_name VARCHAR(120) DEFAULT NULL,
      last_name VARCHAR(120) DEFAULT NULL,
      image_url VARCHAR(512) DEFAULT NULL,
      role ENUM('passenger', 'driver') NOT NULL DEFAULT 'passenger',
      phone_number VARCHAR(20) DEFAULT NULL,
      phone_verified_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clerk_user_id (clerk_user_id),
      INDEX idx_role (role)
    )
  `);

  const additiveColumns = [
    ['email', 'ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT NULL AFTER clerk_user_id'],
    ['first_name', 'ALTER TABLE users ADD COLUMN first_name VARCHAR(120) DEFAULT NULL AFTER email'],
    ['last_name', 'ALTER TABLE users ADD COLUMN last_name VARCHAR(120) DEFAULT NULL AFTER first_name'],
    ['image_url', 'ALTER TABLE users ADD COLUMN image_url VARCHAR(512) DEFAULT NULL AFTER last_name'],
    ['phone_number', 'ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) DEFAULT NULL AFTER role'],
    ['phone_verified_at', 'ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMP NULL DEFAULT NULL AFTER phone_number'],
  ];

  for (const [column, sql] of additiveColumns) {
    if (!(await columnExists(connection, 'users', column))) {
      await connection.execute(sql);
    }
  }
}

async function ensureDriverTables(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS driver_identity (
      driver_user_id VARCHAR(${DRIVER_USER_ID_MAX_LEN}) PRIMARY KEY,
      national_id_front_url VARCHAR(512) DEFAULT NULL,
      national_id_back_url VARCHAR(512) DEFAULT NULL,
      driver_licence_url VARCHAR(512) DEFAULT NULL,
      selfie_url VARCHAR(512) DEFAULT NULL,
      selfie_with_id_card_url VARCHAR(512) DEFAULT NULL,
      profile_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      profile_submitted_at TIMESTAMP NULL DEFAULT NULL,
      profile_reviewed_at TIMESTAMP NULL DEFAULT NULL,
      profile_rejection_reason VARCHAR(500) DEFAULT NULL,
      profile_can_resubmit TINYINT(1) NOT NULL DEFAULT 1,
      phone_verified_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_profile_status (profile_status)
    )
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS driver_vehicle (
      driver_user_id VARCHAR(${DRIVER_USER_ID_MAX_LEN}) PRIMARY KEY,
      car_photo_front_url VARCHAR(512) DEFAULT NULL,
      car_photo_rear_url VARCHAR(512) DEFAULT NULL,
      car_photo_urls JSON DEFAULT NULL,
      vehicle_registration_url VARCHAR(512) DEFAULT NULL,
      vehicle_registration_book_url VARCHAR(512) DEFAULT NULL,
      insurance_url VARCHAR(512) DEFAULT NULL,
      zinara_url VARCHAR(512) DEFAULT NULL,
      number_plate VARCHAR(64) DEFAULT NULL,
      make VARCHAR(128) DEFAULT NULL,
      model VARCHAR(128) DEFAULT NULL,
      year SMALLINT UNSIGNED DEFAULT NULL,
      color VARCHAR(64) DEFAULT NULL,
      vehicle_tier_key VARCHAR(64) DEFAULT NULL,
      vehicle_tier_name VARCHAR(128) DEFAULT NULL,
      seat_count SMALLINT UNSIGNED DEFAULT NULL,
      door_count SMALLINT UNSIGNED DEFAULT NULL,
      vehicle_category VARCHAR(64) DEFAULT NULL,
      has_air_conditioning TINYINT(1) NOT NULL DEFAULT 0,
      has_charging_ports TINYINT(1) NOT NULL DEFAULT 0,
      has_wifi TINYINT(1) NOT NULL DEFAULT 0,
      has_leather_seats TINYINT(1) NOT NULL DEFAULT 0,
      has_large_luggage_space TINYINT(1) NOT NULL DEFAULT 0,
      has_sliding_doors TINYINT(1) NOT NULL DEFAULT 0,
      is_high_end TINYINT(1) NOT NULL DEFAULT 0,
      vehicle_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      vehicle_submitted_at TIMESTAMP NULL DEFAULT NULL,
      vehicle_reviewed_at TIMESTAMP NULL DEFAULT NULL,
      vehicle_rejection_reason VARCHAR(500) DEFAULT NULL,
      vehicle_can_resubmit TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_vehicle_status (vehicle_status)
    )
  `);

  const driverIdentityColumns = [
    ['selfie_with_id_card_url', 'ALTER TABLE driver_identity ADD COLUMN selfie_with_id_card_url VARCHAR(512) DEFAULT NULL AFTER selfie_url'],
    ['profile_can_resubmit', 'ALTER TABLE driver_identity ADD COLUMN profile_can_resubmit TINYINT(1) NOT NULL DEFAULT 1 AFTER profile_rejection_reason'],
    ['phone_verified_at', 'ALTER TABLE driver_identity ADD COLUMN phone_verified_at TIMESTAMP NULL DEFAULT NULL AFTER profile_can_resubmit'],
  ];

  for (const [column, sql] of driverIdentityColumns) {
    if (!(await columnExists(connection, 'driver_identity', column))) {
      await connection.execute(sql);
    }
  }

  const driverVehicleColumns = [
    ['zinara_url', 'ALTER TABLE driver_vehicle ADD COLUMN zinara_url VARCHAR(512) DEFAULT NULL AFTER insurance_url'],
    ['vehicle_can_resubmit', 'ALTER TABLE driver_vehicle ADD COLUMN vehicle_can_resubmit TINYINT(1) NOT NULL DEFAULT 1 AFTER vehicle_rejection_reason'],
  ];

  for (const [column, sql] of driverVehicleColumns) {
    if (!(await columnExists(connection, 'driver_vehicle', column))) {
      await connection.execute(sql);
    }
  }
}

async function upsertUser(connection, appUser) {
  await connection.execute(
    `INSERT INTO users (
      clerk_user_id,
      email,
      first_name,
      last_name,
      image_url,
      role,
      phone_number,
      phone_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      image_url = VALUES(image_url),
      role = VALUES(role),
      phone_number = VALUES(phone_number),
      phone_verified_at = VALUES(phone_verified_at),
      updated_at = CURRENT_TIMESTAMP`,
    [
      appUser.clerk_user_id,
      appUser.email,
      appUser.first_name,
      appUser.last_name,
      appUser.image_url,
      appUser.role,
      appUser.phone_number,
      appUser.phone_verified_at ? new Date(appUser.phone_verified_at) : null,
    ]
  );
}

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  });

  try {
    await ensureUsersTable(connection);
    await ensureDriverTables(connection);

    const clerk = getClerkClient();
    let offset = 0;
    const limit = 100;
    let totalDrivers = 0;
    let approvedIdentity = 0;
    let approvedVehicle = 0;

    do {
      const page = await clerk.users.getUserList({ limit, offset, orderBy: '-created_at' });
      const users = page.data || [];
      if (users.length === 0) break;

      for (const user of users) {
        const appUser = toAppUser(user);
        if (appUser.role !== 'driver') continue;

        totalDrivers += 1;
        await upsertUser(connection, appUser);

        const privateMeta = user.privateMetadata || {};
        const profile = privateMeta.driverProfile || {};
        const vehicle = privateMeta.vehicle || {};
        const phoneVerifiedAt = appUser.phone_verified_at ? new Date(appUser.phone_verified_at) : new Date();
        const submittedAt = profile.submittedAt ? new Date(profile.submittedAt) : new Date();
        const vehicleSubmittedAt = vehicle.submittedAt ? new Date(vehicle.submittedAt) : new Date();
        const vehiclePhotos = Array.isArray(vehicle.carPhotoUrls) ? vehicle.carPhotoUrls : [];

        await connection.execute(
          `INSERT INTO driver_identity (
            driver_user_id,
            national_id_front_url,
            national_id_back_url,
            driver_licence_url,
            selfie_url,
            selfie_with_id_card_url,
            profile_status,
            profile_submitted_at,
            profile_reviewed_at,
            profile_rejection_reason,
            profile_can_resubmit,
            phone_verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP, NULL, 1, ?)
          ON DUPLICATE KEY UPDATE
            national_id_front_url = COALESCE(VALUES(national_id_front_url), national_id_front_url),
            national_id_back_url = COALESCE(VALUES(national_id_back_url), national_id_back_url),
            driver_licence_url = COALESCE(VALUES(driver_licence_url), driver_licence_url),
            selfie_url = COALESCE(VALUES(selfie_url), selfie_url),
            selfie_with_id_card_url = COALESCE(VALUES(selfie_with_id_card_url), selfie_with_id_card_url),
            profile_status = 'approved',
            profile_submitted_at = COALESCE(profile_submitted_at, VALUES(profile_submitted_at)),
            profile_reviewed_at = CURRENT_TIMESTAMP,
            profile_rejection_reason = NULL,
            profile_can_resubmit = 1,
            phone_verified_at = COALESCE(phone_verified_at, VALUES(phone_verified_at)),
            updated_at = CURRENT_TIMESTAMP`,
          [
            user.id,
            profile.nationalIdFrontUrl || null,
            profile.nationalIdBackUrl || null,
            profile.driverLicenceUrl || null,
            profile.selfieUrl || null,
            profile.selfieWithIdCardUrl || null,
            submittedAt,
            phoneVerifiedAt,
          ]
        );
        approvedIdentity += 1;

        await connection.execute(
          `INSERT INTO driver_vehicle (
            driver_user_id,
            car_photo_front_url,
            car_photo_rear_url,
            car_photo_urls,
            vehicle_registration_url,
            vehicle_registration_book_url,
            insurance_url,
            zinara_url,
            number_plate,
            make,
            model,
            year,
            color,
            vehicle_tier_key,
            vehicle_tier_name,
            seat_count,
            door_count,
            vehicle_category,
            has_air_conditioning,
            has_charging_ports,
            has_wifi,
            has_leather_seats,
            has_large_luggage_space,
            has_sliding_doors,
            is_high_end,
            vehicle_status,
            vehicle_submitted_at,
            vehicle_reviewed_at,
            vehicle_rejection_reason,
            vehicle_can_resubmit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP, NULL, 1)
          ON DUPLICATE KEY UPDATE
            car_photo_front_url = COALESCE(VALUES(car_photo_front_url), car_photo_front_url),
            car_photo_rear_url = COALESCE(VALUES(car_photo_rear_url), car_photo_rear_url),
            car_photo_urls = COALESCE(VALUES(car_photo_urls), car_photo_urls),
            vehicle_registration_url = COALESCE(VALUES(vehicle_registration_url), vehicle_registration_url),
            vehicle_registration_book_url = COALESCE(VALUES(vehicle_registration_book_url), vehicle_registration_book_url),
            insurance_url = COALESCE(VALUES(insurance_url), insurance_url),
            zinara_url = COALESCE(VALUES(zinara_url), zinara_url),
            number_plate = COALESCE(VALUES(number_plate), number_plate),
            make = COALESCE(VALUES(make), make),
            model = COALESCE(VALUES(model), model),
            year = COALESCE(VALUES(year), year),
            color = COALESCE(VALUES(color), color),
            vehicle_tier_key = COALESCE(VALUES(vehicle_tier_key), vehicle_tier_key),
            vehicle_tier_name = COALESCE(VALUES(vehicle_tier_name), vehicle_tier_name),
            seat_count = COALESCE(VALUES(seat_count), seat_count),
            door_count = COALESCE(VALUES(door_count), door_count),
            vehicle_category = COALESCE(VALUES(vehicle_category), vehicle_category),
            has_air_conditioning = GREATEST(has_air_conditioning, VALUES(has_air_conditioning)),
            has_charging_ports = GREATEST(has_charging_ports, VALUES(has_charging_ports)),
            has_wifi = GREATEST(has_wifi, VALUES(has_wifi)),
            has_leather_seats = GREATEST(has_leather_seats, VALUES(has_leather_seats)),
            has_large_luggage_space = GREATEST(has_large_luggage_space, VALUES(has_large_luggage_space)),
            has_sliding_doors = GREATEST(has_sliding_doors, VALUES(has_sliding_doors)),
            is_high_end = GREATEST(is_high_end, VALUES(is_high_end)),
            vehicle_status = 'approved',
            vehicle_submitted_at = COALESCE(vehicle_submitted_at, VALUES(vehicle_submitted_at)),
            vehicle_reviewed_at = CURRENT_TIMESTAMP,
            vehicle_rejection_reason = NULL,
            vehicle_can_resubmit = 1,
            updated_at = CURRENT_TIMESTAMP`,
          [
            user.id,
            vehicle.carPhotoFrontUrl || vehiclePhotos[0] || null,
            vehicle.carPhotoRearUrl || vehiclePhotos[1] || null,
            vehiclePhotos.length > 0 ? JSON.stringify(vehiclePhotos) : null,
            vehicle.vehicleRegistrationUrl || null,
            vehicle.vehicleRegistrationBookUrl || vehicle.vehicleRegistrationUrl || null,
            vehicle.insuranceUrl || null,
            vehicle.zinaraUrl || null,
            vehicle.numberPlate || null,
            vehicle.make || null,
            vehicle.model || null,
            vehicle.year ?? null,
            vehicle.color || null,
            vehicle.vehicleTierKey || null,
            vehicle.vehicleTierName || null,
            vehicle.seatCount ?? null,
            vehicle.doorCount ?? null,
            vehicle.vehicleCategory || null,
            vehicle.hasAirConditioning ? 1 : 0,
            vehicle.hasChargingPorts ? 1 : 0,
            vehicle.hasWifi ? 1 : 0,
            vehicle.hasLeatherSeats ? 1 : 0,
            vehicle.hasLargeLuggageSpace ? 1 : 0,
            vehicle.hasSlidingDoors ? 1 : 0,
            vehicle.isHighEnd ? 1 : 0,
            vehicleSubmittedAt,
          ]
        );
        approvedVehicle += 1;
      }

      offset += users.length;
      if (users.length < limit) break;
    } while (true);

    console.log(`Driver verification recovery complete. Drivers processed: ${totalDrivers}. Identity approved: ${approvedIdentity}. Vehicle approved: ${approvedVehicle}.`);
    console.log('Note: this marks drivers as approved, but it cannot restore document URLs that no longer exist in Clerk metadata.');
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Failed to mark all drivers verified:', error);
  process.exit(1);
});
