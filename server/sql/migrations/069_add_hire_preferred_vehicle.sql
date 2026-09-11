ALTER TABLE hire_requests
  ADD COLUMN preferred_hire_vehicle_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER notes;

CREATE INDEX idx_hire_requests_preferred_vehicle
  ON hire_requests (preferred_hire_vehicle_id);
