CREATE TABLE IF NOT EXISTS admin_push_broadcasts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id INT NULL,
  audience VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  target_count INT NOT NULL DEFAULT 0,
  expo_sent INT NOT NULL DEFAULT 0,
  fcm_sent INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_push_created (created_at)
);
