-- Driver can rate passenger after completed trip.
-- Run after 011. If "Duplicate column" error, skip.

ALTER TABLE ride_requests
  ADD COLUMN driver_passenger_rating TINYINT NULL DEFAULT NULL,
  ADD COLUMN driver_passenger_review TEXT NULL,
  ADD COLUMN driver_passenger_rated_at TIMESTAMP NULL DEFAULT NULL;


ALTER TABLE driver_identity
  ADD COLUMN profile_can_resubmit TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE driver_vehicle
  ADD COLUMN vehicle_can_resubmit TINYINT(1) NOT NULL DEFAULT 1;
