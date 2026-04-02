CREATE TABLE IF NOT EXISTS ride_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  ride_request_id BIGINT NOT NULL,
  sender_user_id VARCHAR(255) NOT NULL,
  recipient_user_id VARCHAR(255) NOT NULL,
  sender_role ENUM('driver', 'passenger') NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_ride_messages_ride_created (ride_request_id, created_at),
  KEY idx_ride_messages_recipient_read (recipient_user_id, read_at),
  CONSTRAINT fk_ride_messages_ride_request
    FOREIGN KEY (ride_request_id) REFERENCES ride_requests(id)
    ON DELETE CASCADE
);
