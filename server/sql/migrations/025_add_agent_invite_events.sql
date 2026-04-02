CREATE TABLE IF NOT EXISTS agent_invite_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  invite_id INT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  metadata_json JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_invite_events_invite_created (invite_id, created_at),
  CONSTRAINT fk_agent_invite_events_invite
    FOREIGN KEY (invite_id) REFERENCES agent_invites(id) ON DELETE CASCADE
);
