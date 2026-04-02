ALTER TABLE operating_regions
  ADD COLUMN center_lat DECIMAL(10,7) NULL AFTER timezone,
  ADD COLUMN center_lng DECIMAL(10,7) NULL AFTER center_lat,
  ADD COLUMN boundary_geojson JSON NULL AFTER center_lng;

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
