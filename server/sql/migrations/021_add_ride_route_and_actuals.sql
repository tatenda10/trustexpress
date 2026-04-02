ALTER TABLE ride_requests
  ADD COLUMN route_polyline MEDIUMTEXT NULL AFTER dropoff_lng,
  ADD COLUMN route_distance_km DECIMAL(10,2) NULL AFTER route_polyline,
  ADD COLUMN route_duration_minutes INT NULL AFTER route_distance_km,
  ADD COLUMN started_at TIMESTAMP NULL DEFAULT NULL AFTER arrived_at,
  ADD COLUMN actual_distance_km DECIMAL(10,2) NULL AFTER completed_at,
  ADD COLUMN actual_minutes INT NULL AFTER actual_distance_km;
