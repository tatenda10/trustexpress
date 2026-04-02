-- Allow admin to block drivers from resubmitting after reject.
-- Run after 012_driver_identity_and_vehicle.sql.
-- If you get "Duplicate column name" error, the migration was already applied; skip.

ALTER TABLE driver_identity
  ADD COLUMN profile_can_resubmit TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE driver_vehicle
  ADD COLUMN vehicle_can_resubmit TINYINT(1) NOT NULL DEFAULT 1;
