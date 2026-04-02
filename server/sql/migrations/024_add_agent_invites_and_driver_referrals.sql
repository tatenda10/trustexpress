CREATE TABLE IF NOT EXISTS agent_invites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_user_id INT NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_agent_invites_agent (agent_user_id),
  INDEX idx_agent_invites_token (token),
  CONSTRAINT fk_agent_invites_agent
    FOREIGN KEY (agent_user_id) REFERENCES agent_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_driver_referrals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  driver_user_id VARCHAR(255) NOT NULL UNIQUE,
  agent_user_id INT NOT NULL,
  invite_id INT NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'agent_deep_link',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_driver_referrals_agent (agent_user_id),
  INDEX idx_agent_driver_referrals_invite (invite_id),
  CONSTRAINT fk_agent_driver_referrals_agent
    FOREIGN KEY (agent_user_id) REFERENCES agent_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_driver_referrals_invite
    FOREIGN KEY (invite_id) REFERENCES agent_invites(id) ON DELETE CASCADE
);
