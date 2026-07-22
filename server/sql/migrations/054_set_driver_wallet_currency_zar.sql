ALTER TABLE driver_wallet_settings
  MODIFY currency VARCHAR(8) NOT NULL DEFAULT 'ZAR';

UPDATE driver_wallet_settings
SET currency = 'ZAR'
WHERE id = 1;
