ALTER TABLE hire_bookings
  ADD COLUMN arrived_at DATETIME NULL DEFAULT NULL AFTER started_at;

ALTER TABLE hire_bookings
  MODIFY COLUMN status ENUM('confirmed', 'driver_arrived', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'confirmed';
