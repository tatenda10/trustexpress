CREATE TABLE IF NOT EXISTS ride_request_driver_responses (
  id BIGINT NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT NOT NULL,
  driver_user_id VARCHAR(255) NOT NULL,
  status ENUM('accepted', 'declined', 'selected', 'expired') NOT NULL DEFAULT 'accepted',
  responded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  selected_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ride_driver_response (ride_request_id, driver_user_id),
  KEY idx_rrdr_ride_request_id (ride_request_id),
  KEY idx_rrdr_driver_user_id (driver_user_id),
  CONSTRAINT fk_rrdr_ride_request FOREIGN KEY (ride_request_id) REFERENCES ride_requests(id) ON DELETE CASCADE
);
