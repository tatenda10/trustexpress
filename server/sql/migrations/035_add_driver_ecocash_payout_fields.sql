ALTER TABLE driver_identity
  ADD COLUMN ecocash_number VARCHAR(32) NULL DEFAULT NULL AFTER phone_verified_at,
  ADD COLUMN ecocash_registered_name VARCHAR(255) NULL DEFAULT NULL AFTER ecocash_number;
