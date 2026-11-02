SET @opened_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_request_driver_responses'
    AND COLUMN_NAME = 'opened_at'
);
SET @opened_at_sql = IF(
  @opened_at_exists = 0,
  'ALTER TABLE ride_request_driver_responses ADD COLUMN opened_at TIMESTAMP NULL DEFAULT NULL AFTER viewed_at, ADD KEY idx_rrdr_opened_at (opened_at)',
  'SELECT 1'
);
PREPARE opened_at_stmt FROM @opened_at_sql;
EXECUTE opened_at_stmt;
DEALLOCATE PREPARE opened_at_stmt;

SET @accepted_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_request_driver_responses'
    AND COLUMN_NAME = 'accepted_at'
);
SET @accepted_at_sql = IF(
  @accepted_at_exists = 0,
  'ALTER TABLE ride_request_driver_responses ADD COLUMN accepted_at TIMESTAMP NULL DEFAULT NULL AFTER opened_at, ADD KEY idx_rrdr_accepted_at (accepted_at)',
  'SELECT 1'
);
PREPARE accepted_at_stmt FROM @accepted_at_sql;
EXECUTE accepted_at_stmt;
DEALLOCATE PREPARE accepted_at_stmt;

CREATE TABLE IF NOT EXISTS driver_response_policy_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  missed_threshold INT UNSIGNED NOT NULL DEFAULT 7,
  window_hours INT UNSIGNED NOT NULL DEFAULT 24,
  restriction_duration_hours INT UNSIGNED NOT NULL DEFAULT 12,
  restriction_scope VARCHAR(30) NOT NULL DEFAULT 'accept_rides',
  updated_by_admin_id BIGINT NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

INSERT IGNORE INTO driver_response_policy_settings (
  id,
  is_enabled,
  missed_threshold,
  window_hours,
  restriction_duration_hours,
  restriction_scope
) VALUES (1, 1, 7, 24, 12, 'accept_rides');

CREATE TABLE IF NOT EXISTS driver_response_policy_actions (
  id BIGINT NOT NULL AUTO_INCREMENT,
  driver_user_id VARCHAR(255) NOT NULL,
  triggering_response_id BIGINT NOT NULL,
  missed_count INT UNSIGNED NOT NULL,
  threshold_value INT UNSIGNED NOT NULL,
  window_hours INT UNSIGNED NOT NULL,
  restriction_duration_hours INT UNSIGNED NOT NULL,
  restriction_scope VARCHAR(30) NOT NULL,
  restriction_id BIGINT NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_driver_response_policy_trigger (driver_user_id, triggering_response_id),
  KEY idx_driver_response_policy_driver (driver_user_id, created_at),
  KEY idx_driver_response_policy_created (created_at)
);
