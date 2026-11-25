ALTER TABLE users
  ADD COLUMN last_location_lat DECIMAL(10, 7) NULL DEFAULT NULL AFTER registration_detected_at,
  ADD COLUMN last_location_lng DECIMAL(10, 7) NULL DEFAULT NULL AFTER last_location_lat,
  ADD COLUMN last_location_accuracy_meters DECIMAL(10, 2) NULL DEFAULT NULL AFTER last_location_lng,
  ADD COLUMN last_location_recorded_at DATETIME NULL DEFAULT NULL AFTER last_location_accuracy_meters;
