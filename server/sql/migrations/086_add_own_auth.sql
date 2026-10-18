ALTER TABLE users
  ADD COLUMN password_hash VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN password_updated_at TIMESTAMP NULL DEFAULT NULL,
  ADD INDEX idx_users_email_role (email, role),
  ADD INDEX idx_users_phone_role (phone_number, role);

-- Existing accounts came through Clerk, which verified the email at sign-up.
UPDATE users
SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP)
WHERE email IS NOT NULL
  AND email <> ''
  AND email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(32) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  previous_token_hash CHAR(64) NULL DEFAULT NULL,
  rotated_at TIMESTAMP NULL DEFAULT NULL,
  device_name VARCHAR(120) NULL DEFAULT NULL,
  platform VARCHAR(20) NULL DEFAULT NULL,
  ip_address VARCHAR(64) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  revoked_reason VARCHAR(40) NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_sessions_refresh (refresh_token_hash),
  KEY idx_auth_sessions_user (user_id, revoked_at)
);

CREATE TABLE IF NOT EXISTS auth_codes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  purpose VARCHAR(30) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  role VARCHAR(20) NULL DEFAULT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  ip_address VARCHAR(64) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_auth_codes_lookup (destination, purpose, created_at),
  KEY idx_auth_codes_ip (ip_address, created_at)
);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  identifier VARCHAR(255) NOT NULL,
  ip_address VARCHAR(64) NULL DEFAULT NULL,
  succeeded TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_auth_login_attempts_identifier (identifier, created_at),
  KEY idx_auth_login_attempts_ip (ip_address, created_at)
);
