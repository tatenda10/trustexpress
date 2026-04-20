CREATE TABLE IF NOT EXISTS agent_reward_state (
  agent_user_id INT NOT NULL PRIMARY KEY,
  last_reset_total_rides INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_reward_state_agent FOREIGN KEY (agent_user_id) REFERENCES agent_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_reward_redemptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  agent_user_id INT NOT NULL,
  rides_total_at_redeem INT NOT NULL,
  cycle_rides_at_redeem INT NOT NULL,
  highest_threshold INT NOT NULL,
  amount_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  tiers_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_reward_redemptions_agent (agent_user_id, created_at),
  CONSTRAINT fk_agent_reward_redemptions_agent FOREIGN KEY (agent_user_id) REFERENCES agent_users(id) ON DELETE CASCADE
);
