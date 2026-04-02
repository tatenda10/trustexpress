-- Driver verification tables (identity docs + vehicle). Run in phpMyAdmin or MySQL console.
-- Database: bnvcjddh_trust_express (or your DB_NAME)

CREATE TABLE IF NOT EXISTS driver_identity (
  driver_user_id VARCHAR(255) PRIMARY KEY,
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
);

CREATE TABLE IF NOT EXISTS driver_vehicle (
  driver_user_id VARCHAR(255) PRIMARY KEY,
  car_photo_front_url VARCHAR(512) DEFAULT NULL,
  car_photo_rear_url VARCHAR(512) DEFAULT NULL,
  car_photo_urls TEXT DEFAULT NULL,
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
);
