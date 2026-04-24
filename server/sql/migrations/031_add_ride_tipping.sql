ALTER TABLE ride_requests
  ADD COLUMN tip_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER estimated_amount,
  ADD COLUMN tipped_at TIMESTAMP NULL DEFAULT NULL AFTER tip_amount;
