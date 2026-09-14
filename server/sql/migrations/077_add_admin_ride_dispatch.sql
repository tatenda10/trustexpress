ALTER TABLE ride_requests
  ADD COLUMN booking_source VARCHAR(32) NOT NULL DEFAULT 'app' AFTER payment_method,
  ADD COLUMN dispatched_by_admin_id INT NULL AFTER booking_source;

CREATE INDEX idx_ride_requests_booking_source ON ride_requests (booking_source);
