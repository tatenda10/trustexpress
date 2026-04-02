CREATE TABLE IF NOT EXISTS operating_regions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  region_name VARCHAR(120) NOT NULL,
  country_code CHAR(2) NOT NULL,
  city VARCHAR(120) NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  timezone VARCHAR(60) NULL,
  center_lat DECIMAL(10,7) NULL,
  center_lng DECIMAL(10,7) NULL,
  boundary_geojson JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_region_identity (region_name, country_code, city),
  INDEX idx_region_active (is_active),
  CONSTRAINT fk_operating_regions_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_operating_regions_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS operating_region_configs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  config_key VARCHAR(120) NOT NULL,
  value_type ENUM('string', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string',
  value_text TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_region_config_key (region_id, config_key),
  INDEX idx_region_config_key_lookup (config_key),
  CONSTRAINT fk_operating_region_configs_region_id FOREIGN KEY (region_id) REFERENCES operating_regions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS operating_region_pricing_tiers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  region_id INT NOT NULL,
  tier_key VARCHAR(80) NOT NULL,
  tier_name VARCHAR(120) NOT NULL,
  price_per_km DECIMAL(10,2) NOT NULL,
  base_fare DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  per_minute_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  minimum_fare DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_region_tier (region_id, tier_key),
  INDEX idx_region_tiers_active (region_id, is_active),
  CONSTRAINT fk_operating_region_pricing_tiers_region_id FOREIGN KEY (region_id) REFERENCES operating_regions(id) ON DELETE CASCADE
);
