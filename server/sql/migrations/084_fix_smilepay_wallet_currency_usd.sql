ALTER TABLE driver_wallet_settings
  MODIFY currency VARCHAR(8) NOT NULL DEFAULT 'USD';

UPDATE driver_wallet_settings
SET currency = 'USD'
WHERE id = 1
  AND payment_provider = 'smilepay'
  AND currency <> 'USD';

