ALTER TABLE ride_requests
  ADD COLUMN passenger_count TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER passenger_phone;
