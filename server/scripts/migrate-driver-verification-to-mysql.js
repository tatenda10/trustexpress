/**
 * Creates driver_identity and driver_vehicle tables and backfills from Clerk.
 * Run once: node server/scripts/migrate-driver-verification-to-mysql.js
 * Requires: DB_* env, CLERK_SECRET_KEY
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { getClerkClient } from '../lib/clerk-client.js';

const DRIVER_USER_ID_MAX_LEN = 255;

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  });

  try {
    console.log('Creating driver_identity table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS driver_identity (
        driver_user_id VARCHAR(${DRIVER_USER_ID_MAX_LEN}) PRIMARY KEY,
        national_id_front_url VARCHAR(512) DEFAULT NULL,
        national_id_back_url VARCHAR(512) DEFAULT NULL,
        driver_licence_url VARCHAR(512) DEFAULT NULL,
        selfie_url VARCHAR(512) DEFAULT NULL,
        profile_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        profile_submitted_at TIMESTAMP NULL DEFAULT NULL,
        profile_reviewed_at TIMESTAMP NULL DEFAULT NULL,
        profile_rejection_reason VARCHAR(500) DEFAULT NULL,
        phone_verified_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_profile_status (profile_status)
      )
    `);

    console.log('Creating driver_vehicle table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS driver_vehicle (
        driver_user_id VARCHAR(${DRIVER_USER_ID_MAX_LEN}) PRIMARY KEY,
        car_photo_front_url VARCHAR(512) DEFAULT NULL,
        car_photo_rear_url VARCHAR(512) DEFAULT NULL,
        car_photo_urls JSON DEFAULT NULL,
        vehicle_registration_url VARCHAR(512) DEFAULT NULL,
        vehicle_registration_book_url VARCHAR(512) DEFAULT NULL,
        insurance_url VARCHAR(512) DEFAULT NULL,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_vehicle_status (vehicle_status)
      )
    `);

    const clerk = getClerkClient();
    let total = 0;
    let backfilled = 0;
    let offset = 0;
    const limit = 25; // small batches to avoid memory limits on constrained hosts

    do {
      const page = await clerk.users.getUserList({ limit, offset, orderBy: '-created_at' });
      const users = page.data || [];
      if (users.length === 0) break;

      for (const user of users) {
        const role = (user.publicMetadata?.role || '').toLowerCase();
        if (role !== 'driver') continue;
        total += 1;

        const privateMeta = user.privateMetadata || {};
        const profile = privateMeta.driverProfile || null;
        const vehicle = privateMeta.vehicle || null;
        const phoneVerifiedAt = privateMeta.phoneVerifiedAt || null;

        if (profile) {
          const submittedAt = profile.submittedAt ? new Date(profile.submittedAt) : null;
          await connection.execute(
            `INSERT INTO driver_identity (
              driver_user_id, national_id_front_url, national_id_back_url, driver_licence_url, selfie_url,
              profile_status, profile_submitted_at, profile_reviewed_at, profile_rejection_reason, phone_verified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON DUPLICATE KEY UPDATE
              national_id_front_url = VALUES(national_id_front_url),
              national_id_back_url = VALUES(national_id_back_url),
              driver_licence_url = VALUES(driver_licence_url),
              selfie_url = VALUES(selfie_url),
              profile_status = VALUES(profile_status),
              profile_submitted_at = VALUES(profile_submitted_at),
              profile_rejection_reason = VALUES(profile_rejection_reason),
              phone_verified_at = COALESCE(VALUES(phone_verified_at), phone_verified_at),
              updated_at = CURRENT_TIMESTAMP`,
            [
              user.id,
              profile.nationalIdFrontUrl || null,
              profile.nationalIdBackUrl || null,
              profile.driverLicenceUrl || null,
              profile.selfieUrl || null,
              profile.status || 'pending',
              submittedAt,
              profile.rejectionReason || null,
              phoneVerifiedAt ? new Date(phoneVerifiedAt) : null,
            ]
          );
          backfilled += 1;
        } else if (phoneVerifiedAt) {
          await connection.execute(
            `INSERT INTO driver_identity (driver_user_id, phone_verified_at) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE phone_verified_at = COALESCE(VALUES(phone_verified_at), phone_verified_at), updated_at = CURRENT_TIMESTAMP`,
            [user.id, new Date(phoneVerifiedAt)]
          );
        }

        if (vehicle) {
          const carPhotoUrls = Array.isArray(vehicle.carPhotoUrls) ? vehicle.carPhotoUrls : [];
          const submittedAt = vehicle.submittedAt ? new Date(vehicle.submittedAt) : null;
          await connection.execute(
            `INSERT INTO driver_vehicle (
              driver_user_id, car_photo_front_url, car_photo_rear_url, car_photo_urls,
              vehicle_registration_url, vehicle_registration_book_url, insurance_url,
              number_plate, make, model, year, color, vehicle_tier_key, vehicle_tier_name,
              seat_count, door_count, vehicle_category,
              has_air_conditioning, has_charging_ports, has_wifi, has_leather_seats,
              has_large_luggage_space, has_sliding_doors, is_high_end,
              vehicle_status, vehicle_submitted_at, vehicle_reviewed_at, vehicle_rejection_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            ON DUPLICATE KEY UPDATE
              car_photo_front_url = VALUES(car_photo_front_url),
              car_photo_rear_url = VALUES(car_photo_rear_url),
              car_photo_urls = VALUES(car_photo_urls),
              vehicle_registration_url = VALUES(vehicle_registration_url),
              vehicle_registration_book_url = VALUES(vehicle_registration_book_url),
              insurance_url = VALUES(insurance_url),
              number_plate = VALUES(number_plate),
              make = VALUES(make),
              model = VALUES(model),
              year = VALUES(year),
              color = VALUES(color),
              vehicle_tier_key = VALUES(vehicle_tier_key),
              vehicle_tier_name = VALUES(vehicle_tier_name),
              seat_count = VALUES(seat_count),
              door_count = VALUES(door_count),
              vehicle_category = VALUES(vehicle_category),
              has_air_conditioning = VALUES(has_air_conditioning),
              has_charging_ports = VALUES(has_charging_ports),
              has_wifi = VALUES(has_wifi),
              has_leather_seats = VALUES(has_leather_seats),
              has_large_luggage_space = VALUES(has_large_luggage_space),
              has_sliding_doors = VALUES(has_sliding_doors),
              is_high_end = VALUES(is_high_end),
              vehicle_status = VALUES(vehicle_status),
              vehicle_submitted_at = VALUES(vehicle_submitted_at),
              vehicle_rejection_reason = VALUES(vehicle_rejection_reason),
              updated_at = CURRENT_TIMESTAMP`,
            [
              user.id,
              vehicle.carPhotoFrontUrl || carPhotoUrls[0] || null,
              vehicle.carPhotoRearUrl || carPhotoUrls[1] || null,
              JSON.stringify(carPhotoUrls),
              vehicle.vehicleRegistrationUrl || null,
              vehicle.vehicleRegistrationBookUrl || vehicle.vehicleRegistrationUrl || null,
              vehicle.insuranceUrl || null,
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
              vehicle.status || 'pending',
              submittedAt,
              vehicle.rejectionReason || null,
            ]
          );
        }
      }

      offset += users.length;
      if (users.length < limit) break;
    } while (true);

    console.log(`Migration done. Drivers with role=driver: ${total}. Rows backfilled: ${backfilled} identity, vehicle per driver.`);
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
