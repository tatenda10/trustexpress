-- Run this in cPanel phpMyAdmin (or any MySQL client) to fix "No vehicle tiers are configured yet".
-- 1. Creates vehicle_tier_rules if missing (TEXT columns for JSON for broad MySQL/MariaDB compatibility).
-- 2. Clears and inserts Trust Express, Trust XL, Trust Luxury.

CREATE TABLE IF NOT EXISTS vehicle_tier_rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tier_key VARCHAR(80) NOT NULL,
  tier_name VARCHAR(120) NOT NULL,
  short_description VARCHAR(255) NULL,
  vehicle_requirements_json TEXT NULL,
  passenger_comfort_json TEXT NULL,
  driver_requirements_json TEXT NULL,
  use_cases_json TEXT NULL,
  example_vehicles_json TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_vehicle_tier_rules_key (tier_key),
  INDEX idx_vehicle_tier_rules_active (is_active, sort_order)
);

DELETE FROM vehicle_tier_rules;

INSERT INTO vehicle_tier_rules (
  tier_key, tier_name, short_description,
  vehicle_requirements_json, passenger_comfort_json, driver_requirements_json,
  use_cases_json, example_vehicles_json, is_active, sort_order
) VALUES
(
  'trust-express',
  'Trust Express',
  'Standard 4-seat ride for everyday affordable city trips.',
  '["4-door vehicle","4 passenger seats","2005 model or newer","Clean interior and exterior","Good mechanical condition","Valid license, insurance, and registration","Driver must have a valid driver''s license","Smartphone with the Trust Express driver app"]',
  '[]',
  '[]',
  '["Everyday affordable rides","Short city trips"]',
  '[]',
  1,
  0
),
(
  'trust-xl',
  'Trust XL',
  '6 to 7 seat vehicle tier for families, airport runs, and group transport.',
  '["Vehicle must carry 6 to 7 passengers","2010 model or newer","4 doors or more","Spacious legroom and comfortable seats","Working air conditioning","Clean interior and exterior","Seatbelts for all passengers","Large luggage space good for airport trips","Sliding doors or easy passenger access preferred","Strong suspension suitable for group transport"]',
  '["Phone charging ports USB","Optional in-car Wi-Fi","Optional bottled water for passengers","Music control for passengers","Quiet and smooth ride"]',
  '["Professional and respectful","Good knowledge of the city","High driver rating","Neat appearance"]',
  '["Families","Airport transfers","Group travel","Tour rides","Business group trips"]',
  '["Toyota Avanza","Suzuki Ertiga","Toyota Rumion","Honda BR-V","Nissan Livina"]',
  1,
  1
),
(
  'trust-luxury',
  'Trust Luxury',
  'Premium ride option for executive and high-comfort trips.',
  '["2015 model or newer","High-end sedan or SUV","Excellent interior condition","Leather seats preferred","Working air conditioning","No body damage","Quiet and smooth driving"]',
  '["Free Wi-Fi","Complimentary bottled water","Phone charging ports","Clean and fresh interior","Passengers may choose music or quiet ride"]',
  '["Well dressed and professional","Excellent customer service","High driver rating"]',
  '[]',
  '[]',
  1,
  2
);
