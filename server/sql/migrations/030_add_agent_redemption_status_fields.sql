ALTER TABLE agent_reward_redemptions
  ADD COLUMN status ENUM('pending', 'processed', 'rejected') NOT NULL DEFAULT 'pending' AFTER tiers_json,
  ADD COLUMN reviewed_by_admin_id INT NULL AFTER status,
  ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL AFTER reviewed_by_admin_id,
  ADD COLUMN review_note VARCHAR(255) NULL AFTER reviewed_at;

ALTER TABLE agent_reward_redemptions
  ADD INDEX idx_agent_reward_redemptions_status (status, created_at),
  ADD CONSTRAINT fk_agent_reward_redemptions_reviewed_by_admin
    FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL;
