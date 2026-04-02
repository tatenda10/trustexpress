CREATE TABLE IF NOT EXISTS vehicle_tier_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tier_key VARCHAR(80) NOT NULL,
  tier_name VARCHAR(120) NOT NULL,
  short_description VARCHAR(255) NULL,
  vehicle_requirements_json JSON NULL,
  passenger_comfort_json JSON NULL,
  driver_requirements_json JSON NULL,
  use_cases_json JSON NULL,
  example_vehicles_json JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_vehicle_tier_rules_key (tier_key),
  INDEX idx_vehicle_tier_rules_active (is_active, sort_order)
);
