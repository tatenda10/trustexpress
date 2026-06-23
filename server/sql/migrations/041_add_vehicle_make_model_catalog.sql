CREATE TABLE IF NOT EXISTS vehicle_make_model_catalog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  make_name VARCHAR(120) NOT NULL,
  models_json LONGTEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vehicle_make_model_catalog_make (make_name),
  INDEX idx_vehicle_make_model_catalog_active_sort (is_active, sort_order)
);

INSERT INTO vehicle_make_model_catalog (make_name, models_json, is_active, sort_order)
SELECT 'Toyota', '["Corolla","Auris","Yaris","Vitz","Passo","Belta","Wish","Premio","Allion","Axio","Fielder","Mark X","Hilux","Fortuner","RAV4","Harrier","Prado","Land Cruiser","Sienta","Noah","Voxy","Alphard","Hiace","Probox","Rumion","Ist","Raum"]', 1, 0
WHERE NOT EXISTS (SELECT 1 FROM vehicle_make_model_catalog);

INSERT INTO vehicle_make_model_catalog (make_name, models_json, is_active, sort_order)
SELECT 'Daihatsu', '["Mira","Move","Tanto","Boon","Sirion","Terios","Rocky","Thor","Cast","Copen","Hijet"]', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_make_model_catalog WHERE make_name = 'Daihatsu');

INSERT INTO vehicle_make_model_catalog (make_name, models_json, is_active, sort_order)
SELECT 'Honda', '["Fit","Jazz","Civic","Accord","CR-V","HR-V","Vezel","Insight","Freed","Stepwgn","Airwave","Stream"]', 1, 2
WHERE NOT EXISTS (SELECT 1 FROM vehicle_make_model_catalog WHERE make_name = 'Honda');

INSERT INTO vehicle_make_model_catalog (make_name, models_json, is_active, sort_order)
SELECT 'Nissan', '["March","Note","Tiida","Sunny","Bluebird","Sylphy","Wingroad","X-Trail","Dualis","Qashqai","Navara","Serena","NV200"]', 1, 3
WHERE NOT EXISTS (SELECT 1 FROM vehicle_make_model_catalog WHERE make_name = 'Nissan');

INSERT INTO vehicle_make_model_catalog (make_name, models_json, is_active, sort_order)
SELECT 'Mazda', '["Demio","Mazda2","Mazda3","Axela","Atenza","Verisa","CX-3","CX-5","CX-7","BT-50","Bongo"]', 1, 4
WHERE NOT EXISTS (SELECT 1 FROM vehicle_make_model_catalog WHERE make_name = 'Mazda');
