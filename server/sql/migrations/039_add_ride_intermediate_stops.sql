SET @has_intermediate_stops_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_requests'
    AND COLUMN_NAME = 'intermediate_stops_json'
);

SET @add_intermediate_stops_sql := IF(
  @has_intermediate_stops_json = 0,
  'ALTER TABLE ride_requests ADD COLUMN intermediate_stops_json JSON NULL AFTER dropoff_lng',
  'SELECT 1'
);

PREPARE add_intermediate_stops_stmt FROM @add_intermediate_stops_sql;
EXECUTE add_intermediate_stops_stmt;
DEALLOCATE PREPARE add_intermediate_stops_stmt;

SET @has_current_stop_index := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ride_requests'
    AND COLUMN_NAME = 'current_stop_index'
);

SET @add_current_stop_index_sql := IF(
  @has_current_stop_index = 0,
  'ALTER TABLE ride_requests ADD COLUMN current_stop_index INT NOT NULL DEFAULT 0 AFTER intermediate_stops_json',
  'SELECT 1'
);

PREPARE add_current_stop_index_stmt FROM @add_current_stop_index_sql;
EXECUTE add_current_stop_index_stmt;
DEALLOCATE PREPARE add_current_stop_index_stmt;

UPDATE ride_requests
SET current_stop_index = COALESCE(current_stop_index, 0)
WHERE 1 = 1;
