CREATE TABLE IF NOT EXISTS agent_passenger_referrals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  passenger_user_id VARCHAR(255) NOT NULL UNIQUE,
  agent_user_id INT NOT NULL,
  invite_id INT NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'agent_deep_link',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_passenger_referrals_agent (agent_user_id),
  INDEX idx_agent_passenger_referrals_invite (invite_id),
  CONSTRAINT fk_agent_passenger_referrals_agent
    FOREIGN KEY (agent_user_id) REFERENCES agent_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_passenger_referrals_invite
    FOREIGN KEY (invite_id) REFERENCES agent_invites(id) ON DELETE CASCADE
);
