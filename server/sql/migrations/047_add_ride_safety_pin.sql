ALTER TABLE ride_requests
  ADD COLUMN safety_pin_required TINYINT(1) NOT NULL DEFAULT 0 AFTER passenger_confirmed_at,
  ADD COLUMN safety_pin_hash VARCHAR(128) NULL DEFAULT NULL AFTER safety_pin_required,
  ADD COLUMN safety_pin_encrypted VARCHAR(128) NULL DEFAULT NULL AFTER safety_pin_hash,
  ADD COLUMN safety_pin_verified_at TIMESTAMP NULL DEFAULT NULL AFTER safety_pin_encrypted,
  ADD COLUMN safety_pin_attempts INT NOT NULL DEFAULT 0 AFTER safety_pin_verified_at;
