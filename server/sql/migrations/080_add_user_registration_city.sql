SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'registration_city'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN registration_city VARCHAR(80) NULL DEFAULT NULL AFTER phone_verified_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'registration_country_code'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN registration_country_code CHAR(2) NULL DEFAULT NULL AFTER registration_city',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'registration_lat'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN registration_lat DECIMAL(10,7) NULL DEFAULT NULL AFTER registration_country_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'registration_lng'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN registration_lng DECIMAL(10,7) NULL DEFAULT NULL AFTER registration_lat',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'registration_source'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN registration_source VARCHAR(40) NULL DEFAULT NULL AFTER registration_lng',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'registration_detected_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE users ADD COLUMN registration_detected_at TIMESTAMP NULL DEFAULT NULL AFTER registration_source',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_registration_city'
);
SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX idx_users_registration_city ON users (registration_city)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_registration_created'
);
SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX idx_users_registration_created ON users (registration_city, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
