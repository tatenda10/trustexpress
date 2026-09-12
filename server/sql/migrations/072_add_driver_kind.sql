ALTER TABLE driver_identity
  ADD COLUMN driver_kind VARCHAR(16) NULL DEFAULT NULL AFTER driver_user_id;
