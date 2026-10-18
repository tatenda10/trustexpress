CREATE TABLE IF NOT EXISTS driver_location_keys (
  driver_user_id VARCHAR(255) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (driver_user_id),
  UNIQUE KEY uk_driver_location_keys_hash (key_hash)
);
