CREATE TABLE IF NOT EXISTS driver_push_tokens (
  driver_user_id VARCHAR(255) NOT NULL,
  expo_push_token VARCHAR(512) NULL DEFAULT NULL,
  fcm_token VARCHAR(512) NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (driver_user_id),
  KEY idx_driver_push_tokens_updated (updated_at)
);
