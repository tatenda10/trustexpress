SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'driver_identity'
    AND COLUMN_NAME = 'date_of_birth'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE driver_identity ADD COLUMN date_of_birth DATE NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'driver_identity'
    AND COLUMN_NAME = 'driver_licence_expires_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE driver_identity ADD COLUMN driver_licence_expires_at DATE NULL DEFAULT NULL AFTER driver_licence_number',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
