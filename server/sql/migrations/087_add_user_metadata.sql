ALTER TABLE users
  ADD COLUMN public_metadata JSON NULL,
  ADD COLUMN private_metadata JSON NULL,
  ADD COLUMN unsafe_metadata JSON NULL,
  ADD COLUMN clerk_imported_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN last_sign_in_at TIMESTAMP NULL DEFAULT NULL,
  ADD INDEX idx_users_created (created_at);
