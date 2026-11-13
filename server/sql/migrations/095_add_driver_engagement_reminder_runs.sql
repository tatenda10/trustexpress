CREATE TABLE IF NOT EXISTS driver_engagement_reminder_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reminder_date DATE NOT NULL,
  reminder_slot VARCHAR(32) NOT NULL,
  scheduled_time TIME NOT NULL,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  target_count INT UNSIGNED NOT NULL DEFAULT 0,
  fcm_sent INT UNSIGNED NOT NULL DEFAULT 0,
  expo_sent INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL DEFAULT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_engagement_reminder_slot (reminder_date, reminder_slot),
  KEY idx_driver_engagement_reminder_started (started_at)
);
