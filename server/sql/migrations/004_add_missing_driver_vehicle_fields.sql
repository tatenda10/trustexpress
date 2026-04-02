-- Safe additive migration: align existing DB with current backend expectations

-- 1) users: add phone verification fields if missing
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP NULL DEFAULT NULL;

-- 2) driver_profiles: add newer document/status columns if missing (keep old columns)
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS national_id_front_url VARCHAR(512) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS national_id_back_url VARCHAR(512) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS driver_licence_url VARCHAR(512) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP NULL DEFAULT NULL;

-- 3) vehicles: create missing table for phase 2 vehicle verification
CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  car_photo_front_url VARCHAR(512) DEFAULT NULL,
  car_photo_rear_url VARCHAR(512) DEFAULT NULL,
  number_plate VARCHAR(32) NOT NULL,
  make VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  color VARCHAR(32) DEFAULT NULL,
  vehicle_registration_url VARCHAR(512) NOT NULL,
  insurance_url VARCHAR(512) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  rejection_reason VARCHAR(500) DEFAULT NULL,
  submitted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY one_vehicle_per_user (user_id),
  INDEX idx_vehicle_status (status),
  CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);