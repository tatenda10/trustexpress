CREATE TABLE IF NOT EXISTS service_areas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  area_key VARCHAR(80) NOT NULL UNIQUE,
  label VARCHAR(120) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'ZW',
  center_lat DECIMAL(10,7) NOT NULL,
  center_lng DECIMAL(10,7) NOT NULL,
  west_lng DECIMAL(10,7) NOT NULL,
  south_lat DECIMAL(10,7) NOT NULL,
  east_lng DECIMAL(10,7) NOT NULL,
  north_lat DECIMAL(10,7) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_by_admin_id INT NULL DEFAULT NULL,
  updated_by_admin_id INT NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_service_areas_active (is_active, sort_order),
  INDEX idx_service_areas_label (label)
);

INSERT INTO service_areas (
  area_key,
  label,
  country_code,
  center_lat,
  center_lng,
  west_lng,
  south_lat,
  east_lng,
  north_lat,
  is_active,
  sort_order
)
SELECT 'bulawayo', 'Bulawayo', 'ZW', -20.1535000, 28.5870000, 28.3500000, -20.3200000, 28.7800000, -19.8200000, 1, 0
WHERE NOT EXISTS (SELECT 1 FROM service_areas WHERE area_key = 'bulawayo');

INSERT INTO service_areas (
  area_key,
  label,
  country_code,
  center_lat,
  center_lng,
  west_lng,
  south_lat,
  east_lng,
  north_lat,
  is_active,
  sort_order
)
SELECT 'gweru', 'Gweru', 'ZW', -19.4516000, 29.8164000, 29.6200000, -19.6200000, 30.0300000, -19.2800000, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM service_areas WHERE area_key = 'gweru');
