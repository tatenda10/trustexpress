CREATE TABLE IF NOT EXISTS agent_reward_tiers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  rides_threshold INT NOT NULL,
  reward_amount_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_reward_threshold (rides_threshold),
  INDEX idx_agent_reward_active_order (is_active, sort_order)
);

INSERT INTO agent_reward_tiers (rides_threshold, reward_amount_usd, is_active, sort_order)
SELECT seed.rides_threshold, seed.reward_amount_usd, 1, seed.sort_order
FROM (
  SELECT 8 AS rides_threshold, 3.00 AS reward_amount_usd, 0 AS sort_order
  UNION ALL SELECT 15, 4.00, 1
  UNION ALL SELECT 25, 5.00, 2
  UNION ALL SELECT 35, 6.00, 3
  UNION ALL SELECT 50, 7.00, 4
) AS seed
LEFT JOIN agent_reward_tiers existing ON existing.rides_threshold = seed.rides_threshold
WHERE existing.id IS NULL;
