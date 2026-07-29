-- Paystack transaction ids are numeric, but Smile&Pay returns alphanumeric
-- references (e.g. 'IVJV3336MEJJ'), which cannot fit in a BIGINT column.
-- Guarded so the migration is safe to re-run.
SET @has_legacy_column := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'driver_wallet_topups'
    AND COLUMN_NAME = 'paystack_transaction_id'
);

SET @stmt := IF(
  @has_legacy_column > 0,
  'ALTER TABLE driver_wallet_topups CHANGE COLUMN paystack_transaction_id provider_transaction_id VARCHAR(128) NULL DEFAULT NULL',
  'DO 0'
);

PREPARE apply_change FROM @stmt;

EXECUTE apply_change;

DEALLOCATE PREPARE apply_change;
