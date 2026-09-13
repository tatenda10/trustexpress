CREATE TABLE IF NOT EXISTS hire_vehicle_types (
  id INT NOT NULL AUTO_INCREMENT,
  type_key VARCHAR(64) NOT NULL,
  type_name VARCHAR(128) NOT NULL,
  price_per_km DECIMAL(10, 4) NOT NULL DEFAULT 1.0000,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hire_vehicle_types_key (type_key)
);

INSERT IGNORE INTO hire_vehicle_types (type_key, type_name, price_per_km, is_active, sort_order) VALUES
('delivery', 'Delivery', 0.8000, 1, 1),
('sedan', 'Sedan', 0.8000, 1, 2),
('suv', 'SUV', 1.0000, 1, 3),
('van', 'Van', 1.1000, 1, 4),
('pickup', 'Pickup', 1.1000, 1, 5),
('sprinter', 'Sprinter', 1.2000, 1, 6),
('iveco', 'Iveco', 1.2000, 1, 7),
('hiace', 'Hiace', 1.1000, 1, 8),
('eighteen_seater_plus', '18-seater+', 1.4000, 1, 9),
('bus', 'Bus', 1.5000, 1, 10),
('moving_van', 'Moving van', 1.2000, 1, 11),
('truck', 'Truck', 1.0000, 1, 12),
('lorry', 'Lorry', 1.5000, 1, 13),
('other', 'Other', 1.0000, 1, 14);
