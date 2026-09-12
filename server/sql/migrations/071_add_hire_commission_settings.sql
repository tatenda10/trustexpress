ALTER TABLE hire_requests
  ADD COLUMN trip_type ENUM('local', 'intercity') NOT NULL DEFAULT 'local' AFTER category,
  ADD COLUMN estimated_distance_km DECIMAL(10,2) NULL DEFAULT NULL AFTER trip_type;

ALTER TABLE hire_bookings
  ADD COLUMN expenses_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER amount;

CREATE TABLE IF NOT EXISTS hire_commission_settings (
  id TINYINT NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  intercity_distance_km DECIMAL(8,2) NOT NULL DEFAULT 80.00,
  updated_by_admin_id INT NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO hire_commission_settings (id, enabled, intercity_distance_km)
SELECT 1, 1, 80.00
WHERE NOT EXISTS (
  SELECT 1 FROM hire_commission_settings WHERE id = 1
);

CREATE TABLE IF NOT EXISTS hire_commission_bands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  band_key VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL DEFAULT NULL,
  rate_percent DECIMAL(5,2) NOT NULL,
  min_commission_usd DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  match_trip_type ENUM('any', 'local', 'intercity') NOT NULL DEFAULT 'any',
  category_slugs JSON NULL,
  priority INT NOT NULL DEFAULT 0,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hire_commission_bands_key (band_key)
);

INSERT INTO hire_commission_bands (
  band_key, label, description, rate_percent, min_commission_usd,
  match_trip_type, category_slugs, priority, is_default, sort_order
)
SELECT
  'local',
  'Local vehicle hires and deliveries',
  'Small local bookings. Commission is taken on the agreed hire charge only.',
  9.90,
  0.00,
  'local',
  JSON_ARRAY(),
  10,
  1,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM hire_commission_bands WHERE band_key = 'local'
);

INSERT INTO hire_commission_bands (
  band_key, label, description, rate_percent, min_commission_usd,
  match_trip_type, category_slugs, priority, is_default, sort_order
)
SELECT
  'intercity',
  'Intercity hires',
  'Longer trips between cities. Uses the intercity distance threshold when trip type is not set.',
  8.00,
  0.00,
  'intercity',
  JSON_ARRAY(),
  20,
  0,
  2
WHERE NOT EXISTS (
  SELECT 1 FROM hire_commission_bands WHERE band_key = 'intercity'
);

INSERT INTO hire_commission_bands (
  band_key, label, description, rate_percent, min_commission_usd,
  match_trip_type, category_slugs, priority, is_default, sort_order
)
SELECT
  'large_vehicle',
  'Large vehicles',
  'Sprinters, Iveco, Hiace, 18-seaters and similar high-capacity vehicles.',
  7.00,
  0.00,
  'any',
  JSON_ARRAY('sprinter', 'iveco', 'hiace', 'eighteen_seater_plus', 'bus', 'caravan'),
  30,
  0,
  3
WHERE NOT EXISTS (
  SELECT 1 FROM hire_commission_bands WHERE band_key = 'large_vehicle'
);

INSERT INTO hire_commission_bands (
  band_key, label, description, rate_percent, min_commission_usd,
  match_trip_type, category_slugs, priority, is_default, sort_order
)
SELECT
  'lorry_move',
  'Lorries and major property moves',
  'Trucks, lorries and moving vans. Higher-value jobs with a lower percent and a US$5 minimum.',
  5.00,
  5.00,
  'any',
  JSON_ARRAY('lorry', 'truck', 'moving_van'),
  40,
  0,
  4
WHERE NOT EXISTS (
  SELECT 1 FROM hire_commission_bands WHERE band_key = 'lorry_move'
);
