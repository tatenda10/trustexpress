ALTER TABLE ride_requests
  ADD COLUMN country_code CHAR(2) NOT NULL DEFAULT 'ZW' AFTER passenger_count,
  ADD COLUMN currency_code CHAR(3) NOT NULL DEFAULT 'USD' AFTER country_code;

UPDATE ride_requests
SET country_code = 'ZW', currency_code = 'USD'
WHERE country_code IS NULL OR currency_code IS NULL;

