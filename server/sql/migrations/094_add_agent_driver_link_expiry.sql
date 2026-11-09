SET @linked_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND COLUMN_NAME = 'linked_at'
);
SET @linked_at_sql = IF(
  @linked_at_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD COLUMN linked_at TIMESTAMP NULL DEFAULT NULL AFTER source',
  'SELECT 1'
);
PREPARE linked_at_stmt FROM @linked_at_sql;
EXECUTE linked_at_stmt;
DEALLOCATE PREPARE linked_at_stmt;

SET @expires_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND COLUMN_NAME = 'expires_at'
);
SET @expires_at_sql = IF(
  @expires_at_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL AFTER linked_at',
  'SELECT 1'
);
PREPARE expires_at_stmt FROM @expires_at_sql;
EXECUTE expires_at_stmt;
DEALLOCATE PREPARE expires_at_stmt;

SET @is_active_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND COLUMN_NAME = 'is_active'
);
SET @is_active_sql = IF(
  @is_active_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER expires_at',
  'SELECT 1'
);
PREPARE is_active_stmt FROM @is_active_sql;
EXECUTE is_active_stmt;
DEALLOCATE PREPARE is_active_stmt;

SET @unlinked_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND COLUMN_NAME = 'unlinked_at'
);
SET @unlinked_at_sql = IF(
  @unlinked_at_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD COLUMN unlinked_at TIMESTAMP NULL DEFAULT NULL AFTER is_active',
  'SELECT 1'
);
PREPARE unlinked_at_stmt FROM @unlinked_at_sql;
EXECUTE unlinked_at_stmt;
DEALLOCATE PREPARE unlinked_at_stmt;

SET @unlink_reason_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND COLUMN_NAME = 'unlink_reason'
);
SET @unlink_reason_sql = IF(
  @unlink_reason_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD COLUMN unlink_reason VARCHAR(64) NULL DEFAULT NULL AFTER unlinked_at',
  'SELECT 1'
);
PREPARE unlink_reason_stmt FROM @unlink_reason_sql;
EXECUTE unlink_reason_stmt;
DEALLOCATE PREPARE unlink_reason_stmt;

SET @metadata_cleared_at_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND COLUMN_NAME = 'metadata_cleared_at'
);
SET @metadata_cleared_at_sql = IF(
  @metadata_cleared_at_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD COLUMN metadata_cleared_at TIMESTAMP NULL DEFAULT NULL AFTER unlink_reason',
  'SELECT 1'
);
PREPARE metadata_cleared_at_stmt FROM @metadata_cleared_at_sql;
EXECUTE metadata_cleared_at_stmt;
DEALLOCATE PREPARE metadata_cleared_at_stmt;

UPDATE agent_driver_referrals r
LEFT JOIN users u ON u.clerk_user_id = r.driver_user_id
SET r.linked_at = COALESCE(r.linked_at, u.created_at, r.created_at),
    r.expires_at = COALESCE(
      r.expires_at,
      DATE_ADD(COALESCE(r.linked_at, u.created_at, r.created_at), INTERVAL 40 DAY)
    );

UPDATE agent_driver_referrals
SET is_active = 0,
    unlinked_at = COALESCE(unlinked_at, expires_at),
    unlink_reason = COALESCE(unlink_reason, '40_day_expired')
WHERE expires_at <= CURRENT_TIMESTAMP
  AND is_active = 1;

SET @expiry_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_driver_referrals'
    AND INDEX_NAME = 'idx_agent_driver_referrals_expiry'
);
SET @expiry_index_sql = IF(
  @expiry_index_exists = 0,
  'ALTER TABLE agent_driver_referrals ADD INDEX idx_agent_driver_referrals_expiry (is_active, expires_at)',
  'SELECT 1'
);
PREPARE expiry_index_stmt FROM @expiry_index_sql;
EXECUTE expiry_index_stmt;
DEALLOCATE PREPARE expiry_index_stmt;
