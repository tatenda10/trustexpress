SET @online_at_offer_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_request_driver_responses'
    AND COLUMN_NAME = 'online_at_offer'
);
SET @online_at_offer_sql = IF(
  @online_at_offer_exists = 0,
  'ALTER TABLE ride_request_driver_responses ADD COLUMN online_at_offer TINYINT(1) NULL DEFAULT NULL AFTER accepted_at',
  'SELECT 1'
);
PREPARE online_at_offer_stmt FROM @online_at_offer_sql;
EXECUTE online_at_offer_stmt;
DEALLOCATE PREPARE online_at_offer_stmt;

SET @recently_active_at_offer_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_request_driver_responses'
    AND COLUMN_NAME = 'recently_active_at_offer'
);
SET @recently_active_at_offer_sql = IF(
  @recently_active_at_offer_exists = 0,
  'ALTER TABLE ride_request_driver_responses ADD COLUMN recently_active_at_offer TINYINT(1) NULL DEFAULT NULL AFTER online_at_offer',
  'SELECT 1'
);
PREPARE recently_active_at_offer_stmt FROM @recently_active_at_offer_sql;
EXECUTE recently_active_at_offer_stmt;
DEALLOCATE PREPARE recently_active_at_offer_stmt;

SET @last_seen_at_offer_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_request_driver_responses'
    AND COLUMN_NAME = 'last_seen_at_offer'
);
SET @last_seen_at_offer_sql = IF(
  @last_seen_at_offer_exists = 0,
  'ALTER TABLE ride_request_driver_responses ADD COLUMN last_seen_at_offer TIMESTAMP NULL DEFAULT NULL AFTER recently_active_at_offer',
  'SELECT 1'
);
PREPARE last_seen_at_offer_stmt FROM @last_seen_at_offer_sql;
EXECUTE last_seen_at_offer_stmt;
DEALLOCATE PREPARE last_seen_at_offer_stmt;
