CREATE TABLE IF NOT EXISTS user_role_change_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  clerk_user_id VARCHAR(255) NOT NULL,
  previous_role VARCHAR(32) NULL,
  new_role VARCHAR(32) NOT NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'system',
  reason VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_role_change_user_created (clerk_user_id, created_at),
  KEY idx_user_role_change_source_created (source, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
