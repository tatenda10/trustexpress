ALTER TABLE ride_requests
  ADD COLUMN passenger_confirmed_at TIMESTAMP NULL DEFAULT NULL AFTER arrived_at;