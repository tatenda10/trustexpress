SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hire_requests'
    AND COLUMN_NAME = 'recommended_fare_min'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE hire_requests ADD COLUMN recommended_fare_min DECIMAL(12, 2) NULL DEFAULT NULL AFTER passenger_count',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hire_requests'
    AND COLUMN_NAME = 'recommended_fare_max'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE hire_requests ADD COLUMN recommended_fare_max DECIMAL(12, 2) NULL DEFAULT NULL AFTER recommended_fare_min',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hire_requests'
    AND COLUMN_NAME = 'passenger_offer_amount'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE hire_requests ADD COLUMN passenger_offer_amount DECIMAL(12, 2) NULL DEFAULT NULL AFTER recommended_fare_max',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hire_requests'
    AND COLUMN_NAME = 'fare_currency'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE hire_requests ADD COLUMN fare_currency VARCHAR(8) NOT NULL DEFAULT ''USD'' AFTER passenger_offer_amount',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hire_requests'
    AND INDEX_NAME = 'idx_hire_requests_offer'
);
SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX idx_hire_requests_offer ON hire_requests (passenger_offer_amount)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
