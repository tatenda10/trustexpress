CREATE TABLE IF NOT EXISTS ride_calls (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  ride_request_id BIGINT NOT NULL,
  caller_user_id VARCHAR(64) NOT NULL,
  callee_user_id VARCHAR(64) NOT NULL,
  caller_role VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ringing',
  end_reason VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TIMESTAMP NULL DEFAULT NULL,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  duration_seconds INT NULL,
  KEY idx_ride_calls_ride (ride_request_id),
  KEY idx_ride_calls_caller (caller_user_id),
  KEY idx_ride_calls_callee (callee_user_id)
);
