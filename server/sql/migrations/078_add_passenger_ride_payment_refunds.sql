ALTER TABLE passenger_ride_payments
  ADD COLUMN refund_status VARCHAR(32) NULL DEFAULT NULL AFTER payout_status,
  ADD COLUMN refund_method VARCHAR(64) NULL DEFAULT NULL AFTER refund_status,
  ADD COLUMN refunded_at TIMESTAMP NULL DEFAULT NULL AFTER refund_method,
  ADD COLUMN wallet_reversal_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER wallet_credit_transaction_id,
  ADD COLUMN raw_refund_payload JSON NULL DEFAULT NULL AFTER raw_payout_payload;
