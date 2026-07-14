CREATE TABLE IF NOT EXISTS admin_ride_share_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ride_request_id BIGINT NOT NULL,
  ride_public_id VARCHAR(40) NULL,
  token VARCHAR(64) NOT NULL,
  scope ENUM('authority') NOT NULL DEFAULT 'authority',
  created_by_admin_id BIGINT NULL,
  created_by_admin_email VARCHAR(255) NULL,
  recipient_note VARCHAR(255) NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  last_viewed_at TIMESTAMP NULL DEFAULT NULL,
  view_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_admin_ride_share_links_token (token),
  KEY idx_admin_ride_share_links_ride (ride_request_id),
  KEY idx_admin_ride_share_links_active (ride_request_id, revoked_at, expires_at)
);
