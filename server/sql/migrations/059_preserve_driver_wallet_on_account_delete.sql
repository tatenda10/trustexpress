-- Preserve wallet audit trail after driver account deletion.
ALTER TABLE driver_wallets
  ADD COLUMN owner_email VARCHAR(255) NULL AFTER available_balance,
  ADD COLUMN owner_full_name VARCHAR(255) NULL AFTER owner_email,
  ADD COLUMN account_deleted_at TIMESTAMP NULL DEFAULT NULL AFTER owner_full_name;

CREATE INDEX idx_driver_wallets_owner_email ON driver_wallets (owner_email);
CREATE INDEX idx_driver_wallets_account_deleted_at ON driver_wallets (account_deleted_at);
