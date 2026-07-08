CREATE TABLE IF NOT EXISTS end_user_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  clerk_user_id VARCHAR(255) NOT NULL UNIQUE,
  clerk_session_id VARCHAR(255) NOT NULL,
  session_issued_at BIGINT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_end_user_session_id (clerk_session_id),
  INDEX idx_end_user_last_seen (last_seen_at)
);
