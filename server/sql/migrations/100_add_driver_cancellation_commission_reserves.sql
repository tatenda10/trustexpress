ALTER TABLE driver_wallet_transactions
  MODIFY COLUMN transaction_type ENUM(
    'top_up_credit',
    'commission_debit',
    'manual_credit',
    'manual_debit',
    'captain_promo_credit',
    'promo_commission_debit',
    'cancellation_reserve_hold',
    'promo_cancellation_reserve_hold',
    'cancellation_reserve_refund',
    'promo_cancellation_reserve_refund'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS driver_cancellation_commission_reserves (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ride_request_id BIGINT NOT NULL,
  ride_public_id VARCHAR(64) NULL DEFAULT NULL,
  driver_user_id VARCHAR(255) NOT NULL,
  passenger_user_id VARCHAR(255) NULL DEFAULT NULL,
  fare_amount DECIMAL(12,2) NOT NULL,
  commission_rate_percent DECIMAL(5,2) NOT NULL,
  reserved_amount DECIMAL(12,2) NOT NULL,
  cash_reserved_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  promotional_reserved_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  cancellation_reason VARCHAR(255) NULL DEFAULT NULL,
  ride_status_before_cancel VARCHAR(32) NULL DEFAULT NULL,
  status ENUM('pending', 'refunded', 'captured') NOT NULL DEFAULT 'pending',
  cash_hold_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  promotional_hold_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  cash_refund_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  promotional_refund_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  reviewed_by_admin_id INT NULL DEFAULT NULL,
  reviewed_by_admin_name VARCHAR(255) NULL DEFAULT NULL,
  review_note TEXT NULL,
  reviewed_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_driver_cancellation_reserve_ride (ride_request_id),
  KEY idx_driver_cancellation_reserve_status (status, created_at),
  KEY idx_driver_cancellation_reserve_driver (driver_user_id, created_at)
);
