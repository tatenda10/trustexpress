ALTER TABLE driver_wallet_settings
  ADD COLUMN payment_provider VARCHAR(32) NOT NULL DEFAULT 'paystack'
  AFTER payments_enabled;

UPDATE driver_wallet_settings
SET payment_provider = 'paystack'
WHERE id = 1
  AND (payment_provider IS NULL OR payment_provider = '');
