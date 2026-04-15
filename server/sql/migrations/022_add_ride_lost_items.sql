CREATE TABLE IF NOT EXISTS ride_lost_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT UNSIGNED NOT NULL,
  ride_public_id VARCHAR(64) NULL,
  passenger_user_id VARCHAR(128) NOT NULL,
  driver_user_id VARCHAR(128) NULL,
  item_description TEXT NOT NULL,
  contact_phone VARCHAR(64) NULL,
  status ENUM('open', 'contacted', 'returned', 'closed') NOT NULL DEFAULT 'open',
  admin_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ride_lost_items_ride_request_id (ride_request_id),
  KEY idx_ride_lost_items_passenger_user_id (passenger_user_id),
  KEY idx_ride_lost_items_driver_user_id (driver_user_id),
  KEY idx_ride_lost_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
