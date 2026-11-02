CREATE TABLE IF NOT EXISTS pricing_surge_rules (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  tier_key VARCHAR(100) NULL DEFAULT NULL,
  weekdays VARCHAR(32) NOT NULL DEFAULT '0,1,2,3,4,5,6',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  multiplier DECIMAL(5, 2) NOT NULL,
  starts_on DATE NULL DEFAULT NULL,
  ends_on DATE NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_id BIGINT NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pricing_surge_active (is_active, tier_key),
  KEY idx_pricing_surge_dates (starts_on, ends_on)
);
