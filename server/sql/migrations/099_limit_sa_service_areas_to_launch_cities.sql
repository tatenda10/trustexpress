UPDATE service_areas
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE country_code = 'ZA';

INSERT INTO service_areas (
  area_key, label, country_code, center_lat, center_lng,
  west_lng, south_lat, east_lng, north_lat, is_active, sort_order
) VALUES
  ('za-johannesburg', 'Johannesburg', 'ZA', -26.2041000, 28.0473000, 27.7000000, -26.4500000, 28.3500000, -25.9000000, 1, 100),
  ('za-pretoria', 'Pretoria', 'ZA', -25.7479000, 28.2293000, 27.8500000, -25.9500000, 28.5500000, -25.4500000, 1, 101),
  ('za-cape-town', 'Cape Town', 'ZA', -33.9249000, 18.4241000, 18.2500000, -34.3500000, 18.9500000, -33.5500000, 1, 102)
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  country_code = 'ZA',
  center_lat = VALUES(center_lat),
  center_lng = VALUES(center_lng),
  west_lng = VALUES(west_lng),
  south_lat = VALUES(south_lat),
  east_lng = VALUES(east_lng),
  north_lat = VALUES(north_lat),
  is_active = 1,
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;

