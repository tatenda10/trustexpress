CREATE TABLE IF NOT EXISTS driver_wallets (
  driver_user_id VARCHAR(255) NOT NULL PRIMARY KEY,
  available_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS driver_wallet_topups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  driver_user_id VARCHAR(255) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'paystack',
  reference VARCHAR(64) NOT NULL,
  requested_amount DECIMAL(12,2) NOT NULL,
  credited_amount DECIMAL(12,2) NULL DEFAULT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status ENUM('pending', 'success', 'failed', 'abandoned', 'cancelled') NOT NULL DEFAULT 'pending',
  paystack_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  authorization_url TEXT NULL,
  access_code VARCHAR(128) NULL DEFAULT NULL,
  payment_method VARCHAR(64) NULL DEFAULT NULL,
  paid_at TIMESTAMP NULL DEFAULT NULL,
  verified_at TIMESTAMP NULL DEFAULT NULL,
  raw_initialize_payload JSON NULL,
  raw_verify_payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_driver_wallet_topups_reference (reference),
  KEY idx_driver_wallet_topups_driver (driver_user_id, created_at),
  KEY idx_driver_wallet_topups_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS driver_wallet_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  driver_user_id VARCHAR(255) NOT NULL,
  transaction_type ENUM('top_up_credit', 'commission_debit', 'manual_credit', 'manual_debit') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(64) NULL DEFAULT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(128) NULL DEFAULT NULL,
  trip_id BIGINT NULL DEFAULT NULL,
  passenger_user_id VARCHAR(255) NULL DEFAULT NULL,
  passenger_name VARCHAR(255) NULL DEFAULT NULL,
  trip_fare_amount DECIMAL(12,2) NULL DEFAULT NULL,
  commission_rate_percent DECIMAL(5,2) NULL DEFAULT NULL,
  balance_before DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  provider_reference VARCHAR(128) NULL DEFAULT NULL,
  external_transaction_id VARCHAR(128) NULL DEFAULT NULL,
  description VARCHAR(255) NULL DEFAULT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_driver_wallet_transactions_driver (driver_user_id, created_at),
  KEY idx_driver_wallet_transactions_trip (trip_id),
  UNIQUE KEY uk_driver_wallet_commission_source (driver_user_id, source_type, source_id)
);
