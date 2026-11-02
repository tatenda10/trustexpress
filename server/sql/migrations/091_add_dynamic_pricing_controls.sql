CREATE TABLE IF NOT EXISTS dynamic_pricing_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  manual_mode VARCHAR(20) NULL DEFAULT NULL,
  peak_multiplier DECIMAL(5, 2) NOT NULL DEFAULT 1.25,
  night_multiplier DECIMAL(5, 2) NOT NULL DEFAULT 1.20,
  rain_multiplier DECIMAL(5, 2) NOT NULL DEFAULT 1.30,
  updated_by_admin_id BIGINT NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

INSERT IGNORE INTO dynamic_pricing_settings (
  id,
  is_enabled,
  manual_mode,
  peak_multiplier,
  night_multiplier,
  rain_multiplier
) VALUES (1, 1, NULL, 1.25, 1.20, 1.30);
