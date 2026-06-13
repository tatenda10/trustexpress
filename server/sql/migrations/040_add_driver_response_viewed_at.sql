ALTER TABLE ride_request_driver_responses
  ADD COLUMN viewed_at TIMESTAMP NULL DEFAULT NULL AFTER responded_at,
  ADD KEY idx_rrdr_viewed_at (viewed_at);
