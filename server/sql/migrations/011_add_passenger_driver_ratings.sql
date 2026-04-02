ALTER TABLE ride_requests
ADD COLUMN passenger_driver_rating TINYINT NULL DEFAULT NULL,
ADD COLUMN passenger_driver_review TEXT NULL,
ADD COLUMN passenger_driver_rated_at TIMESTAMP NULL DEFAULT NULL;
