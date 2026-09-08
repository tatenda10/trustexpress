ALTER TABLE driver_identity
  ADD COLUMN date_of_birth DATE NULL DEFAULT NULL AFTER ecocash_registered_name,
  ADD COLUMN gender VARCHAR(16) NULL DEFAULT NULL AFTER date_of_birth,
  ADD COLUMN smile_cash_mobile VARCHAR(32) NULL DEFAULT NULL AFTER gender,
  ADD COLUMN smile_cash_status VARCHAR(32) NULL DEFAULT NULL AFTER smile_cash_mobile,
  ADD COLUMN smile_cash_opened_at DATETIME NULL DEFAULT NULL AFTER smile_cash_status,
  ADD COLUMN smile_cash_last_error TEXT NULL DEFAULT NULL AFTER smile_cash_opened_at;

CREATE TABLE IF NOT EXISTS smile_cash_payouts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(32) NOT NULL,
  driver_user_id VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  receiver_mobile VARCHAR(32) NOT NULL,
  narration VARCHAR(255) NULL DEFAULT NULL,
  purpose VARCHAR(64) NULL DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  auth_transaction_id VARCHAR(128) NULL DEFAULT NULL,
  payment_transaction_id VARCHAR(128) NULL DEFAULT NULL,
  provider_payload JSON NULL,
  error_message TEXT NULL,
  created_by_admin_id BIGINT UNSIGNED NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL DEFAULT NULL,
  UNIQUE KEY uniq_smile_cash_payouts_public_id (public_id),
  KEY idx_smile_cash_payouts_driver (driver_user_id),
  KEY idx_smile_cash_payouts_status (status),
  KEY idx_smile_cash_payouts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
