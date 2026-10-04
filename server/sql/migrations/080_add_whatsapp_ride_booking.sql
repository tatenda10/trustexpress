CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  whatsapp_phone VARCHAR(32) NOT NULL PRIMARY KEY,
  state VARCHAR(64) NOT NULL DEFAULT 'idle',
  payload_json JSON NULL,
  ride_request_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_whatsapp_sessions_state (state),
  INDEX idx_whatsapp_sessions_ride_request_id (ride_request_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_ride_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  whatsapp_phone VARCHAR(32) NOT NULL,
  ride_request_id BIGINT NOT NULL,
  public_id VARCHAR(32) NULL,
  payload_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'requested',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_whatsapp_ride_request (ride_request_id),
  INDEX idx_whatsapp_ride_phone (whatsapp_phone),
  INDEX idx_whatsapp_ride_public_id (public_id)
);
