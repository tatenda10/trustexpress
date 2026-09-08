ALTER TABLE passenger_identity
  ADD COLUMN date_of_birth DATE NULL DEFAULT NULL AFTER selfie_url,
  ADD COLUMN gender VARCHAR(16) NULL DEFAULT NULL AFTER date_of_birth,
  ADD COLUMN national_id_number VARCHAR(64) NULL DEFAULT NULL AFTER gender,
  ADD COLUMN smile_cash_mobile VARCHAR(32) NULL DEFAULT NULL AFTER national_id_number,
  ADD COLUMN smile_cash_status VARCHAR(32) NULL DEFAULT NULL AFTER smile_cash_mobile,
  ADD COLUMN smile_cash_opened_at DATETIME NULL DEFAULT NULL AFTER smile_cash_status,
  ADD COLUMN smile_cash_last_error TEXT NULL DEFAULT NULL AFTER smile_cash_opened_at;

ALTER TABLE ride_requests
  ADD COLUMN payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid' AFTER tip_amount,
  ADD COLUMN payment_provider VARCHAR(32) NULL DEFAULT NULL AFTER payment_status,
  ADD COLUMN payment_reference VARCHAR(128) NULL DEFAULT NULL AFTER payment_provider,
  ADD COLUMN payment_method VARCHAR(64) NULL DEFAULT NULL AFTER payment_reference,
  ADD COLUMN paid_at TIMESTAMP NULL DEFAULT NULL AFTER payment_method;

CREATE TABLE IF NOT EXISTS passenger_ride_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference VARCHAR(128) NOT NULL,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  passenger_user_id VARCHAR(255) NOT NULL,
  driver_user_id VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  provider VARCHAR(32) NOT NULL DEFAULT 'smilepay',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(64) NULL DEFAULT NULL,
  provider_transaction_id VARCHAR(128) NULL DEFAULT NULL,
  receiver_mobile VARCHAR(32) NULL DEFAULT NULL,
  payout_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  wallet_credit_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  payout_auth_transaction_id VARCHAR(128) NULL DEFAULT NULL,
  payout_payment_transaction_id VARCHAR(128) NULL DEFAULT NULL,
  error_message TEXT NULL DEFAULT NULL,
  raw_initialize_payload JSON NULL DEFAULT NULL,
  raw_verify_payload JSON NULL DEFAULT NULL,
  raw_payout_payload JSON NULL DEFAULT NULL,
  paid_at TIMESTAMP NULL DEFAULT NULL,
  paid_out_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_passenger_ride_payments_reference (reference),
  KEY idx_passenger_ride_payments_ride (ride_request_id),
  KEY idx_passenger_ride_payments_passenger (passenger_user_id),
  KEY idx_passenger_ride_payments_driver (driver_user_id),
  KEY idx_passenger_ride_payments_status (status)
);
