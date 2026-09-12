ALTER TABLE hire_requests
  ADD COLUMN payment_method VARCHAR(16) NULL DEFAULT NULL AFTER fare_currency;
