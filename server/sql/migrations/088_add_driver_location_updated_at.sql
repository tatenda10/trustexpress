SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'driver_availability'
    AND COLUMN_NAME = 'location_updated_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE driver_availability ADD COLUMN location_updated_at TIMESTAMP NULL DEFAULT NULL AFTER current_lng',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE driver_availability
SET location_updated_at = last_seen_at
WHERE location_updated_at IS NULL
  AND current_lat IS NOT NULL
  AND current_lng IS NOT NULL;
