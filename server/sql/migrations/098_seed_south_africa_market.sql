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
) VALUES (
  'south-africa-national',
  'South Africa',
  'ZA',
  -30.5595000,
  22.9375000,
  16.4500000,
  -34.8500000,
  32.9500000,
  -22.1200000,
  1,
  100
)
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

INSERT INTO operating_regions (
  region_name,
  country_code,
  city,
  currency_code,
  timezone,
  center_lat,
  center_lng,
  boundary_geojson,
  is_active
) VALUES (
  'Trust Express South Africa',
  'ZA',
  'National',
  'ZAR',
  'Africa/Johannesburg',
  -30.5595000,
  22.9375000,
  JSON_OBJECT(
    'type', 'Polygon',
    'coordinates', JSON_ARRAY(JSON_ARRAY(
      JSON_ARRAY(16.4500000, -34.8500000),
      JSON_ARRAY(32.9500000, -34.8500000),
      JSON_ARRAY(32.9500000, -22.1200000),
      JSON_ARRAY(16.4500000, -22.1200000),
      JSON_ARRAY(16.4500000, -34.8500000)
    ))
  ),
  1
)
ON DUPLICATE KEY UPDATE
  currency_code = 'ZAR',
  timezone = 'Africa/Johannesburg',
  center_lat = VALUES(center_lat),
  center_lng = VALUES(center_lng),
  boundary_geojson = VALUES(boundary_geojson),
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO operating_region_pricing_tiers (
  region_id,
  tier_key,
  tier_name,
  price_per_km,
  base_fare,
  per_minute_rate,
  minimum_fare,
  is_active,
  sort_order
)
SELECT
  sa.id,
  zw_tier.tier_key,
  zw_tier.tier_name,
  zw_tier.price_per_km,
  zw_tier.base_fare,
  zw_tier.per_minute_rate,
  zw_tier.minimum_fare,
  zw_tier.is_active,
  zw_tier.sort_order
FROM operating_regions sa
INNER JOIN operating_region_pricing_tiers zw_tier
  ON zw_tier.region_id = (
    SELECT zw.id
    FROM operating_regions zw
    WHERE zw.country_code = 'ZW'
      AND zw.is_active = 1
    ORDER BY zw.id ASC
    LIMIT 1
  )
WHERE sa.region_name = 'Trust Express South Africa'
  AND sa.country_code = 'ZA'
  AND sa.city = 'National'
ON DUPLICATE KEY UPDATE
  tier_name = VALUES(tier_name),
  price_per_km = VALUES(price_per_km),
  base_fare = VALUES(base_fare),
  per_minute_rate = VALUES(per_minute_rate),
  minimum_fare = VALUES(minimum_fare),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;

