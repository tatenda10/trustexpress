CREATE TABLE IF NOT EXISTS ride_safety_pin_settings (
  id TINYINT NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  night_start_hour TINYINT NOT NULL DEFAULT 18,
  night_end_hour TINYINT NOT NULL DEFAULT 6,
  max_attempts TINYINT NOT NULL DEFAULT 3,
  updated_by_admin_id INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO ride_safety_pin_settings (
  id,
  enabled,
  night_start_hour,
  night_end_hour,
  max_attempts
)
SELECT
  1,
  1,
  18,
  6,
  3
WHERE NOT EXISTS (
  SELECT 1 FROM ride_safety_pin_settings WHERE id = 1
);
