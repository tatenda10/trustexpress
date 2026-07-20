ALTER TABLE driver_wallet_settings
  MODIFY wallet_enabled TINYINT(1) NOT NULL DEFAULT 0;

UPDATE driver_wallet_settings
SET wallet_enabled = 0,
    payments_enabled = 0
WHERE id = 1;
