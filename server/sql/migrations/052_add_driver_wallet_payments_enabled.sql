ALTER TABLE driver_wallet_settings
  ADD COLUMN payments_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER wallet_enabled;

UPDATE driver_wallet_settings
SET payments_enabled = 0
WHERE id = 1;
