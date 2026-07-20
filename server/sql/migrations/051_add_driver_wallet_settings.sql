CREATE TABLE IF NOT EXISTS driver_wallet_settings (
  id TINYINT NOT NULL PRIMARY KEY,
  wallet_enabled TINYINT(1) NOT NULL DEFAULT 0,
  minimum_balance_usd DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  commission_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 9.50,
  topup_min_amount DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  topup_max_amount DECIMAL(12,2) NOT NULL DEFAULT 500.00,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  updated_by_admin_id INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO driver_wallet_settings (
  id,
  wallet_enabled,
  minimum_balance_usd,
  commission_rate_percent,
  topup_min_amount,
  topup_max_amount,
  currency
)
SELECT
  1,
  0,
  1.00,
  9.50,
  1.00,
  500.00,
  'USD'
WHERE NOT EXISTS (
  SELECT 1 FROM driver_wallet_settings WHERE id = 1
);
